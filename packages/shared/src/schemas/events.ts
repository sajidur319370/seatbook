import { z } from 'zod';
import { CURRENCIES, EVENT_CATEGORIES, LIMITS, PALETTE } from '../constants';
import { timezoneSchema } from './common';

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const venueSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(200).default(''),
  city: z.string().trim().min(2).max(60),
});

/**
 * No .default() in here. In Zod 4, a default inside .partial() still applies, so a PATCH with only
 * a title would reset every omitted field. Defaults belong to create alone.
 */
const detailsShape = {
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(200),
  description: z.string().max(5000),
  category: z.enum(EVENT_CATEGORIES),
  venue: venueSchema,
  timezone: timezoneSchema,
  startsAt: isoDate,
  endsAt: isoDate,
  salesStartAt: isoDate.nullish(),
  salesEndAt: isoDate.nullish(),
  currency: z.enum(CURRENCIES),
  maxSeatsPerOrder: z.number().int().min(1).max(LIMITS.maxSeatsPerOrder),
  coverColor: z.enum(PALETTE),
  refundsAllowed: z.boolean(),
};

export type Schedule = {
  startsAt: Date;
  endsAt: Date;
  salesStartAt?: Date | null;
  salesEndAt?: Date | null;
};

/** Cross-field schedule rules (requirement §22). Used by create AND by update after merging with the stored event. */
export function scheduleIssues(s: Schedule): { path: string[]; message: string }[] {
  const issues: { path: string[]; message: string }[] = [];
  const hours = (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000;
  if (hours <= 0) issues.push({ path: ['endsAt'], message: 'The event must end after it starts' });
  if (hours > LIMITS.maxEventHours)
    issues.push({ path: ['endsAt'], message: `At most ${LIMITS.maxEventHours} hours` });
  const salesEnd = s.salesEndAt ?? s.startsAt;
  if (salesEnd > s.endsAt)
    issues.push({ path: ['salesEndAt'], message: 'Sales must end before the event ends' });
  if (s.salesStartAt && s.salesStartAt >= salesEnd)
    issues.push({ path: ['salesStartAt'], message: 'Sales must start before they end' });
  return issues;
}

export const createEventSchema = z
  .object({
    ...detailsShape,
    summary: detailsShape.summary.default(''),
    description: detailsShape.description.default(''),
    category: detailsShape.category.default('other'),
    currency: detailsShape.currency.default('USD'),
    maxSeatsPerOrder: detailsShape.maxSeatsPerOrder.default(LIMITS.defaultSeatsPerOrder),
    coverColor: detailsShape.coverColor.default('indigo'),
    refundsAllowed: detailsShape.refundsAllowed.default(false),
  })
  .superRefine((v, ctx) => {
    // Zod 4 runs this even after a field failed, so a bad date can arrive here as a string or
    // undefined. That field already has its own error; comparing it would crash with a 500.
    const optional = [v.salesStartAt, v.salesEndAt].filter((d) => d != null);
    const dates = [v.startsAt, v.endsAt, ...optional] as unknown[];
    if (!dates.every((d) => d instanceof Date)) return;

    for (const i of scheduleIssues(v)) ctx.addIssue({ code: 'custom', ...i });
  });

export const updateEventSchema = z
  .object(detailsShape)
  .partial()
  .extend({ expectedRevision: z.number().int().min(1) });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** After publish only these change (FR-EVT-02). */
export const EDITABLE_AFTER_PUBLISH = [
  'title',
  'summary',
  'description',
  'category',
  'coverColor',
  'refundsAllowed',
] as const;
