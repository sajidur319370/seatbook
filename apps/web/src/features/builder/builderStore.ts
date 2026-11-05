import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  newId,
  rowIndex,
  rowRange,
  type SeatMapDto,
  type SectionInput,
  type TierInput,
} from '@seatbook/shared';

export type Layout = SeatMapDto;
type Row = SectionInput['rows'][number];

const EMPTY: Layout = { stageLabel: 'STAGE', sections: [], tiers: [] };
const PALETTE_CYCLE = ['teal', 'purple', 'amber', 'blue', 'pink', 'green'] as const;

interface BuilderState {
  eventId: string | null;
  layout: Layout;
  revision: number;
  dirty: boolean;
  /** The layout as last loaded or saved, to tell our own Details saves from another tab's edits. */
  baseline: string;
  selectedSectionId: string | null;

  load: (eventId: string, layout: Layout, revision: number) => void;
  reset: () => void;
  syncRevision: (revision: number) => void;
  markSaved: (sent: Layout, saved: Layout, revision: number) => void;
  applyTemplate: (template: Layout) => void;

  setStageLabel: (label: string) => void;
  addTier: () => void;
  updateTier: (id: string, patch: Partial<TierInput>) => void;
  removeTier: (id: string) => void;

  addSection: () => void;
  updateSection: (id: string, patch: Partial<Omit<SectionInput, 'rows'>>) => void;
  removeSection: (id: string) => void;
  selectSection: (id: string | null) => void;

  /** Returns how many labels already existed and were skipped. */
  generateRows: (
    sectionId: string,
    p: {
      from: string;
      to: string;
      seats: number;
      tierId: string;
      stagger: boolean;
      gapsAfter: number[];
    },
  ) => number;
  /** Rows are addressed by position: a label can be blank or repeated while being typed. */
  updateRow: (sectionId: string, index: number, patch: Partial<Row>) => void;
  removeRow: (sectionId: string, index: number) => void;
  toggleBlocked: (sectionId: string, row: string, n: number) => void;
}

export const useBuilder = create<BuilderState>()(
  immer((set, get) => ({
    eventId: null,
    layout: EMPTY,
    revision: 1,
    dirty: false,
    baseline: JSON.stringify(EMPTY),
    selectedSectionId: null,

    load: (eventId, layout, revision) =>
      set((s) => {
        const keep = layout.sections.some((sec) => sec._id === s.selectedSectionId);
        s.eventId = eventId;
        s.layout = structuredClone(layout);
        s.revision = revision;
        s.dirty = false;
        s.baseline = JSON.stringify(layout);
        s.selectedSectionId = keep ? s.selectedSectionId : (layout.sections[0]?._id ?? null);
      }),
    reset: () =>
      set((s) => {
        s.eventId = null;
        s.layout = EMPTY;
        s.revision = 1;
        s.dirty = false;
        s.baseline = JSON.stringify(EMPTY);
        s.selectedSectionId = null;
      }),
    syncRevision: (revision) =>
      set((s) => {
        s.revision = revision;
      }),
    markSaved: (sent, saved, revision) => {
      // Anything typed while the save was in flight stays unsaved.
      const unchanged = get().layout === sent;
      set((s) => {
        s.revision = revision;
        s.baseline = JSON.stringify(saved);
        s.dirty = !unchanged;
      });
    },
    applyTemplate: (template) =>
      set((s) => {
        s.layout = structuredClone(template);
        s.selectedSectionId = template.sections[0]?._id ?? null;
        s.dirty = true;
      }),

    setStageLabel: (label) =>
      set((s) => {
        s.layout.stageLabel = label;
        s.dirty = true;
      }),
    addTier: () =>
      set((s) => {
        const i = s.layout.tiers.length;
        s.layout.tiers.push({
          _id: newId(),
          name: `Tier ${i + 1}`,
          price: 0,
          color: PALETTE_CYCLE[i % PALETTE_CYCLE.length]!,
        });
        s.dirty = true;
      }),
    updateTier: (id, patch) =>
      set((s) => {
        Object.assign(
          s.layout.tiers.find((t) => t._id === id)!,
          patch,
        );
        s.dirty = true;
      }),
    removeTier: (id) =>
      set((s) => {
        const used = s.layout.sections.some((sec) => sec.rows.some((r) => r.tierId === id));
        if (used) return; // UI disables the button; this is a second guard
        s.layout.tiers = s.layout.tiers.filter((t) => t._id !== id);
        s.dirty = true;
      }),

    addSection: () =>
      set((s) => {
        const taken = new Set(s.layout.sections.map((sec) => sec.code));
        let n = s.layout.sections.length + 1;
        while (taken.has(`S${n}`)) n += 1; // a deleted section can leave its neighbour's code in use
        const bottom = Math.max(
          0,
          ...s.layout.sections.map((sec) => (sec.y || 0) + sec.rows.length + 2),
        );
        const id = newId();
        s.layout.sections.push({
          _id: id,
          name: `Section ${n}`,
          code: `S${n}`,
          x: 0,
          y: bottom,
          numbering: 'ltr',
          rows: [],
        });
        s.selectedSectionId = id;
        s.dirty = true;
      }),
    updateSection: (id, patch) =>
      set((s) => {
        Object.assign(
          s.layout.sections.find((x) => x._id === id)!,
          patch,
        );
        s.dirty = true;
      }),
    removeSection: (id) =>
      set((s) => {
        s.layout.sections = s.layout.sections.filter((x) => x._id !== id);
        if (s.selectedSectionId === id) s.selectedSectionId = s.layout.sections[0]?._id ?? null;
        s.dirty = true;
      }),
    selectSection: (id) =>
      set((s) => {
        s.selectedSectionId = id;
      }),

    generateRows: (sectionId, p) => {
      let skipped = 0;
      set((s) => {
        const sec = s.layout.sections.find((x) => x._id === sectionId)!;
        const existing = new Set(sec.rows.map((r) => r.label));
        rowRange(p.from, p.to).forEach((label, k) => {
          if (existing.has(label)) {
            skipped += 1; // never overwrite rows silently
            return;
          }
          sec.rows.push({
            label,
            seats: p.seats,
            offset: p.stagger && k % 2 ? 1 : 0,
            tierId: p.tierId,
            gapsAfter: [...p.gapsAfter],
            blocked: [],
          });
        });
        sec.rows.sort((a, b) => rowIndex(a.label) - rowIndex(b.label));
        s.dirty = true;
      });
      return skipped;
    },
    updateRow: (sectionId, index, patch) =>
      set((s) => {
        Object.assign(s.layout.sections.find((x) => x._id === sectionId)!.rows[index]!, patch);
        s.dirty = true;
      }),
    removeRow: (sectionId, index) =>
      set((s) => {
        s.layout.sections.find((x) => x._id === sectionId)!.rows.splice(index, 1);
        s.dirty = true;
      }),
    toggleBlocked: (sectionId, rowName, n) =>
      set((s) => {
        const row = s.layout.sections
          .find((x) => x._id === sectionId)!
          .rows.find((r) => r.label === rowName)!;
        row.blocked = row.blocked.includes(n)
          ? row.blocked.filter((b) => b !== n)
          : [...row.blocked, n].sort((a, b) => a - b);
        s.dirty = true;
      }),
  })),
);
