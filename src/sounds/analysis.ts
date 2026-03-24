/**
 * Synthesised scanner/analysis sound using Web Audio API.
 * A sci-fi scanning sweep: rising tone + soft digital beeps.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function playAnalysisSound(duration = 5, volume = 0.15): () => void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const end = now + duration;

  // ── Master gain (envelope) ──
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(volume, now + 0.3);
  master.gain.setValueAtTime(volume, end - 1.2);
  master.gain.exponentialRampToValueAtTime(0.001, end);
  master.connect(ctx.destination);

  // ── Sweep tone: slow rising sine — the "scanning" feel ──
  const sweep = ctx.createOscillator();
  sweep.type = 'sine';
  sweep.frequency.setValueAtTime(280, now);
  sweep.frequency.linearRampToValueAtTime(520, end);
  const sweepGain = ctx.createGain();
  sweepGain.gain.setValueAtTime(volume * 0.5, now);
  sweep.connect(sweepGain);
  sweepGain.connect(master);

  // ── Subtle hum undertone ──
  const hum = ctx.createOscillator();
  hum.type = 'triangle';
  hum.frequency.setValueAtTime(120, now);
  const humGain = ctx.createGain();
  humGain.gain.setValueAtTime(volume * 0.2, now);
  hum.connect(humGain);
  humGain.connect(master);

  // ── Digital beep layer: periodic short beeps ──
  const beepInterval = 0.55; // beep every ~0.55s
  const beepCount = Math.floor((duration - 0.5) / beepInterval);
  const beepOscs: OscillatorNode[] = [];

  for (let i = 0; i < beepCount; i++) {
    const beepStart = now + 0.3 + i * beepInterval;
    const beepEnd = beepStart + 0.08;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    // Alternate between two pitches for a "data read" feel
    osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 1100, beepStart);

    const beepGain = ctx.createGain();
    beepGain.gain.setValueAtTime(0, beepStart);
    beepGain.gain.linearRampToValueAtTime(volume * 0.12, beepStart + 0.01);
    beepGain.gain.linearRampToValueAtTime(0, beepEnd);

    osc.connect(beepGain);
    beepGain.connect(master);
    osc.start(beepStart);
    osc.stop(beepEnd + 0.01);
    beepOscs.push(osc);
  }

  // ── Soft white noise layer (very quiet — adds texture) ──
  const noiseLen = ctx.sampleRate * duration;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * 0.15;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseBp = ctx.createBiquadFilter();
  noiseBp.type = 'bandpass';
  noiseBp.frequency.setValueAtTime(2000, now);
  noiseBp.Q.setValueAtTime(2, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(volume * 0.15, now);
  noise.connect(noiseBp);
  noiseBp.connect(noiseGain);
  noiseGain.connect(master);

  // ── Start ──
  sweep.start(now);
  sweep.stop(end);
  hum.start(now);
  hum.stop(end);
  noise.start(now);
  noise.stop(end);

  return () => {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      sweep.stop(ctx.currentTime + 0.15);
      hum.stop(ctx.currentTime + 0.15);
      noise.stop(ctx.currentTime + 0.15);
      beepOscs.forEach(o => { try { o.stop(ctx.currentTime + 0.05); } catch { /* */ } });
    } catch { /* already stopped */ }
  };
}
