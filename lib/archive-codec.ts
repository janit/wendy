import type { Sample } from "./db.ts";

/** Format discriminator stored alongside each archived day. Bump when layout changes. */
export const ARCHIVE_FORMAT = "gzip-cols-v1";

const MAGIC = new TextEncoder().encode("WA01"); // 4 bytes
const SOURCE_IDS: Record<string, number> = { tristar: 0, victron: 1 };
const SOURCE_NAMES = ["tristar", "victron"];
const MODE_IDS: Record<string, number> = { "24v": 0, "48v": 1 };
const MODE_NAMES = ["24v", "48v"];
const NULL_MODE = 255;

export async function encodeDay(samples: Sample[]): Promise<Uint8Array> {
  // Sort by ts so deltas are non-negative
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  const n = sorted.length;
  if (n > 0xffff_ffff) {
    throw new Error(`archive-codec: row_count ${n} exceeds uint32`);
  }
  const tsBase = n > 0 ? sorted[0].ts : 0;

  // Header: magic(4) + row_count(4) + ts_base(8) = 16 bytes
  // Body per row: ts_delta(4) + source(1) + mode(1) + power(4) + voltage(4) + current(4) + temp(4) = 22 bytes
  const buf = new Uint8Array(16 + n * 22);
  const view = new DataView(buf.buffer);

  buf.set(MAGIC, 0);
  view.setUint32(4, n, true);
  view.setBigInt64(8, BigInt(tsBase), true);

  let offset = 16;

  // ts_deltas: n × uint32 LE
  for (let i = 0; i < n; i++) {
    view.setUint32(offset, sorted[i].ts - tsBase, true);
    offset += 4;
  }
  // source_ids: n × uint8
  for (let i = 0; i < n; i++) {
    const id = SOURCE_IDS[sorted[i].source];
    if (id === undefined) throw new Error(`archive-codec: unknown source "${sorted[i].source}"`);
    buf[offset++] = id;
  }
  // mode_ids: n × uint8 (255 = null)
  for (let i = 0; i < n; i++) {
    const m = sorted[i].mode;
    if (m == null) {
      buf[offset++] = NULL_MODE;
    } else {
      const id = MODE_IDS[m];
      if (id === undefined) throw new Error(`archive-codec: unknown mode "${m}"`);
      buf[offset++] = id;
    }
  }
  // 4× float32 LE (NaN = null sentinel)
  for (let i = 0; i < n; i++) {
    view.setFloat32(offset, sorted[i].power ?? NaN, true);
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    view.setFloat32(offset, sorted[i].voltage ?? NaN, true);
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    view.setFloat32(offset, sorted[i].current ?? NaN, true);
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    view.setFloat32(offset, sorted[i].temp ?? NaN, true);
    offset += 4;
  }

  return await gzip(buf);
}

export async function decodeDay(blob: Uint8Array): Promise<Sample[]> {
  const buf = await gunzip(blob);
  if (buf.length < 16) throw new Error("archive-codec: blob too short");
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) throw new Error("archive-codec: bad magic");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = view.getUint32(4, true);
  const tsBase = Number(view.getBigInt64(8, true));

  const expected = 16 + n * 22;
  if (buf.length !== expected) {
    throw new Error(
      `archive-codec: length mismatch, expected ${expected} bytes for ${n} rows, got ${buf.length}`
    );
  }

  const samples: Sample[] = new Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = { ts: 0, source: "", power: null, voltage: null, current: null, temp: null, mode: null };
  }

  let offset = 16;
  for (let i = 0; i < n; i++) {
    samples[i].ts = tsBase + view.getUint32(offset, true);
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    const id = buf[offset++];
    if (id >= SOURCE_NAMES.length) throw new Error(`archive-codec: unknown source id ${id}`);
    samples[i].source = SOURCE_NAMES[id];
  }
  for (let i = 0; i < n; i++) {
    const id = buf[offset++];
    if (id === NULL_MODE) {
      samples[i].mode = null;
    } else if (id < MODE_NAMES.length) {
      samples[i].mode = MODE_NAMES[id];
    } else {
      throw new Error(`archive-codec: unknown mode id ${id}`);
    }
  }
  for (let i = 0; i < n; i++) {
    const v = view.getFloat32(offset, true);
    samples[i].power = isNaN(v) ? null : v;
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    const v = view.getFloat32(offset, true);
    samples[i].voltage = isNaN(v) ? null : v;
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    const v = view.getFloat32(offset, true);
    samples[i].current = isNaN(v) ? null : v;
    offset += 4;
  }
  for (let i = 0; i < n; i++) {
    const v = view.getFloat32(offset, true);
    samples[i].temp = isNaN(v) ? null : v;
    offset += 4;
  }

  return samples;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  // Wrap the input bytes in a Blob so we can use its .stream() method as the
  // source for CompressionStream. This gives correct backpressure handling for
  // large (~MB) inputs without manual writer/reader plumbing. The `as BlobPart`
  // cast sidesteps a strict-lib.dom typing quirk where Uint8Array<ArrayBufferLike>
  // is not assignable to BlobPart (which expects Uint8Array<ArrayBuffer>).
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
