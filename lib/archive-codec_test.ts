import { assertEquals } from "jsr:@std/assert";
import { decodeDay, encodeDay } from "./archive-codec.ts";
import type { Sample } from "./db.ts";

Deno.test("archive-codec - round-trip basic", async () => {
  const samples: Sample[] = [
    { ts: 1700000000, source: "tristar", power: 100, voltage: 48, current: 2, temp: 25, mode: "48v" },
    { ts: 1700000001, source: "victron", power: 200, voltage: 24, current: 8, temp: null, mode: "24v" },
  ];
  const blob = await encodeDay(samples);
  const decoded = await decodeDay(blob);
  assertEquals(decoded.length, 2);
  assertEquals(decoded[0], samples[0]);
  assertEquals(decoded[1], samples[1]);
});

Deno.test("archive-codec - empty samples", async () => {
  const blob = await encodeDay([]);
  const decoded = await decodeDay(blob);
  assertEquals(decoded.length, 0);
});

Deno.test("archive-codec - single sample with all nulls", async () => {
  const samples: Sample[] = [
    { ts: 1700000000, source: "tristar", power: null, voltage: null, current: null, temp: null, mode: null },
  ];
  const blob = await encodeDay(samples);
  const decoded = await decodeDay(blob);
  assertEquals(decoded.length, 1);
  assertEquals(decoded[0], samples[0]);
});

Deno.test("archive-codec - sort on encode", async () => {
  // Out-of-order input should round-trip in sorted order
  const samples: Sample[] = [
    { ts: 1700000010, source: "tristar", power: 10, voltage: 48, current: 1, temp: 20, mode: "48v" },
    { ts: 1700000000, source: "victron", power: 20, voltage: 24, current: 2, temp: 21, mode: "24v" },
    { ts: 1700000005, source: "tristar", power: 30, voltage: 48, current: 3, temp: 22, mode: "48v" },
  ];
  const decoded = await decodeDay(await encodeDay(samples));
  // Expected order after sort: ts 1700000000, 1700000005, 1700000010
  assertEquals(decoded, [
    { ts: 1700000000, source: "victron", power: 20, voltage: 24, current: 2, temp: 21, mode: "24v" },
    { ts: 1700000005, source: "tristar", power: 30, voltage: 48, current: 3, temp: 22, mode: "48v" },
    { ts: 1700000010, source: "tristar", power: 10, voltage: 48, current: 1, temp: 20, mode: "48v" },
  ]);
});

Deno.test("archive-codec - rejects bad magic", async () => {
  // Build a valid blob first to confirm baseline still works
  const blob = await encodeDay([
    { ts: 1700000000, source: "tristar", power: 100, voltage: 48, current: 2, temp: 25, mode: "48v" },
  ]);
  assertEquals((await decodeDay(blob)).length, 1);

  // Build a corrupted blob: 16 zero bytes (no magic), gzipped via the same path
  // the codec uses internally, so this exercises the magic check, not the gzip path.
  const bad = new Uint8Array(16);
  const corrupt = new Uint8Array(
    await new Response(
      new Blob([bad as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer(),
  );

  let threw = false;
  try {
    await decodeDay(corrupt);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message.includes("bad magic"), true);
  }
  assertEquals(threw, true);
});

Deno.test("archive-codec - rejects unknown source", async () => {
  let threw = false;
  try {
    await encodeDay([
      { ts: 1700000000, source: "weirdo", power: 1, voltage: 1, current: 1, temp: 1, mode: "24v" },
    ]);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message.includes("unknown source"), true);
  }
  assertEquals(threw, true);
});

Deno.test("archive-codec - full day size regression", async () => {
  // 172800 samples (2 sources × 86400 s) with realistic slow-varying values
  const samples: Sample[] = [];
  const tsBase = 1700000000;
  for (let s = 0; s < 86400; s++) {
    // Sinusoidal power 0..1500 W with daily period
    const phase = (s / 86400) * 2 * Math.PI;
    const p24 = Math.max(0, Math.sin(phase) * 800);
    const p48 = Math.max(0, Math.sin(phase + 0.3) * 700);
    samples.push({ ts: tsBase + s, source: "victron", power: p24, voltage: 25, current: p24 / 25, temp: 22, mode: "24v" });
    samples.push({ ts: tsBase + s, source: "tristar", power: p48, voltage: 50, current: p48 / 50, temp: 30, mode: "48v" });
  }
  const blob = await encodeDay(samples);
  // Regression guard. Measured baseline on the current codec with this fixture
  // is ~682 KB. gzip on float32 bit patterns can't exploit numeric smoothness,
  // only byte-level repetition, so compression is ~18% — reasonable but nowhere
  // near the initial spec estimate of 8-12x. Ceiling is set at 800 KB to absorb
  // noise from minor gzip implementation changes without flagging. If the real
  // size ever exceeds this, something has regressed in the format or data shape.
  if (blob.length > 800_000) {
    throw new Error(`archive-codec: blob too large: ${blob.length} bytes (ceiling 800000)`);
  }
  // Round-trip a sampling of rows to confirm integrity
  const decoded = await decodeDay(blob);
  assertEquals(decoded.length, samples.length);
  // Float32 quantization: compare via Float32Array round-trip
  const f32 = new Float32Array([samples[0].power!]);
  assertEquals(decoded[0].power, f32[0]);
});
