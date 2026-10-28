// Short audible feedback so the guard need not look at the screen for every student.
let ctx = null;

function tone(freq, start, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration);
}

export function beep(kind) {
  try {
    ctx = ctx || new AudioContext();
    if (kind === 'success') tone(1046, 0, 0.12);
    else if (kind === 'warning') tone(660, 0, 0.18);
    else {
      tone(330, 0, 0.18);
      tone(330, 0.24, 0.18);
    }
  } catch {
    /* no audio device: silent */
  }
}
