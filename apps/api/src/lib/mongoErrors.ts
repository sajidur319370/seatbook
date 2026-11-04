export function isDuplicateKey(err: unknown, indexName?: string): boolean {
  const e = err as { code?: number; message?: string };
  return e?.code === 11000 && (!indexName || (e.message ?? '').includes(indexName));
}
