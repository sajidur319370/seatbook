import { useSyncExternalStore } from 'react';
import { getConnectionState, subscribeToConnection } from './client';

const useConnectionState = () => useSyncExternalStore(subscribeToConnection, getConnectionState);

/**
 * FR-RT-12. Pinned under the header: pushing the map down would move seats under the pointer, and at
 * the bottom of a tall map a phone wouldn't show it. The live region stays in the page, so a screen
 * reader notices when the words appear.
 */
export function ConnectionBanner() {
  const offline = useConnectionState() === 'offline';
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-2 top-16 z-30 flex justify-center"
    >
      {offline && (
        <p
          data-testid="connection-banner"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow"
        >
          Reconnecting… seat colours may be out of date. Your clicks still work.
        </p>
      )}
    </div>
  );
}
