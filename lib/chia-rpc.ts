const CHIA_HOST = Deno.env.get("CHIA_RPC_HOST") ?? "127.0.0.1";
const CHIA_PORT = Deno.env.get("CHIA_RPC_PORT") ?? "8555";
const CERT_DIR = Deno.env.get("CHIA_CERT_DIR") ?? "/app/data/chia-ssl";

async function rpc(endpoint: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const cmd = new Deno.Command("curl", {
    args: [
      "--insecure",
      "--cert", `${CERT_DIR}/private_full_node.crt`,
      "--key", `${CERT_DIR}/private_full_node.key`,
      "--connect-timeout", "5",
      "--max-time", "10",
      "-s",
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify(body),
      `https://${CHIA_HOST}:${CHIA_PORT}/${endpoint}`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(`Chia RPC ${endpoint}: curl exit ${code}: ${err}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout));
}

export interface ChiaStatus {
  synced: boolean;
  syncMode: boolean;
  height: number | null;
  peers: number;
  mempoolSize: number;
}

export async function getChiaStatus(): Promise<ChiaStatus> {
  const [stateRes, connRes] = await Promise.all([
    rpc("get_blockchain_state"),
    rpc("get_connections"),
  ]) as [
    { success: boolean; blockchain_state: { sync: { synced: boolean; sync_mode: boolean }; peak: { height: number } | null; mempool_size: number } },
    { success: boolean; connections: { type: number }[] },
  ];

  const bs = stateRes.blockchain_state;
  const fullNodePeers = connRes.connections.filter((c) => c.type === 1);

  return {
    synced: bs.sync.synced,
    syncMode: bs.sync.sync_mode,
    height: bs.peak?.height ?? null,
    peers: fullNodePeers.length,
    mempoolSize: bs.mempool_size,
  };
}
