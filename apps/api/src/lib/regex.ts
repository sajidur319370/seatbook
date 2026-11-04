/** User text must never become a regex pattern (ReDoS, injection). */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
