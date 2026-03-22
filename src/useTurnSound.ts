import { useEffect, useRef } from 'react';
import type { TableAnimEvent } from './multiplayer.ts';

type SoundSnapshot = {
  isMyTurn: boolean;
  urgentTradePrompt: boolean;
  reshuffleCount: number;
  latestCardDefId: string | null;
  tableAnim: TableAnimEvent | null;
};

export function useTurnSound({
  isMyTurn,
  urgentTradePrompt,
  reshuffleCount,
  latestCardDefId,
  tableAnim,
}: SoundSnapshot) {
  const wasMyTurn = useRef(false);
  const hadUrgentTradePrompt = useRef(false);
  const lastReshuffleCount = useRef(reshuffleCount);
  const lastCardDefId = useRef<string | null>(null);
  const lastTableAnimKey = useRef<string | null>(null);

  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      playCue('turn');
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  useEffect(() => {
    if (urgentTradePrompt && !hadUrgentTradePrompt.current) {
      playCue('tradeAlert');
    }
    hadUrgentTradePrompt.current = urgentTradePrompt;
  }, [urgentTradePrompt]);

  useEffect(() => {
    if (reshuffleCount > lastReshuffleCount.current) {
      playCue('reshuffle');
    }
    lastReshuffleCount.current = reshuffleCount;
  }, [reshuffleCount]);

  useEffect(() => {
    if (!latestCardDefId || latestCardDefId === lastCardDefId.current) return;
    playCue(resolveCardCue(latestCardDefId));
    lastCardDefId.current = latestCardDefId;
  }, [latestCardDefId]);

  useEffect(() => {
    if (!tableAnim) return;
    const animKey = getTableAnimKey(tableAnim);
    if (animKey === lastTableAnimKey.current) return;
    lastTableAnimKey.current = animKey;

    if (tableAnim.type === 'exchange_pending') {
      playCue(tableAnim.mode === 'temptation' ? 'temptation' : 'tradePending');
      return;
    }

    if (tableAnim.type === 'exchange_ready') {
      playCue('tradeReady');
      return;
    }

    if (tableAnim.type === 'exchange_blocked') {
      playCue('defense');
    }
  }, [tableAnim]);
}

function getTableAnimKey(tableAnim: TableAnimEvent): string {
  if (tableAnim.type === 'card') {
    return `${tableAnim.type}:${tableAnim.sceneId}:${tableAnim.cardDefId}`;
  }

  return `${tableAnim.type}:${tableAnim.sceneId}:${tableAnim.mode}`;
}

function resolveCardCue(cardDefId: string) {
  switch (cardDefId) {
    case 'flamethrower':
      return 'flamethrower';
    case 'analysis':
      return 'analysis';
    case 'suspicion':
      return 'suspicion';
    case 'persistence':
      return 'persistence';
    case 'no_barbecue':
    case 'fear':
    case 'no_thanks':
    case 'miss':
    case 'anti_analysis':
      return 'defense';
    case 'temptation':
      return 'temptation';
    case 'swap_places':
    case 'you_better_run':
    case 'blind_date':
      return 'movement';
    default:
      return 'card';
  }
}

function playCue(cue: ReturnType<typeof resolveCardCue> | 'turn' | 'tradeAlert' | 'reshuffle' | 'tradePending' | 'tradeReady') {
  const AudioCtor = getAudioCtor();
  if (!AudioCtor) return;

  try {
    const ctx = new AudioCtor();
    const now = ctx.currentTime;

    switch (cue) {
      case 'turn':
        playTurnCue(ctx, now);
        break;
      case 'tradeAlert':
        playTradeAlertCue(ctx, now);
        break;
      case 'reshuffle':
        playReshuffleCue(ctx, now);
        break;
      case 'flamethrower':
        playFlamethrowerCue(ctx, now);
        break;
      case 'analysis':
        playAnalysisCue(ctx, now);
        break;
      case 'suspicion':
        playSuspicionCue(ctx, now);
        break;
      case 'persistence':
        playPersistenceCue(ctx, now);
        break;
      case 'defense':
        playDefenseCue(ctx, now);
        break;
      case 'temptation':
        playTemptationCue(ctx, now);
        break;
      case 'movement':
        playMovementCue(ctx, now);
        break;
      case 'tradePending':
        playTradePendingCue(ctx, now);
        break;
      case 'tradeReady':
        playTradeReadyCue(ctx, now);
        break;
      default:
        playCardCue(ctx, now);
        break;
    }

    window.setTimeout(() => void ctx.close().catch(() => undefined), 1300);
  } catch {
    // Some browsers block autoplay before user interaction.
  }
}

function getAudioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function createTone(ctx: AudioContext, options: {
  frequency: number;
  start: number;
  duration: number;
  volume?: number;
  type?: OscillatorType;
  endFrequency?: number;
}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.frequency, options.start);
  if (typeof options.endFrequency === 'number') {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFrequency), options.start + options.duration);
  }

  const volume = options.volume ?? 0.15;
  gain.gain.setValueAtTime(0.001, options.start);
  gain.gain.exponentialRampToValueAtTime(volume, options.start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, options.start + options.duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(options.start);
  osc.stop(options.start + options.duration + 0.02);
}

function createNoiseBurst(
  ctx: AudioContext,
  start: number,
  duration: number,
  volume: number,
  lowpassFrequency?: number,
) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
  }

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.value = lowpassFrequency ?? 1800;

  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function playTurnCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 523, endFrequency: 587, start: now, duration: 0.22, volume: 0.11, type: 'triangle' });
  createTone(ctx, { frequency: 659, endFrequency: 784, start: now + 0.09, duration: 0.28, volume: 0.14, type: 'sine' });
}

function playTradeAlertCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 392, start: now, duration: 0.16, volume: 0.12, type: 'square' });
  createTone(ctx, { frequency: 523, start: now + 0.13, duration: 0.2, volume: 0.11, type: 'square' });
}

function playReshuffleCue(ctx: AudioContext, now: number) {
  createNoiseBurst(ctx, now, 0.3, 0.12, 2200);
  createNoiseBurst(ctx, now + 0.12, 0.26, 0.08, 1400);
}

function playCardCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 360, endFrequency: 300, start: now, duration: 0.1, volume: 0.09, type: 'triangle' });
}

function playFlamethrowerCue(ctx: AudioContext, now: number) {
  createNoiseBurst(ctx, now, 0.55, 0.2, 2600);
  createTone(ctx, { frequency: 140, endFrequency: 95, start: now, duration: 0.48, volume: 0.08, type: 'sawtooth' });
}

function playAnalysisCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 780, endFrequency: 1160, start: now, duration: 0.18, volume: 0.08, type: 'sine' });
  createTone(ctx, { frequency: 640, endFrequency: 840, start: now + 0.11, duration: 0.18, volume: 0.07, type: 'triangle' });
}

function playSuspicionCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 310, endFrequency: 260, start: now, duration: 0.22, volume: 0.08, type: 'triangle' });
  createTone(ctx, { frequency: 520, endFrequency: 420, start: now + 0.09, duration: 0.22, volume: 0.06, type: 'sine' });
}

function playPersistenceCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 440, start: now, duration: 0.1, volume: 0.08, type: 'triangle' });
  createTone(ctx, { frequency: 554, start: now + 0.08, duration: 0.1, volume: 0.08, type: 'triangle' });
  createTone(ctx, { frequency: 659, start: now + 0.16, duration: 0.14, volume: 0.09, type: 'triangle' });
}

function playDefenseCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 820, start: now, duration: 0.08, volume: 0.07, type: 'square' });
  createTone(ctx, { frequency: 620, start: now + 0.05, duration: 0.14, volume: 0.07, type: 'square' });
}

function playTemptationCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 392, start: now, duration: 0.12, volume: 0.08, type: 'sine' });
  createTone(ctx, { frequency: 466, start: now + 0.09, duration: 0.15, volume: 0.09, type: 'sine' });
}

function playMovementCue(ctx: AudioContext, now: number) {
  createNoiseBurst(ctx, now, 0.14, 0.06, 3000);
  createTone(ctx, { frequency: 260, endFrequency: 520, start: now, duration: 0.14, volume: 0.05, type: 'triangle' });
}

function playTradePendingCue(ctx: AudioContext, now: number) {
  createTone(ctx, { frequency: 480, start: now, duration: 0.1, volume: 0.08, type: 'triangle' });
  createTone(ctx, { frequency: 620, start: now + 0.08, duration: 0.1, volume: 0.08, type: 'triangle' });
}

function playTradeReadyCue(ctx: AudioContext, now: number) {
  createNoiseBurst(ctx, now, 0.1, 0.05, 2200);
  createTone(ctx, { frequency: 430, endFrequency: 350, start: now, duration: 0.16, volume: 0.06, type: 'triangle' });
}
