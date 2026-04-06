import type { DataBus } from "./databus.ts";
import type { BusMessage } from "./types.ts";

function appendToken(base: string, token: string): string {
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

export function startWsClient(bus: DataBus, url: string, secret?: string): () => void {
  let ws: WebSocket | null = null;
  let backoff = 1000;
  let stopped = false;
  let reconnectTimer: number | undefined;
  const MAX_BACKOFF = 30_000;

  // Append token to URL if secret is provided
  const connectUrl = secret ? appendToken(url, secret) : url;

  function send(msg: BusMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  const unsubPush = bus.onPush((reading) => {
    send({ type: "reading", reading });
  });

  const unsubFields = bus.onFields((fields) => {
    send({ type: "fields", fields });
  });

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(connectUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log(`[ws-client] connected to ${url}`);
      backoff = 1000;
    };

    ws.onclose = () => {
      ws = null;
      if (!stopped) {
        console.log(`[ws-client] disconnected, reconnecting in ${backoff}ms`);
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function scheduleReconnect() {
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  }

  connect();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    unsubPush();
    unsubFields();
    ws?.close();
  };
}
