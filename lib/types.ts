// lib/types.ts
import type { Reading } from "./databus.ts";

export interface BusFields {
  todayKwh: number;
  peakPower: number;
  peakVoltage: number;
  lifetimeKwh: number;
  victronChargedKwh: number;
  victronDischargedKwh: number;
  victron48vPower: number | null;
  victron48vCurrent: number | null;
  victron48vVoltage: number | null;
  victron48vChargedKwh: number;
}

export type BusMessage =
  | { type: "reading"; reading: Reading }
  | { type: "fields"; fields: Partial<BusFields> };
