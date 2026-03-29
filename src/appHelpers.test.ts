import { beforeEach, describe, expect, it } from 'vitest';
import {
  canGiveCard,
  canGiveCardToPlayer,
  getDirectionalNeighbor,
  PERFORMANCE_MODE_STORAGE_KEY,
  readStoredPerformanceMode,
  writeStoredPerformanceMode,
} from './appHelpers.ts';
import type { ViewerGameState, ViewerPlayerState } from './multiplayer.ts';
import type { CardInstance } from './types.ts';

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
};

Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageMock },
  writable: true,
});

function makeCard(defId: string, uid = defId): CardInstance {
  return { uid, defId };
}

function makePlayer(overrides: Partial<ViewerPlayerState> = {}): ViewerPlayerState {
  const hand = overrides.hand ?? [makeCard('suspicion', 'safe')];
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? `P${overrides.id ?? 1}`,
    role: overrides.role ?? 'human',
    avatarId: overrides.avatarId ?? 'avatar-1',
    canReceiveInfectedCardFromMe: overrides.canReceiveInfectedCardFromMe ?? true,
    isKnownInfectedToMe: overrides.isKnownInfectedToMe ?? false,
    hand,
    handCount: overrides.handCount ?? hand.length,
    isAlive: overrides.isAlive ?? true,
    inQuarantine: overrides.inQuarantine ?? false,
    quarantineTurnsLeft: overrides.quarantineTurnsLeft ?? 0,
    position: overrides.position ?? ((overrides.id ?? 1) - 1),
  };
}

function makeGame(players: ViewerPlayerState[]): ViewerGameState {
  return {
    phase: 'playing',
    direction: 1,
    step: 'trade',
    currentPlayerIndex: 0,
    players,
    seats: players.map((player) => player.id),
    doors: [],
    deck: [],
    discard: [],
    log: [],
    winner: null,
    winnerPlayerIds: [],
    pendingAction: null,
    revealingPlayer: 0,
    tradeSkipped: false,
    panicAnnouncement: null,
    reshuffleCount: 0,
    tableAnim: null,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('appHelpers targeted trade checks', () => {
  it('blocks infected card when the concrete receiver cannot accept it', () => {
    const infected = makeCard('infected', 'infected-1');
    const giver = makePlayer({
      role: 'thing',
      hand: [infected],
    });
    const blockedReceiver = makePlayer({
      id: 2,
      canReceiveInfectedCardFromMe: false,
    });

    expect(canGiveCard(giver, infected)).toBe(true);
    expect(canGiveCardToPlayer(giver, infected, blockedReceiver)).toBe(false);
  });

  it('allows generic non-target swaps like Blind Date when self-constraints are satisfied', () => {
    const infectedA = makeCard('infected', 'infected-a');
    const infectedB = makeCard('infected', 'infected-b');
    const giver = makePlayer({
      role: 'infected',
      hand: [infectedA, infectedB],
    });

    expect(canGiveCard(giver, infectedA)).toBe(true);
    expect(canGiveCardToPlayer(giver, infectedA)).toBe(true);
  });

  it('finds the actual party-pass recipient by seat order and direction', () => {
    const players = [
      makePlayer({ id: 1, position: 0 }),
      makePlayer({ id: 2, position: 1, isAlive: false }),
      makePlayer({ id: 3, position: 2 }),
      makePlayer({ id: 4, position: 3 }),
    ];
    const game = makeGame(players);

    expect(getDirectionalNeighbor(game, 1, 1)?.id).toBe(3);
    expect(getDirectionalNeighbor(game, 1, -1)?.id).toBe(4);
  });
});

describe('appHelpers performance mode storage', () => {
  it('reads disabled mode by default', () => {
    expect(readStoredPerformanceMode()).toBe(false);
  });

  it('persists enabled mode as local preference', () => {
    writeStoredPerformanceMode(true);

    expect(window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY)).toBe('1');
    expect(readStoredPerformanceMode()).toBe(true);
  });

  it('removes the preference when mode is turned off', () => {
    writeStoredPerformanceMode(true);
    writeStoredPerformanceMode(false);

    expect(window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY)).toBeNull();
    expect(readStoredPerformanceMode()).toBe(false);
  });
});
