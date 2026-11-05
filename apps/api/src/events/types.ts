import type { Types } from 'mongoose';
import type { SeatStatus } from '@seatbook/shared';

export interface SeatChange {
  seatId: string;
  status: SeatStatus;
  version: number;
  holdExpiresAt: string | null;
}

export type DomainEvent =
  | { type: 'seats.changed'; eventId: Types.ObjectId; changes: SeatChange[] }
  | {
      type: 'hold.changed';
      userId: Types.ObjectId;
      eventId: Types.ObjectId;
      reason:
        'seat_added' | 'seat_removed' | 'released' | 'expired' | 'converted' | 'payment_window';
    };
// Day 14: event.updated, account.changed · Day 16: booking.confirmed, sales.changed · Day 18: checkin.recorded
