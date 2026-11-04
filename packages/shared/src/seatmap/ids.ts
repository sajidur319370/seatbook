/** 24-hex id, valid as a MongoDB ObjectId. Works in the browser and Node (globalThis.crypto). */
export function newId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
