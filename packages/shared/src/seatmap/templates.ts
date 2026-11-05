import { newId } from './ids';
import type { SeatMapInput } from './schema';

type Template = Omit<SeatMapInput, 'expectedRevision'>;

const rowLabels = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i)); // A..Z is enough for templates

/** 120 seats: 8 rows of 15, with a centre aisle. */
export function smallTheatre(): Template {
  const front = { _id: newId(), name: 'Front', price: 5000, color: 'purple' as const };
  const back = { _id: newId(), name: 'Back', price: 3000, color: 'teal' as const };
  return {
    stageLabel: 'STAGE',
    tiers: [front, back],
    sections: [
      {
        _id: newId(),
        name: 'Stalls',
        code: 'ST',
        x: 0,
        y: 0,
        numbering: 'ltr',
        rows: rowLabels('A', 8).map((label, i) => ({
          label,
          seats: 15,
          offset: 0,
          tierId: i < 3 ? front._id : back._id,
          gapsAfter: [7],
          blocked: [],
        })),
      },
    ],
  };
}

/** 552 seats: Orchestra (VIP front rows + Standard) and two Balcony wings (Value). */
export function concertHall(): Template {
  const vip = { _id: newId(), name: 'VIP', price: 7500, color: 'purple' as const };
  const std = { _id: newId(), name: 'Standard', price: 4000, color: 'teal' as const };
  const val = { _id: newId(), name: 'Value', price: 2000, color: 'amber' as const };

  const orchestra = {
    _id: newId(),
    name: 'Orchestra',
    code: 'ORC',
    x: 12,
    y: 4,
    numbering: 'ltr' as const,
    rows: rowLabels('A', 16).map((label, i) => ({
      label,
      seats: 24,
      offset: i < 4 ? 2 : 0,
      tierId: i < 3 ? vip._id : std._id,
      gapsAfter: [12],
      blocked: label === 'P' ? [11, 12, 13, 14] : [], // sound desk
    })),
  };
  const wing = (name: string, code: string, x: number) => ({
    _id: newId(),
    name,
    code,
    x,
    y: 23,
    numbering: 'ltr' as const,
    rows: rowLabels('A', 6).map((label) => ({
      label,
      seats: 14,
      offset: 0,
      tierId: val._id,
      gapsAfter: [],
      blocked: [],
    })),
  });

  return {
    stageLabel: 'STAGE',
    tiers: [vip, std, val],
    sections: [orchestra, wing('Balcony Left', 'BL', 0), wing('Balcony Right', 'BR', 25)],
  };
}

/** 80 seats: 8 rows of 10, one price. */
export function conferenceRoom(): Template {
  const general = { _id: newId(), name: 'General', price: 1500, color: 'blue' as const };
  return {
    stageLabel: 'PODIUM',
    tiers: [general],
    sections: [
      {
        _id: newId(),
        name: 'Room',
        code: 'RM',
        x: 0,
        y: 0,
        numbering: 'ltr',
        rows: rowLabels('A', 8).map((label) => ({
          label,
          seats: 10,
          offset: 0,
          tierId: general._id,
          gapsAfter: [5],
          blocked: [],
        })),
      },
    ],
  };
}
