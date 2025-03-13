import BN from "bn.js";

/**
 * Encodes a 32-bit unsigned integer.
 */
export function encodeU32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

/**
 * Encodes a 64-bit unsigned integer.
 */
export function encodeU64(value: number): Buffer {
  return new BN(value).toArrayLike(Buffer, "le", 8);
}

/**
 * Encodes a string with a prefixed length.
 */
export function encodeString(str: string): Buffer {
  const buffer = Buffer.from(str, "utf-8");
  const lengthBuffer = encodeU32(buffer.length);
  return Buffer.concat([lengthBuffer, buffer]);
}
