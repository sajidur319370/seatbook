import { z } from 'zod';
import { SCAN_METHODS, SCAN_RESULTS, type ScanResult } from '../constants';
import type { Id } from '../dto';

export const checkInSchema = z.object({
  code: z.string().trim().min(1).max(64),
  method: z.enum(SCAN_METHODS),
  gate: z.string().trim().max(30).nullish(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const scanFeedQuerySchema = z.object({
  result: z.enum(SCAN_RESULTS).optional(),
  cursor: z.string().max(200).optional(),
});

/** What the door staff see about a ticket: never its codes. */
export interface CheckinTicketDto {
  id: Id;
  seatLabel: string;
  sectionName: string;
  row: string;
  number: number;
  tierName: string;
  holderName: string;
  checkedInAt: string | null;
  checkedInByName?: string; // already used: by whom
  checkedInGate?: string | null; // …and at which gate
}

export interface CheckInCounts {
  checkedIn: number;
  sold: number;
}

/** Always 200 for business results (FR-CHK-05): the scanner treats every scan the same way. */
export interface CheckInResponse {
  result: ScanResult;
  ticket: CheckinTicketDto | null;
  counts: CheckInCounts;
}

export interface ScanDto {
  id: Id;
  result: ScanResult;
  method: (typeof SCAN_METHODS)[number];
  gate: string | null;
  createdAt: string;
  seatLabel: string | null; // null when the code didn't resolve to a ticket
  holderName: string | null;
}

export interface ScanFeedResponse {
  items: ScanDto[];
  nextCursor: string | null;
}
