import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

interface Status {
  synced: boolean;
  syncMode: boolean;
  height: number | null;
  peers: number;
  mempoolSize: number;
}

export default function ChiaStatus() {
  const status = useSignal<Status | null>(null);
  const error = useSignal<string | null>(null);

  const hidden = useSignal(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/chia");
        if (res.status === 404) {
          hidden.value = true;
          return;
        }
        if (res.ok) {
          status.value = await res.json();
          error.value = null;
        } else {
          const body = await res.json().catch(() => ({}));
          error.value = body.error ?? `HTTP ${res.status}`;
        }
      } catch (e) {
        error.value = e instanceof Error ? e.message : "fetch failed";
      }
    };

    poll();
    const id = setInterval(poll, 5_000);
    return () => clearInterval(id);
  }, []);

  const s = status.value;

  const syncLabel = s
    ? s.synced
      ? "Synced"
      : s.syncMode
        ? "Syncing…"
        : "Not Synced"
    : null;

  const dotColor = s
    ? s.synced
      ? "var(--accent-green)"
      : "var(--text-label)"
    : "var(--text-label)";

  if (hidden.value) return null;

  return (
    <div class="chia-card">
      <div class="chia-title">
        <span>CHIA FULL NODE</span>
        <span class="chia-dot" style={`background:${dotColor}`} />
        <span class="chia-sync">{error.value ? "Offline" : syncLabel ?? "…"}</span>
      </div>
      {s && !error.value ? (
        <div class="chia-stats">
          <div>
            <span class="chia-val">{s.height != null ? s.height.toLocaleString() : "—"}</span>
            <span class="chia-label">HEIGHT</span>
          </div>
          <div>
            <span class="chia-val">{s.peers}</span>
            <span class="chia-label">PEERS</span>
          </div>
          <div>
            <span class="chia-val">{s.mempoolSize}</span>
            <span class="chia-label">MEMPOOL</span>
          </div>
        </div>
      ) : error.value ? (
        <div class="chia-error">{error.value}</div>
      ) : null}
    </div>
  );
}
