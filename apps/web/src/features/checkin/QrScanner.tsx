import { useEffect, useState } from 'react';
import { prepareZXingModule, Scanner, type IScannerError } from '@yudiel/react-qr-scanner';
import { createScanGate } from './scanGate';
// Same version the scanner depends on (package.json pins it), served from our own origin.
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/*
 * Browsers without a built-in BarcodeDetector (every iPhone, Chrome on Windows) decode with a WASM
 * build of ZXing, which by default downloads from fastly.jsdelivr.net. Our CSP blocks that, and a
 * door scanner shouldn't depend on a CDN anyway: load our own copy instead.
 */
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? zxingWasmUrl : prefix + path,
  },
});

/** What door staff can act on, instead of the library's technical message. */
function cameraProblem(err: IScannerError): string {
  switch (err.kind) {
    case 'permission-denied':
      return 'Camera access was blocked. Allow it in your browser’s site settings, then try again.';
    case 'no-camera':
      return 'No camera was found on this device.';
    case 'in-use':
      return 'Another app is using the camera. Close it, then try again.';
    case 'insecure-context':
      return 'The camera only works on a secure (https://) address.';
    case 'overconstrained':
      return 'This camera doesn’t support the needed settings. Try another camera or device.';
    case 'unsupported':
      return 'This browser can’t use the camera here. Try Chrome or Safari.';
    default:
      return err.message || 'The camera could not start.';
  }
}

/**
 * The ONLY file that knows the scanner library: swap it here and nothing else changes.
 * Which reads become requests is scanGate.ts's job (a code held in view is sent once).
 * `allowMultiple` stays on: without it the library never reports a code it has seen, so a
 * screenshot shown later by a second person would never get "Already used".
 */
export function QrScanner(props: {
  onCode: (code: string) => void;
  onError: (message: string) => void;
  paused: boolean;
}) {
  const [gate] = useState(() => createScanGate()); // FR-CHK-09 cooldown, see scanGate.ts
  useEffect(() => {
    if (!props.paused) gate.resumed(Date.now());
  }, [props.paused, gate]);
  return (
    <div className="overflow-hidden rounded-xl bg-black">
      <Scanner
        paused={props.paused}
        // The library's defaults demand a camera at least 640 px tall, so a 640×480 webcam or an old
        // phone would refuse to start (OverconstrainedError). Ask for HD, but take what there is.
        constraints={{
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }}
        formats={['qr_code']}
        allowMultiple
        scanDelay={300}
        sound={false} // the page plays its own good/bad sounds
        onScan={(codes) => {
          const code = codes[0]?.rawValue;
          if (code && gate.seen(code, Date.now())) props.onCode(code);
        }}
        onError={(err) => {
          console.warn('camera', err.kind, err.message, err.cause); // the detail, for debugging
          props.onError(cameraProblem(err));
        }}
      />
    </div>
  );
}
