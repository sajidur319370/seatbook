/** 0 → "A", 25 → "Z", 26 → "AA", 49 → "AX", 52 → "BA". Covers every 1–2 letter label. */
export function rowLabel(i: number): string {
  return i < 26
    ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

export function rowIndex(label: string): number {
  return label.length === 1
    ? label.charCodeAt(0) - 65
    : (label.charCodeAt(0) - 64) * 26 + label.charCodeAt(1) - 65;
}

/** "A".."P" inclusive → ['A', …, 'P'] */
export const rowRange = (from: string, to: string) =>
  Array.from({ length: Math.max(0, rowIndex(to) - rowIndex(from) + 1) }, (_, k) =>
    rowLabel(rowIndex(from) + k),
  );
