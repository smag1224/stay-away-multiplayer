import type { GameState } from '../types.ts';

// ── Utility ─────────────────────────────────────────────────────────────────

let nextLogId = 1;
let nextCardUid = 1;

export function uid(): string {
  return `card_${nextCardUid++}`;
}

/** Fisher-Yates shuffle (in-place) */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function log(state: GameState, text: string, textRu: string): void {
  state.log.unshift({ id: nextLogId++, text, textRu, timestamp: Date.now() });
  if (state.log.length > 100) state.log.length = 100;
}

export function resetCounters(): void {
  nextLogId = 1;
  nextCardUid = 1;
}
