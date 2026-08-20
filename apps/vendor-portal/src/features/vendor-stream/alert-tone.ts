/**
 * A short, synthesized alert tone (S4-SSE) — generated with the Web Audio
 * API rather than a bundled audio asset, so there is nothing to license,
 * ship, or keep in sync with the alert's own start/stop lifecycle.
 *
 * Audio is a courtesy, not a requirement: every failure here (no
 * `AudioContext`, autoplay refused by the browser, the tab is backgrounded)
 * is caught and silently ignored — `VendorStreamAlert`'s own visible
 * indicator and acknowledge control are the accessible surface this feature
 * actually depends on.
 */
let audioContext: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;

export const startAlertTone = (): void => {
  if (oscillator) return;
  try {
    audioContext ??= new AudioContext();
    const gain = audioContext.createGain();
    gain.gain.value = 0.15;
    const tone = audioContext.createOscillator();
    tone.type = 'sine';
    tone.frequency.value = 880;
    tone.connect(gain).connect(audioContext.destination);
    tone.start();
    oscillator = tone;
  } catch {
    // No audio this session — the visible/acknowledge UI still works.
  }
};

export const stopAlertTone = (): void => {
  try {
    oscillator?.stop();
    oscillator?.disconnect();
  } catch {
    // Already stopped.
  }
  oscillator = null;
};
