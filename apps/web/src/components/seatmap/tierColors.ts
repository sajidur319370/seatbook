import type { PaletteColor } from '@seatbook/shared';

/** Tailwind 500 shades. SVG fills need real colours, not class names. */
export const TIER_HEX: Record<PaletteColor, string> = {
  gray: '#6b7280',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  green: '#22c55e',
  teal: '#14b8a6',
  blue: '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  pink: '#ec4899',
};

export const STATUS_HEX = { held: '#f59e0b', booked: '#9ca3af', mine: '#2563eb' };
