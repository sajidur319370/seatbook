import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import type { OrganizerEventDto } from '@seatbook/shared';
import { useBuilder } from './builderStore';

/**
 * Lives on the editor page, not the Seat map tab: the tab unmounts when you switch away, and the
 * Publish tab needs the same data. Tab switches must never touch unsaved work.
 */
export function useBuilderSync(event: OrganizerEventDto) {
  useEffect(() => {
    const s = useBuilder.getState();
    if (s.eventId !== event.id || !s.dirty) {
      s.load(event.id, event.seatMap, event.revision);
    } else if (s.baseline === JSON.stringify(event.seatMap)) {
      // Only the details changed (our own Details save). The unsaved layout is still valid to
      // save, so adopt the new revision. If the seat map itself changed, keep the old revision
      // on purpose: saving then gets 409 STALE_DRAFT and the reload dialog.
      s.syncRevision(event.revision);
    }
  }, [event]);

  // Leaving the page forgets the draft, so coming back shows what's really saved.
  useEffect(() => () => useBuilder.getState().reset(), [event.id]);
}

/** Warns on in-app navigation (needs a data router) and on closing the tab. */
export function useUnsavedGuard() {
  const dirty = useBuilder((s) => s.dirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      // Read the store directly: a delete or publish may have just cleared it.
      useBuilder.getState().dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      // The session has already ended (logout, revoked, suspended): there's nothing to stay for.
      nextLocation.pathname !== '/login',
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return blocker;
}
