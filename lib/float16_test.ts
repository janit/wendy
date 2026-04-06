import { assertEquals } from "jsr:@std/assert";
import { decodeFloat16 } from "./float16.ts";

Deno.test("decodeFloat16 - zero", () => {
  assertEquals(decodeFloat16(0x0000), 0);
});

Deno.test("decodeFloat16 - one", () => {
  assertEquals(decodeFloat16(0x3C00), 1);
});

Deno.test("decodeFloat16 - negative one", () => {
  assertEquals(decodeFloat16(0xBC00), -1);
});

Deno.test("decodeFloat16 - typical voltage 52.4V", () => {
  const val = decodeFloat16(0x5290);
  assertEquals(val > 52 && val < 53, true);
});

Deno.test("decodeFloat16 - small current 16.2A", () => {
  const val = decodeFloat16(0x4C0C);
  assertEquals(val > 16 && val < 16.5, true);
});

Deno.test("decodeFloat16 - NaN", () => {
  assertEquals(Number.isNaN(decodeFloat16(0x7E00)), true);
});

Deno.test("decodeFloat16 - infinity", () => {
  assertEquals(decodeFloat16(0x7C00), Infinity);
});

Deno.test("decodeFloat16 - negative infinity", () => {
  assertEquals(decodeFloat16(0xFC00), -Infinity);
});

Deno.test("decodeFloat16 - subnormal (very small)", () => {
  const val = decodeFloat16(0x0001);
  assertEquals(val > 0 && val < 0.001, true);
});
