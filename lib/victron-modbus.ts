import ModbusRTUModule from "modbus-serial";
// deno-lint-ignore no-explicit-any
const ModbusRTU = (ModbusRTUModule as any).default ?? ModbusRTUModule;
import type { DataBus } from "./databus.ts";
import type { BusFields } from "./types.ts";

// Victron GX Modbus TCP register addresses
// Source: https://github.com/victronenergy/dbus_modbustcp

// com.victronenergy.battery registers (Wind Control BMV-700, 24V side)
const BAT_UNIT = 239;
const BAT_REG = {
  VOLTAGE: 259,        // uint16, /100 → V
  CURRENT: 261,        // int16, /10 → A
  CHARGED_KWH: 280,    // uint32, /100 → kWh
  DISCHARGED_KWH: 282, // uint32, /100 → kWh
};

// com.victronenergy.dcsource registers (Wind Turbine SmartShunt, 48V side)
const DC_UNIT = 223;
const DC_REG = {
  VOLTAGE: 4200,     // uint16, /100 → V
  CURRENT: 4201,     // int16, /10 → A
  ENERGY_OUT: 4204,  // uint32, /100 → kWh
};

function toInt16(v: number): number {
  return v > 32767 ? v - 65536 : v;
}

interface VictronModbusConfig {
  host: string;
  port: number;
  pollIntervalMs: number;
}

function createPoller(
  name: string,
  host: string,
  port: number,
  unitId: number,
  pollFn: (client: InstanceType<typeof ModbusRTU>) => Promise<void>,
  intervalMs: number,
): { stop: () => void } {
  const client = new ModbusRTU();
  let connected = false;

  async function connect() {
    try {
      if (connected) {
        try { client.close(() => {}); } catch { /* ignore */ }
      }
      connected = false;
      await client.connectTCP(host, { port });
      client.setID(unitId);
      client.setTimeout(5000);
      connected = true;
      console.log(`[victron-modbus] ${name} connected to ${host}:${port} unit ${unitId}`);
    } catch (err) {
      console.error(`[victron-modbus] ${name} connection failed:`, err);
    }
  }

  async function poll() {
    if (!connected) {
      await connect();
      return;
    }
    try {
      await pollFn(client);
    } catch (err) {
      console.error(`[victron-modbus] ${name} poll error:`, err);
      connected = false;
    }
  }

  // Start immediately, don't block
  connect().then(() => poll());
  const timer = setInterval(poll, intervalMs);

  return {
    stop() {
      clearInterval(timer);
      try { client.close(() => console.log(`[victron-modbus] ${name} closed`)); } catch { /* */ }
    },
  };
}

export function startVictronModbus(
  bus: DataBus,
  config: VictronModbusConfig,
): { stop: () => void } {
  const stops: (() => void)[] = [];

  // 24V Wind Control (separate connection)
  try {
    const p = createPoller("24V", config.host, config.port, BAT_UNIT, async (client) => {
      const batch = await client.readHoldingRegisters(BAT_REG.VOLTAGE, 4);
      const voltage = batch.data[0] / 100;
      const current = toInt16(batch.data[2]) / 10;
      const power = voltage * current;

      try {
        // Read both charged (280) and discharged (282) — 4 contiguous registers
        const hist = await client.readHoldingRegisters(BAT_REG.CHARGED_KWH, 4);
        const charged = ((hist.data[0] << 16) | hist.data[1]) / 100;
        const discharged = ((hist.data[2] << 16) | hist.data[3]) / 100;
        bus.setFields({ victronChargedKwh: charged, victronDischargedKwh: discharged });
      } catch { /* registers not available */ }

      bus.push({
        source: "victron",
        power, voltage, current,
        temp: null, chargeState: null, batteryVoltage: null,
      });
    }, config.pollIntervalMs);
    stops.push(p.stop);
  } catch (err) {
    console.error("[victron-modbus] 24V failed to start:", err);
  }

  // 48V Wind Turbine (separate connection, stagger by 2s to avoid GX connection race)
  setTimeout(() => { try {
    const p = createPoller("48V", config.host, config.port, DC_UNIT, async (client) => {
      const batch = await client.readHoldingRegisters(DC_REG.VOLTAGE, 2);
      const voltage = batch.data[0] / 100;
      const current = toInt16(batch.data[1]) / 10;
      const power = voltage * current;

      bus.setFields({ victron48vPower: power, victron48vCurrent: current, victron48vVoltage: voltage });

      try {
        const hist = await client.readHoldingRegisters(DC_REG.ENERGY_OUT, 2);
        bus.setFields({ victron48vChargedKwh: ((hist.data[0] << 16) | hist.data[1]) / 100 });
      } catch { /* not available */ }
    }, config.pollIntervalMs);
    stops.push(p.stop);
  } catch (err) {
    console.error("[victron-modbus] 48V failed to start:", err);
  } }, 2000);

  return {
    stop() { stops.forEach((s) => s()); },
  };
}
