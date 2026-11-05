import { create } from 'zustand';

interface PendingState {
  ids: Set<string>;
  /** Requests overlapped since the list was last empty, so responses may have arrived out of order. */
  overlapped: boolean;
  add: (id: string) => void;
  /** True when this was the last request of an overlapping burst. */
  remove: (id: string) => boolean;
}

/** Seats with a request in flight. Each change makes a new Set, so selectors update. */
export const usePending = create<PendingState>((set, get) => ({
  ids: new Set(),
  overlapped: false,
  add: (id) =>
    set((s) => ({ ids: new Set(s.ids).add(id), overlapped: s.overlapped || s.ids.size > 0 })),
  remove: (id) => {
    const ids = new Set(get().ids);
    ids.delete(id);
    const burstEnded = ids.size === 0 && get().overlapped;
    set({ ids, overlapped: ids.size === 0 ? false : get().overlapped });
    return burstEnded;
  },
}));
