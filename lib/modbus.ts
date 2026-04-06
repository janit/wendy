import ModbusRTUModule from "modbus-serial";
// deno-lint-ignore no-explicit-any
const ModbusRTU = (ModbusRTUModule as any).default ?? ModbusRTUModule;
import { decodeFloat16 } from "./float16.ts";
import type { DataBus } from "./databus.ts";
import type { BusFields } from "./types.ts";

// TriStar 600V register addresses (input registers, FC4)
// Docs use 1-based numbering; readInputRegisters is 0-based → subtract 1
const REG = {
  BATTERY_VOLTAGE: 24,  // doc: 25
  ARRAY_VOLTAGE: 27,    // doc: 28 (HA used 27 — correct)
  ARRAY_CURRENT: 29,    // doc: 30 (HA used 29 — correct)
  HEATSINK_TEMP: 35,    // doc: 36 (HA used 35 — correct)
  CHARGE_STATE: 50,     // doc: 51
  KWH_TOTAL: 57,        // doc: 58
  POWER_OUT: 59,        // doc: 60
  VA_MAX_DAILY: 66,     // doc: 67
  WHC_DAILY: 68,        // doc: 69
};

const CHARGE_STATES: Record<number, string> = {
  0: "start", 1: "night_check", 2: "disconnect", 3: "night",
  4: "fault", 5: "mppt", 6: "absorption", 7: "float",
  8: "equalize", 9: "slave", 10: "fixed",
};

interface ModbusConfig {
  host: string;
  port: number;
  slaveId: number;
  pollIntervalMs: number;
}

export async function startModbus(bus: DataBus, config: ModbusConfig): Promise<{ stop: () => void }> {
  const client = new ModbusRTU();

  async function connect() {
    try {
      await client.connectTCP(config.host, { port: config.port });
      client.setID(config.slaveId);
      client.setTimeout(5000);
      console.log(`[modbus] connected to ${config.host}:${config.port}`);
    } catch (err) {
      console.error("[modbus] connection failed:", err);
      throw err;
    }
  }

  await connect();

  async function poll() {
    try {
      // Batch 1: regs 24-35 (0-based), covering battery voltage through heatsink temp
      const batch1 = await client.readInputRegisters(REG.BATTERY_VOLTAGE, 12);
      // Batch 2: regs 50-59 (0-based), covering charge state through power out
      const batch2 = await client.readInputRegisters(REG.CHARGE_STATE, 10);
      // Batch 3: regs 66-68 (0-based), covering daily max voltage and daily energy
      const batch3 = await client.readInputRegisters(REG.VA_MAX_DAILY, 3);

      const batteryVoltage = decodeFloat16(batch1.data[0]);                                    // reg 24
      const arrayVoltage = decodeFloat16(batch1.data[REG.ARRAY_VOLTAGE - REG.BATTERY_VOLTAGE]); // reg 27
      const arrayCurrent = decodeFloat16(batch1.data[REG.ARRAY_CURRENT - REG.BATTERY_VOLTAGE]); // reg 29
      const heatsinkTemp = decodeFloat16(batch1.data[REG.HEATSINK_TEMP - REG.BATTERY_VOLTAGE]); // reg 35

      const chargeStateRaw = batch2.data[0];                                                    // reg 50
      const kwhTotal = decodeFloat16(batch2.data[REG.KWH_TOTAL - REG.CHARGE_STATE]);            // reg 57
      const powerOut = decodeFloat16(batch2.data[REG.POWER_OUT - REG.CHARGE_STATE]);             // reg 59

      const vaMaxDaily = decodeFloat16(batch3.data[0]);                                          // reg 66
      const whcDaily = decodeFloat16(batch3.data[REG.WHC_DAILY - REG.VA_MAX_DAILY]);             // reg 68

      const chargeState = CHARGE_STATES[chargeStateRaw] ?? `unknown(${chargeStateRaw})`;

      const fields: Partial<BusFields> = {
        peakVoltage: vaMaxDaily,
      };
      if (powerOut > bus.peakPower) fields.peakPower = powerOut;
      if (kwhTotal > 0) fields.lifetimeKwh = kwhTotal;
      bus.setFields(fields);

      bus.push({
        source: "tristar",
        power: Math.max(0, powerOut),
        voltage: Math.max(0, arrayVoltage),
        current: Math.max(0, arrayCurrent),
        temp: heatsinkTemp,
        chargeState,
        batteryVoltage,
      });
    } catch (err) {
      console.error("[modbus] poll error:", err);
      try { await connect(); } catch { /* retry next cycle */ }
    }
  }

  const timer = setInterval(poll, config.pollIntervalMs);
  await poll();

  return {
    stop() {
      clearInterval(timer);
      client.close(() => console.log("[modbus] closed"));
    },
  };
}
