import { assertEquals } from "jsr:@std/assert";
import { DataBus } from "./databus.ts";
import { startWsClient } from "./ws-client.ts";
import type { BusMessage } from "./types.ts";

function tristar() {
  return {
    source: "tristar" as const,
    power: 847, voltage: 52.4, current: 16.2, temp: 34,
    chargeState: "mppt", batteryVoltage: 54.1,
  };
}

Deno.test("ws-client forwards readings and fields", async () => {
  const received: BusMessage[] = [];

  // Start a test WebSocket server
  const server = Deno.serve({ port: 0, onListen() {} }, (req) => {
    const { response, socket } = Deno.upgradeWebSocket(req);
    socket.onmessage = (e) => received.push(JSON.parse(e.data));
    return response;
  });

  const addr = server.addr as Deno.NetAddr;
  const url = `ws://localhost:${addr.port}`;

  const bus = new DataBus();
  const stop = startWsClient(bus, url);

  // Wait for connection
  await new Promise((r) => setTimeout(r, 200));

  // Push a reading
  bus.push(tristar());

  // Set fields
  bus.setFields({ peakPower: 1200, peakVoltage: 55.0 });

  // Wait for messages to arrive
  await new Promise((r) => setTimeout(r, 200));

  stop();
  await server.shutdown();

  assertEquals(received.length, 2);
  assertEquals(received[0].type, "reading");
  assertEquals(received[1].type, "fields");
  if (received[1].type === "fields") {
    assertEquals(received[1].fields.peakPower, 1200);
    assertEquals(received[1].fields.peakVoltage, 55.0);
  }
});

Deno.test("ws-client sends token in URL when secret provided", async () => {
  let receivedUrl = "";

  const server = Deno.serve({ port: 0, onListen() {} }, (req) => {
    receivedUrl = req.url;
    const { response, socket } = Deno.upgradeWebSocket(req);
    socket.onopen = () => socket.close();
    return response;
  });

  const addr = server.addr as Deno.NetAddr;
  const url = `ws://localhost:${addr.port}/api/ingest`;

  const bus = new DataBus();
  const stop = startWsClient(bus, url, "test-secret-123");

  await new Promise((r) => setTimeout(r, 200));

  stop();
  await server.shutdown();

  const parsed = new URL(receivedUrl);
  assertEquals(parsed.searchParams.get("token"), "test-secret-123");
});

Deno.test("ws-client drops messages when disconnected", async () => {
  const bus = new DataBus();
  // Connect to a port where nothing is listening
  const stop = startWsClient(bus, "ws://localhost:19999");

  // Push — should not throw
  bus.push(tristar());
  bus.setFields({ peakPower: 500 });

  // Give it a moment to attempt connection
  await new Promise((r) => setTimeout(r, 500));
  stop();
});
