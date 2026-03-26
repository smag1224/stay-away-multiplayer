import { describe, expect, it } from 'vitest';

import { createInitialState, gameReducer } from '../../../src/gameLogic.ts';
import type { CardInstance, GameState, LogEntry } from '../../../src/types.ts';
import { createBotMemory, recordSeenCards, updateMemoryFromLog } from '../memory.ts';
import { buildVisibleState } from '../visibleState.ts';

function card(defId: string, uid: string): CardInstance {
  return { defId, uid };
}

function startGame(playerCount = 4): GameState {
  const names = Array.from({ length: playerCount }, (_, i) => `Player${i + 1}`);
  let state = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames: names,
  });

  state = {
    ...state,
    phase: 'playing',
    revealingPlayer: playerCount - 1,
  };

  return state;
}

function fakeLogGame(log: LogEntry[], currentPlayerIndex = 0): GameState {
  return {
    ...createInitialState(),
    phase: 'playing',
    players: [],
    seats: [],
    log,
    currentPlayerIndex,
  };
}

describe('bot knowledge model', () => {
  it('does not mark a player as confirmed infected after seeing a single infected card', () => {
    const memory = createBotMemory(0, [0, 1, 2, 3]);

    recordSeenCards(memory, 1, [card('infected', 'infected_seen')], 0, false);

    expect(memory.observations.get(1)?.confirmedInfected).toBe(false);
  });

  it('invalidates confirmed clean after a visible hand change', () => {
    const memory = createBotMemory(0, [0, 1, 2, 3]);

    recordSeenCards(
      memory,
      1,
      [card('suspicion', 'clean_a'), card('axe', 'clean_b')],
      0,
      true,
    );

    expect(memory.observations.get(1)?.confirmedClean).toBe(true);

    updateMemoryFromLog(memory, fakeLogGame([
      {
        id: 1,
        text: 'Player2 drew a card.',
        textRu: 'Player2 взял(а) карту.',
        timestamp: 1,
        fromPlayerId: 1,
      },
    ]));

    expect(memory.observations.get(1)?.confirmedClean).toBe(false);
  });

  it('exposes legal role knowledge in bot visible state', () => {
    const state = startGame(4);
    state.players[0].role = 'thing';
    state.players[1].role = 'infected';
    state.players[2].role = 'human';
    state.players[3].role = 'human';

    const thingView = buildVisibleState(state, 0);
    const infectedView = buildVisibleState(state, 1);

    expect(thingView.players.find((player) => player.id === 1)?.isKnownInfectedToMe).toBe(true);
    expect(infectedView.players.find((player) => player.id === 0)?.canReceiveInfectedCardFromMe).toBe(true);
  });
});
