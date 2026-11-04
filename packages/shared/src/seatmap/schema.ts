import { z } from 'zod';
import { LIMITS, NUMBERING, OBJECT_ID, PALETTE, ROW_LABEL, SECTION_CODE } from '../constants';
import { validateLayout } from './validate';

const id = z.string().regex(OBJECT_ID);

export const tierInputSchema = z.object({
  _id: id,
  name: z.string().trim().min(1).max(30),
  price: z.number().int().min(0).max(LIMITS.maxPrice),
  color: z.enum(PALETTE),
});

export const rowInputSchema = z.object({
  label: z.string().regex(ROW_LABEL),
  seats: z.number().int().min(1).max(LIMITS.seatsPerRow),
  offset: z.number().int().min(0).max(LIMITS.maxRowOffset).default(0),
  tierId: id,
  gapsAfter: z.array(z.number().int().min(1)).max(20).default([]),
  blocked: z.array(z.number().int().min(1)).max(100).default([]),
});

export const sectionInputSchema = z.object({
  _id: id,
  name: z.string().trim().min(1).max(40),
  code: z.string().regex(SECTION_CODE),
  x: z.number().int().min(0).max(LIMITS.gridSize),
  y: z.number().int().min(0).max(LIMITS.gridSize),
  numbering: z.enum(NUMBERING).default('ltr'),
  rows: z.array(rowInputSchema).max(LIMITS.rowsPerSection),
});

export const seatMapInputSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    stageLabel: z.string().trim().max(30).default('STAGE'),
    sections: z.array(sectionInputSchema).max(LIMITS.sectionsPerEvent),
    tiers: z.array(tierInputSchema).min(1).max(LIMITS.tiersPerEvent),
  })
  .superRefine((m, ctx) => {
    // Stop if a field already failed. Zod 4 still runs this after checks like .max(), so without
    // this line { seats: 1000000000 } reaches generateSeats, and one request can crash the server.
    if (ctx.issues.length) return;
    for (const issue of validateLayout(m)) ctx.addIssue({ code: 'custom', ...issue }); // uses the generator
  });

export type SeatMapInput = z.infer<typeof seatMapInputSchema>;
export type SectionInput = SeatMapInput['sections'][number];
export type TierInput = SeatMapInput['tiers'][number];
