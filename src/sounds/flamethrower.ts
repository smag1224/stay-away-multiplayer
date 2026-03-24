/**
 * Synthesised flamethrower sound using Web Audio API.
 * No external files required — generates a roaring fire stream
 * that ramps up, sustains, then fades over the given duration.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  // Resume if suspended (autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function playFlamethrowerSound(duration = 5, volume = 0.18): () => void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const end = now + duration;

  // ── White noise source ──
  const bufferSize = ctx.sampleRate * duration;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  // ── Bandpass filter — gives fire its characteristic roar (200-900 Hz) ──
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(500, now);
  bandpass.Q.setValueAtTime(0.8, now);

  // ── Low-pass to soften harshness ──
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(1200, now);

  // ── LFO for flicker / turbulence feel ──
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(6, now); // 6 Hz wobble
  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(150, now);
  lfo.connect(lfoGain);
  lfoGain.connect(bandpass.frequency); // modulate filter frequency

  // ── Subtle low rumble (adds body) ──
  const rumble = ctx.createOscillator();
  rumble.type = 'sawtooth';
  rumble.frequency.setValueAtTime(55, now);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0, now);
  rumbleGain.gain.linearRampToValueAtTime(volume * 0.12, now + 0.4);
  rumbleGain.gain.setValueAtTime(volume * 0.12, end - 1.8);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, end);

  // ── Master gain (envelope) ──
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(volume, now + 0.3);         // ramp up
  master.gain.setValueAtTime(volume, end - 1.8);                  // sustain
  master.gain.exponentialRampToValueAtTime(0.001, end);            // fast fade out

  // ── Crackle layer (higher frequency noise bursts) ──
  const crackleBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const crackleData = crackleBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Sparse impulses for crackle
    crackleData[i] = Math.random() < 0.02 ? (Math.random() * 2 - 1) * 0.6 : 0;
  }
  const crackle = ctx.createBufferSource();
  crackle.buffer = crackleBuffer;
  const crackleHighpass = ctx.createBiquadFilter();
  crackleHighpass.type = 'highpass';
  crackleHighpass.frequency.setValueAtTime(2000, now);
  const crackleGain = ctx.createGain();
  crackleGain.gain.setValueAtTime(0, now);
  crackleGain.gain.linearRampToValueAtTime(volume * 0.3, now + 0.5);
  crackleGain.gain.setValueAtTime(volume * 0.3, end - 1.8);
  crackleGain.gain.exponentialRampToValueAtTime(0.001, end);

  // ── Connect graph ──
  noise.connect(bandpass);
  bandpass.connect(lowpass);
  lowpass.connect(master);

  rumble.connect(rumbleGain);
  rumbleGain.connect(master);

  crackle.connect(crackleHighpass);
  crackleHighpass.connect(crackleGain);
  crackleGain.connect(master);

  master.connect(ctx.destination);

  // ── Start everything ──
  noise.start(now);
  noise.stop(end);
  lfo.start(now);
  lfo.stop(end);
  rumble.start(now);
  rumble.stop(end);
  crackle.start(now);
  crackle.stop(end);

  // Return a cleanup/stop function
  return () => {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      noise.stop(ctx.currentTime + 0.15);
      lfo.stop(ctx.currentTime + 0.15);
      rumble.stop(ctx.currentTime + 0.15);
      crackle.stop(ctx.currentTime + 0.15);
    } catch { /* already stopped */ }
  };
}
