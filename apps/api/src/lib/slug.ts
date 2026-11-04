import { randomBytes } from 'node:crypto';
import { CROCKFORD } from '@seatbook/shared';

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, ''); // after the slice, which can leave a trailing dash
  return slug || 'event'; // e.g. a title with no Latin letters
}

export function slugWithSuffix(title: string): string {
  const suffix = [...randomBytes(4)]
    .map((b) => CROCKFORD[b % 32])
    .join('')
    .toLowerCase();
  return `${slugify(title)}-${suffix}`; // hamlet-evening-show-k7qx
}
