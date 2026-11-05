export function makeClock(startIso: string) {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    set: (iso: string) => {
      t = new Date(iso).getTime();
    },
  };
}

export const MIN = 60_000;
