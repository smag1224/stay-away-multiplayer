import { useEffect, useRef } from 'react';

/**
 * Plays a short notification tone when it becomes the player's turn.
 * Uses Web Audio API — no external sound files needed.
 */
export function useTurnSound(isMyTurn: boolean) {
  const wasMyTurn = useRef(false);

  useEffect(() => {
    // Only play when transitioning from not-my-turn → my-turn
    if (isMyTurn && !wasMyTurn.current) {
      playTurnSound();
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);
}

function playTurnSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Two-tone chime: C5 → E5
    for (const [freq, start] of [[523, 0], [659, 0.12]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.3);
    }

    // Clean up context after sounds finish
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Audio not available — silently ignore
  }
}
