import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

import { createInitialState, gameReducer } from '../../../gameLogic.ts';
import { GameScreen } from '../../../GameScreen.tsx';
import type { RoomView, ViewerGameState, ViewerPlayerState } from '../../../multiplayer.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ru' },
  }),
}));

vi.mock('../../../useTurnSound.ts', () => ({
  useTurnSound: () => undefined,
}));

function buildViewerGame(playerCount: number): {
  game: ViewerGameState;
  me: ViewerPlayerState;
  room: RoomView;
} {
  const names = Array.from({ length: playerCount }, (_, index) => `P${index + 1}`);
  let state = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames: names,
  });

  state = {
    ...state,
    phase: 'playing',
    revealingPlayer: playerCount - 1,
  };

  const viewerId = 0;
  const players = state.players.map((player) => ({
    id: player.id,
    name: player.name,
    role: player.id === viewerId ? player.role : null,
    avatarId: player.avatarId,
    canReceiveInfectedCardFromMe: false,
    hand: player.id === viewerId ? [...player.hand] : [],
    handCount: player.hand.length,
    isAlive: player.isAlive,
    inQuarantine: player.inQuarantine,
    quarantineTurnsLeft: player.quarantineTurnsLeft,
    position: player.position,
    isKnownInfectedToMe: false,
  }));

  const game: ViewerGameState = {
    ...state,
    players,
    pendingAction: state.pendingAction,
    tableAnim: null,
  };

  const room: RoomView = {
    code: 'ABCDE',
    me: {
      sessionId: 'host-session',
      name: players[viewerId].name,
      isHost: true,
      isSpectator: false,
      playerId: viewerId,
    },
    members: players.map((player) => ({
      sessionId: `session-${player.id}`,
      name: player.name,
      isHost: player.id === viewerId,
      isBot: false,
      isSpectator: false,
      playerId: player.id,
      connected: true,
      joinedAt: 0,
      stats: null,
    })),
    game,
    hostAddress: 'http://localhost:8787',
    updatedAt: Date.now(),
    shouts: [],
  };

  return {
    game,
    me: players[viewerId],
    room,
  };
}

describe('GameScreen six-player render', () => {
  it('renders an active six-player match without throwing', () => {
    const { game, me, room } = buildViewerGame(6);

    expect(() =>
      renderToString(
        <GameScreen
          error={null}
          game={game}
          loading={false}
          me={me}
          onToggleLang={() => undefined}
          onTogglePerformanceMode={() => undefined}
          performanceMode={false}
          room={room}
          onAction={async () => undefined}
          onCopy={async () => undefined}
          onLeave={() => undefined}
          onReset={async () => undefined}
          onShout={() => undefined}
        />,
      ),
    ).not.toThrow();
  });
});
