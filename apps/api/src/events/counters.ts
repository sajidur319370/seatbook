import { Event } from '../db/models';
import type { DomainEvent } from './types';

/**
 * Display counters (data-model.md D8): bumped AFTER commit, outside the booking transaction, so the
 * hot event document never joins it. If one bump is lost, `repair:counters` recounts (queries.md §16.1).
 */
export async function applyCounters(e: DomainEvent): Promise<void> {
  if (e.type === 'checkin.recorded' && e.result === 'ok') {
    await Event.updateOne({ _id: e.eventId }, { $inc: { 'counters.ticketsCheckedIn': 1 } });
  }
  if (e.type === 'sales.changed') {
    await Event.updateOne(
      { _id: e.eventId },
      { $inc: { 'counters.seatsSold': e.seats, 'counters.revenue': e.revenue } },
    );
  }
}
