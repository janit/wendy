import { Database } from "@db/sqlite";
import { ARCHIVE_FORMAT, encodeDay } from "./archive-codec.ts";
import {
  hasArchivedDay,
  insertArchivedDay,
  pruneArchive,
} from "./archive-db.ts";
import { getOldestSampleDate, getSamplesForDay } from "./db.ts";

export interface ArchiverOpts {
  liveDb: Database;
  archiveDb: Database;
  retentionDays: number;
}

const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 26 * 3600 * 1000;
const WARN_UNARCHIVED_OLDER_THAN_DAYS = 2;

export function computeNextRunAt(now: Date): Date {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    5,
    0,
    0,
  ));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export function clampDelay(delayMs: number): number {
  if (delayMs < MIN_DELAY_MS) return MIN_DELAY_MS;
  if (delayMs > MAX_DELAY_MS) return MAX_DELAY_MS;
  return delayMs;
}

/**
 * Return any UTC dates that are older than the warn threshold (default 2 days),
 * actually have samples in the live DB, and are not yet in the archive. Lets
 * the orchestrator surface a loud warning if the archiver is failing to keep
 * up before the live DB's 7-day prune deletes the unarchived rows. Days that
 * have no samples at all (gaps) are intentionally not flagged.
 */
export function findFallingBehind(liveDb: Database, archiveDb: Database, now: Date): string[] {
  const cutoffMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    - WARN_UNARCHIVED_OLDER_THAN_DAYS * 86400_000;
  const cutoffTs = Math.floor(cutoffMs / 1000);

  const rows = liveDb.prepare(
    "SELECT DISTINCT date(ts, 'unixepoch') as day FROM samples WHERE ts < ? ORDER BY day",
  ).all<{ day: string }>(cutoffTs);

  return rows
    .filter((r) => !hasArchivedDay(archiveDb, r.day))
    .map((r) => r.day);
}

function dayStartUnix(dateUtc: string): number {
  return Math.floor(Date.UTC(
    parseInt(dateUtc.slice(0, 4)),
    parseInt(dateUtc.slice(5, 7)) - 1,
    parseInt(dateUtc.slice(8, 10)),
  ) / 1000);
}

export async function runArchivePass(opts: ArchiverOpts): Promise<void> {
  const { liveDb, archiveDb, retentionDays } = opts;

  const todayDate = new Date().toISOString().slice(0, 10);

  // Encode any complete days that haven't been archived yet
  const oldestDate = getOldestSampleDate(liveDb);
  if (oldestDate != null && oldestDate < todayDate) {
    const cursor = new Date(oldestDate + "T00:00:00Z");
    const todayMs = new Date(todayDate + "T00:00:00Z").getTime();

    while (cursor.getTime() < todayMs) {
      const date = cursor.toISOString().slice(0, 10);
      if (!hasArchivedDay(archiveDb, date)) {
        const samples = getSamplesForDay(liveDb, date);
        if (samples.length > 0) {
          try {
            const blob = await encodeDay(samples);
            const dayStart = dayStartUnix(date);
            insertArchivedDay(archiveDb, {
              date,
              row_count: samples.length,
              ts_start: dayStart,
              ts_end: dayStart + 86400,
              format: ARCHIVE_FORMAT,
              blob,
              created_at: Math.floor(Date.now() / 1000),
            });
            console.log(`[archive] archived ${date} (${samples.length} rows, ${blob.length} bytes)`);
          } catch (err) {
            console.error(`[archive] failed for ${date}:`, err);
            // Continue with next day; do not mark archived
          }
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // Retention prune ALWAYS runs, independent of whether new data was archived.
  // A pure-archive instance with no new live data still needs its old days
  // pruned to honor the retention window.
  const cutoffMs = new Date(todayDate + "T00:00:00Z").getTime() - retentionDays * 86400_000;
  const cutoffStr = new Date(cutoffMs).toISOString().slice(0, 10);
  const removed = pruneArchive(archiveDb, cutoffStr);
  if (removed > 0) console.log(`[archive] pruned ${removed} old day(s) older than ${cutoffStr}`);

  // Falling-behind warning: surface dates that are about to be lost to the
  // 7-day live-DB prune but haven't been archived yet.
  const missing = findFallingBehind(liveDb, archiveDb, new Date());
  if (missing.length > 0) {
    console.warn(
      `[archive] WARNING: ${missing.length} day(s) older than ${WARN_UNARCHIVED_OLDER_THAN_DAYS} days still unarchived: ${missing.join(", ")}. Live DB prune at 7 days will delete these.`,
    );
  }
}

/**
 * Start the in-process archiver: runs an immediate boot-time pass (catching up
 * any missed days) then self-reschedules via setTimeout to fire at the next
 * 00:05 UTC. Returns a stop function for clean shutdown / tests.
 */
export function startArchiver(opts: ArchiverOpts): () => void {
  let timer: number | undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const next = computeNextRunAt(new Date());
    const delay = clampDelay(next.getTime() - Date.now());
    console.log(`[archive] next run at ${next.toISOString()} (in ${Math.round(delay / 1000)}s)`);
    timer = setTimeout(async () => {
      try {
        await runArchivePass(opts);
      } catch (err) {
        console.error("[archive] pass error:", err);
      }
      schedule();
    }, delay);
  };

  // Boot-time pass, then schedule the next one
  runArchivePass(opts)
    .catch((err) => console.error("[archive] boot pass error:", err))
    .then(() => schedule());

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
