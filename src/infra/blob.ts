export function bufferToBlobPart(buf: Buffer): Uint8Array<ArrayBuffer> {
  // Node's `Blob` accepts `Buffer` at runtime, but TypeScript's DOM typings
  // expect an ArrayBuffer-backed view. Node Buffers are backed by ArrayBuffer,
  // so this cast is safe.
  return buf as unknown as Uint8Array<ArrayBuffer>;
}
