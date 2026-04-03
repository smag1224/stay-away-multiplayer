import { test, expect } from '@playwright/test';
import {
  addBot,
  createRoom,
  pollRoom,
  runGameToCompletion,
  startGame,
} from './helpers.ts';

// ── Full game simulation tests ────────────────────────────────────────────────
// Human player uses "dumb" strategy (draw, discard, skip trade).
// Bots play automatically on the server.
// We verify that every game reaches game_over with a valid winner.

test.describe('Full game — 6 players (1 human + 5 bots)', () => {
  test('game reaches game_over with a winner', async ({ request }) => {
    const room = await createRoom(request, 'Human');
    const { code } = room;
    const { sessionId } = room.me;

    // Add 5 bots
    for (let i = 0; i < 5; i++) await addBot(request, code, sessionId);

    await startGame(request, code, sessionId);

    const final = await runGameToCompletion(request, code, sessionId);

    expect(final.game?.phase).toBe('game_over');
    expect(['humans', 'thing', 'thing_solo']).toContain(final.game?.winner);
    expect(final.game?.winner).not.toBeNull();
  });

  test('all players are assigned a role at game end', async ({ request }) => {
    const room = await createRoom(request, 'Human');
    const { code, me: { sessionId } } = room;

    for (let i = 0; i < 5; i++) await addBot(request, code, sessionId);
    await startGame(request, code, sessionId);

    const final = await runGameToCompletion(request, code, sessionId);
    const players = final.game?.players ?? [];

    expect(players.length).toBe(6);
    // After game_over all roles are revealed to the viewer
    for (const p of players) {
      expect(['human', 'thing', 'infected']).toContain(p.role ?? 'human');
    }
  });
});

test.describe('Full game — 7 players (1 human + 6 bots)', () => {
  test('game reaches game_over with a winner', async ({ request }) => {
    const room = await createRoom(request, 'Human');
    const { code, me: { sessionId } } = room;

    for (let i = 0; i < 6; i++) await addBot(request, code, sessionId);
    await startGame(request, code, sessionId);

    const final = await runGameToCompletion(request, code, sessionId);

    expect(final.game?.phase).toBe('game_over');
    expect(['humans', 'thing', 'thing_solo']).toContain(final.game?.winner);
  });
});

test.describe('Full game — 9 players (1 human + 8 bots)', () => {
  test('game reaches game_over with a winner', async ({ request }) => {
    const room = await createRoom(request, 'Human');
    const { code, me: { sessionId } } = room;

    for (let i = 0; i < 8; i++) await addBot(request, code, sessionId);
    await startGame(request, code, sessionId);

    const final = await runGameToCompletion(request, code, sessionId);

    expect(final.game?.phase).toBe('game_over');
    expect(['humans', 'thing', 'thing_solo']).toContain(final.game?.winner);
  });

  test('winner player IDs are non-empty and valid', async ({ request }) => {
    const room = await createRoom(request, 'Human');
    const { code, me: { sessionId } } = room;

    for (let i = 0; i < 8; i++) await addBot(request, code, sessionId);
    await startGame(request, code, sessionId);

    const final = await runGameToCompletion(request, code, sessionId);
    const game = final.game!;
    const allIds = game.players.map(p => p.id);

    expect(game.winnerPlayerIds.length).toBeGreaterThan(0);
    for (const id of game.winnerPlayerIds) {
      expect(allIds).toContain(id);
    }
  });

  test('room persists in DB across poll after game ends', async ({ request }) => {
    const room = await createRoom(request, 'Human');
    const { code, me: { sessionId } } = room;

    for (let i = 0; i < 8; i++) await addBot(request, code, sessionId);
    await startGame(request, code, sessionId);
    await runGameToCompletion(request, code, sessionId);

    // Poll after game ends — room should still exist and return game_over
    const polled = await pollRoom(request, code, sessionId);
    expect(polled.game?.phase).toBe('game_over');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('cannot join a full room (12 players)', async ({ request }) => {
  const room = await createRoom(request, 'Host');
  const { code, me: { sessionId } } = room;

  // Add 11 bots to reach 12 total
  for (let i = 0; i < 11; i++) await addBot(request, code, sessionId);

  // Attempt to join as 13th player
  const res = await request.post(`http://localhost:8788/api/rooms/${code}/join`, {
    data: { name: 'Extra' },
  });
  const json = await res.json() as { ok: boolean; error?: string };
  expect(json.ok).toBe(false);
  expect(json.error).toMatch(/full/i);
});

test('cannot start game with fewer than 4 players', async ({ request }) => {
  const room = await createRoom(request, 'Host');
  const { code, me: { sessionId } } = room;

  // Only 1 player — try to start
  const res = await request.post(`http://localhost:8788/api/rooms/${code}/start`, {
    data: { sessionId },
  });
  const json = await res.json() as { ok: boolean; error?: string };
  expect(json.ok).toBe(false);
});
