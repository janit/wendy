import { assertEquals } from "jsr:@std/assert";
import { DataBus } from "./databus.ts";

function tristar(overrides: Record<string, unknown> = {}) {
  return {
    source: "tristar" as const,
    power: 847, voltage: 52.4, current: 16.2, temp: 34,
    chargeState: "mppt", batteryVoltage: 54.1,
    ...overrides,
  };
}

function victron(overrides: Record<string, unknown> = {}) {
  return {
    source: "victron" as const,
    power: 500, voltage: 26, current: 19, temp: null,
    chargeState: null, batteryVoltage: null,
    ...overrides,
  };
}

Deno.test("DataBus - push and get latest", () => {
  const bus = new DataBus();
  bus.push(tristar());
  const state = bus.latest();
  assertEquals(state.arrayVoltage, 52.4);
  assertEquals(state.batteryVoltage, 54.1);
});

Deno.test("DataBus - mode detection: above 52V = 48v", () => {
  const bus = new DataBus();
  bus.push(tristar({ voltage: 55 }));
  assertEquals(bus.latest().mode, "48v");
});

Deno.test("DataBus - mode detection: below 48V = 24v", () => {
  const bus = new DataBus();
  bus.push(tristar({ voltage: 30 }));
  assertEquals(bus.latest().mode, "24v");
});

Deno.test("DataBus - mode detection: hysteresis retains mode", () => {
  const bus = new DataBus();
  bus.push(tristar({ voltage: 55 }));
  assertEquals(bus.latest().mode, "48v");
  bus.push(tristar({ voltage: 50 }));
  assertEquals(bus.latest().mode, "48v");
  bus.push(tristar({ voltage: 45 }));
  assertEquals(bus.latest().mode, "24v");
});

Deno.test("DataBus - merges victron and tristar data separately", () => {
  const bus = new DataBus();
  bus.push(victron());
  bus.push(tristar());
  const state = bus.latest();
  // TriStar fields
  assertEquals(state.temp, 34);
  assertEquals(state.chargeState, "mppt");
  assertEquals(state.batteryVoltage, 54.1);
  // Victron fields
  assertEquals(state.victronPower, 500);
  assertEquals(state.victronVoltage, 26);
  assertEquals(state.victronCurrent, 19);
});

Deno.test("DataBus - subscribe receives broadcasts", () => {
  const bus = new DataBus();
  const received: unknown[] = [];
  const unsub = bus.subscribe((s) => received.push(s));
  bus.push(tristar());
  bus.push(tristar({ power: 900 }));
  unsub();
  bus.push(tristar({ power: 1000 }));
  assertEquals(received.length, 2);
});

Deno.test("DataBus - drainBuffer returns and clears buffered samples", () => {
  const bus = new DataBus();
  bus.push(tristar());
  bus.push(victron());
  const buffer = bus.drainBuffer();
  assertEquals(buffer.length, 2);
  assertEquals(bus.drainBuffer().length, 0);
});

Deno.test("DataBus - onPush fires with raw reading", () => {
  const bus = new DataBus();
  const received: unknown[] = [];
  bus.onPush((r) => received.push(r));
  const reading = tristar();
  bus.push(reading);
  assertEquals(received.length, 1);
  assertEquals(received[0], reading);
});

Deno.test("DataBus - onPush unsubscribe stops callback", () => {
  const bus = new DataBus();
  const received: unknown[] = [];
  const unsub = bus.onPush((r) => received.push(r));
  bus.push(tristar());
  unsub();
  bus.push(tristar());
  assertEquals(received.length, 1);
});

Deno.test("DataBus - setFields updates properties", () => {
  const bus = new DataBus();
  bus.setFields({ peakPower: 1200, peakVoltage: 55.0 });
  assertEquals(bus.peakPower, 1200);
  assertEquals(bus.peakVoltage, 55.0);
});

Deno.test("DataBus - setFields only updates provided fields", () => {
  const bus = new DataBus();
  bus.setFields({ peakPower: 500 });
  bus.setFields({ peakVoltage: 55 });
  assertEquals(bus.peakPower, 500);
  assertEquals(bus.peakVoltage, 55);
});

Deno.test("DataBus - onFields fires on setFields", () => {
  const bus = new DataBus();
  const received: unknown[] = [];
  bus.onFields((f) => received.push(f));
  bus.setFields({ peakVoltage: 25.8 });
  assertEquals(received.length, 1);
  assertEquals(received[0], { peakVoltage: 25.8 });
});

Deno.test("DataBus - onFields unsubscribe stops callback", () => {
  const bus = new DataBus();
  const received: unknown[] = [];
  const unsub = bus.onFields((f) => received.push(f));
  bus.setFields({ peakPower: 100 });
  unsub();
  bus.setFields({ peakPower: 200 });
  assertEquals(received.length, 1);
});
