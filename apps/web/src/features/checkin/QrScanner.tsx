import { useRef } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';

/**
 * The ONLY file that knows the scanner library: swap it here and nothing else changes.
 * Calls onCode at most once per 1.5 s for the same code (FR-CHK-09). `allowMultiple` stays on:
 * without it the library never reports a code it has seen, so a screenshot shown by a second
 * person would never get "Already used".
 */
export function QrScanner(props: {
  onCode: (code: string) => void;
  onError: (message: string) => void;
  paused: boolean;
}) {
  const last = useRef<{ code: string; at: number } | null>(null);
  return (
    <div className="overflow-hidden rounded-xl bg-black">
      <Scanner
        paused={props.paused}
        constraints={{ facingMode: 'environment' }}
        formats={['qr_code']}
        allowMultiple
        scanDelay={300}
        sound={false} // the page plays its own good/bad sounds
        onScan={(codes) => {
          const code = codes[0]?.rawValue;
          if (!code) return;
          const now = Date.now();
          if (last.current?.code === code && now - last.current.at < 1_500) return;
          last.current = { code, at: now };
          props.onCode(code);
        }}
        onError={(err) => props.onError(err instanceof Error ? err.message : String(err))}
      />
    </div>
  );
}
