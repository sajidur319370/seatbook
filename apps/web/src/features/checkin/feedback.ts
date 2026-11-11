import type { ScanResult } from '@seatbook/shared';

// One context for the page's life: browsers cap how many can exist at once.
let audio: AudioContext | null = null;

/** A short buzz and beep, so the door staff needn't look down: high = good, low = bad. */
export function feedback(result: ScanResult) {
  const ok = result === 'ok';
  navigator.vibrate?.(ok ? 80 : [80, 60, 80, 60, 80]);
  try {
    audio ??= new AudioContext();
    void audio.resume(); // created before a tap, it starts suspended
    const osc = audio.createOscillator();
    osc.frequency.value = ok ? 880 : 220;
    osc.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.35));
  } catch {
    // No audio (a locked-down browser): the card and the vibration still say it.
  }
}
