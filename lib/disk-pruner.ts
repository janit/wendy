import { Database } from "@db/sqlite";

export interface WendyPrunerOptions {
  minFreeGb: number;              // default 10
  minArchiveRetentionDays: number; // default 30 — don't prune below this many archive days
  checkIntervalMin: number;       // default 360 (6 hours — archive changes slowly)
  vacuumAfter: boolean;           // default true
}

export interface WendyPruneResult {
  freeBytesBefore: number;
  freeBytesAfter: number;
  daysDeleted: number;
  oldestDateBefore: string | null;
  oldestDateAfter: string | null;
  vacuumed: boolean;
  reachedRetentionFloor: boolean;
  reason: "ok" | "disabled" | "no-data" | "all-above-floor" | "pruned";
}

export async function getFreeDiskBytes(path: string): Promise<number> {
  try {
    const cmd = new Deno.Command("df", {
      args: ["--output=avail", "-B1", path],
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return Infinity;
    const text = new TextDecoder().decode(stdout).trim();
    const lines = text.split("\n");
    if (lines.length < 2) return Infinity;
    const n = parseInt(lines[1].trim(), 10);
    return Number.isFinite(n) ? n : Infinity;
  } catch {
    return Infinity;
  }
}

export async function pruneArchiveIfLowDisk(
  archiveDb: Database,
  archiveDbPath: string,
  opts: WendyPrunerOptions,
): Promise<WendyPruneResult> {
  const thresholdBytes = opts.minFreeGb * 1024 * 1024 * 1024;
  const freeBefore = await getFreeDiskBytes(archiveDbPath);

  const oldestRow = archiveDb.prepare("SELECT MIN(date) as d FROM archive_day").get<{ d: string | null }>();
  const oldestDateBefore = oldestRow?.d ?? null;
  const newestRow = archiveDb.prepare("SELECT MAX(date) as d FROM archive_day").get<{ d: string | null }>();
  const newestDate = newestRow?.d ?? null;

  if (freeBefore >= thresholdBytes) {
    return {
      freeBytesBefore: freeBefore,
      freeBytesAfter: freeBefore,
      daysDeleted: 0,
      oldestDateBefore,
      oldestDateAfter: oldestDateBefore,
      vacuumed: false,
      reachedRetentionFloor: false,
      reason: "ok",
    };
  }

  if (!oldestDateBefore || !newestDate) {
    return {
      freeBytesBefore: freeBefore,
      freeBytesAfter: freeBefore,
      daysDeleted: 0,
      oldestDateBefore: null,
      oldestDateAfter: null,
      vacuumed: false,
      reachedRetentionFloor: false,
      reason: "no-data",
    };
  }

  // Retention floor: don't delete anything newer than (newest - minRetentionDays)
  const newestMs = new Date(newestDate + "T00:00:00Z").getTime();
  const floorMs = newestMs - opts.minArchiveRetentionDays * 86400 * 1000;
  const floorDate = new Date(floorMs).toISOString().slice(0, 10);

  console.log(
    `[archive-pruner] free=${(freeBefore / 1e9).toFixed(2)}GB below threshold=${opts.minFreeGb}GB, ` +
    `retention floor date=${floorDate}`,
  );

  let totalDeleted = 0;
  let reachedFloor = false;
  const maxIterations = 400; // safety: archive has at most ~365 entries

  for (let i = 0; i < maxIterations; i++) {
    const current = archiveDb.prepare("SELECT MIN(date) as d FROM archive_day").get<{ d: string | null }>()?.d;
    if (!current) break;
    if (current >= floorDate) {
      reachedFloor = true;
      break;
    }
    // Delete one oldest day at a time
    const res = archiveDb.prepare("DELETE FROM archive_day WHERE date = ?").run(current);
    const deleted = Number(res);
    if (deleted === 0) break;
    totalDeleted += deleted;

    // Re-check disk every 5 days of deletion
    if ((i + 1) % 5 === 0) {
      const free = await getFreeDiskBytes(archiveDbPath);
      if (free >= thresholdBytes) break;
    }
  }

  let vacuumed = false;
  if (totalDeleted > 0 && opts.vacuumAfter) {
    try {
      console.log(`[archive-pruner] deleted ${totalDeleted} archive day(s), running VACUUM`);
      archiveDb.exec("VACUUM");
      vacuumed = true;
    } catch (err) {
      console.error("[archive-pruner] VACUUM failed:", err);
    }
  }

  const freeAfter = await getFreeDiskBytes(archiveDbPath);
  const oldestAfterRow = archiveDb.prepare("SELECT MIN(date) as d FROM archive_day").get<{ d: string | null }>();
  const oldestDateAfter = oldestAfterRow?.d ?? null;

  if (totalDeleted === 0 && reachedFloor) {
    console.warn(
      `[archive-pruner] disk still low (${(freeAfter / 1e9).toFixed(2)}GB free) but retention floor reached`,
    );
  } else if (totalDeleted > 0) {
    console.log(
      `[archive-pruner] done: deleted ${totalDeleted} day(s), free ${(freeBefore / 1e9).toFixed(2)}GB → ${(freeAfter / 1e9).toFixed(2)}GB, vacuumed=${vacuumed}`,
    );
  }

  return {
    freeBytesBefore: freeBefore,
    freeBytesAfter: freeAfter,
    daysDeleted: totalDeleted,
    oldestDateBefore,
    oldestDateAfter,
    vacuumed,
    reachedRetentionFloor: reachedFloor,
    reason: totalDeleted > 0 ? "pruned" : "all-above-floor",
  };
}

export function startWendyDiskPruner(
  archiveDb: Database,
  archiveDbPath: string,
  opts: WendyPrunerOptions,
): () => void {
  let stopped = false;
  let timer: number | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await pruneArchiveIfLowDisk(archiveDb, archiveDbPath, opts);
    } catch (err) {
      console.error("[archive-pruner] pass failed:", err);
    }
    if (!stopped) {
      timer = setTimeout(tick, opts.checkIntervalMin * 60 * 1000);
    }
  };

  tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
