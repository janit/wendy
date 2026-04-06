/**
 * Decode an IEEE 754 half-precision (16-bit) float from a raw uint16 register value.
 * Used for TriStar 600V Modbus registers.
 *
 * Format: 1 sign bit | 5 exponent bits | 10 mantissa bits
 */
export function decodeFloat16(raw: number): number {
  const sign = (raw >> 15) & 0x1;
  const exponent = (raw >> 10) & 0x1F;
  const mantissa = raw & 0x3FF;

  let value: number;

  if (exponent === 0) {
    value = (mantissa / 1024) * Math.pow(2, -14);
  } else if (exponent === 31) {
    return mantissa === 0
      ? (sign ? -Infinity : Infinity)
      : NaN;
  } else {
    value = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
  }

  return sign ? -value : value;
}
