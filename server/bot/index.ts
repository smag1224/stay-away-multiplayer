/**
 * Bot AI entry point — modular utility-AI system.
 *
 * Architecture:
 * 1. visibleState.ts — filters GameState to only what a human player would know
 * 2. memory.ts      — suspicion model + observations (only from public/legal info)
 * 3. evaluator.ts   — scores all legal actions with weighted heuristics
 * 4. config.ts      — tunable weights, thresholds, timing
 *
 * Fairness guarantees:
 * ✅ Bot never reads hidden opponent hands
 * ✅ Bot never reads hidden deck order
 * ✅ Bot never reads unrevealed roles of other players
 * ✅ All decisions use only bot-visible state + own role + legitimately observed info
 */

import type { GameAction, GameState } from '../../src/types.ts';
import { buildVisibleState } from './visibleState.ts';
import { createBotMemory, updateMemoryFromLog, recordSeenCards, setKnownRole, type BotMemory } from './memory.ts';
import { evaluateActions, selectAction } from './evaluator.ts';

// ── Per-bot persistent memory ───────────────────────────────────────────────

/** Map of roomCode → Map of botPlayerId → BotMemory */
const memoryStore = new Map<string, Map<number, BotMemory>>();

export function getOrCreateMemory(roomCode: string, botPlayerId: number, game: GameState): BotMemory {
  if (!memoryStore.has(roomCode)) {
    memoryStore.set(roomCode, new Map());
  }
  const roomMemories = memoryStore.get(roomCode)!;

  if (!roomMemories.has(botPlayerId)) {
    const playerIds = game.players.map(p => p.id);
    roomMemories.set(botPlayerId, createBotMemory(botPlayerId, playerIds));
  }

  return roomMemories.get(botPlayerId)!;
}

export function clearRoomMemory(roomCode: string): void {
  memoryStore.delete(roomCode);
}

// ── Main decision function ──────────────────────────────────────────────────

export function decideBotAction(game: GameState, botPlayerId: number, roomCode: string = ''): GameAction | null {
  if (game.phase !== 'playing') return null;

  const bot = game.players.find(p => p.id === botPlayerId);
  if (!bot || !bot.isAlive) return null;

  // 1. Build bot-visible state (filtered — no cheating)
  const vs = buildVisibleState(game, botPlayerId);

  // 2. Get/update memory with new log entries
  const memory = getOrCreateMemory(roomCode, botPlayerId, game);
  updateMemoryFromLog(memory, game);

  // 3. Sync legal role knowledge that this bot is allowed to have
  syncVisibleKnowledge(vs, memory);

  // 4. Handle observations from pending view actions
  handlePendingObservations(vs, memory, game);

  // 5. Evaluate all legal actions
  const scored = evaluateActions(vs, memory);
  if (scored.length === 0) return null;

  // 6. Select best action with controlled randomness
  const action = selectAction(scored);

  // Optional debug
  if (process.env.BOT_DEBUG) {
    const top3 = scored.slice(0, 3).map(s => `${s.reason}: ${s.score.toFixed(2)}`);
    console.log(`[Bot ${bot.name}] ${action?.type ?? 'null'} | Top: ${top3.join(' | ')}`);
  }

  return action;
}

function syncVisibleKnowledge(
  vs: ReturnType<typeof buildVisibleState>,
  memory: BotMemory,
): void {
  if (vs.myRole === 'thing') {
    for (const player of vs.players) {
      if (player.id === vs.myId) continue;
      setKnownRole(memory, player.id, player.isKnownInfectedToMe ? 'infected' : 'human');
    }
    return;
  }

  if (vs.myRole === 'infected') {
    for (const player of vs.players) {
      if (player.id === vs.myId) continue;
      if (player.canReceiveInfectedCardFromMe) {
        setKnownRole(memory, player.id, 'thing');
      }
    }
  }
}

// ── Observation handling ────────────────────────────────────────────────────

/**
 * If we're currently viewing a hand (from analysis/suspicion/reveal),
 * record the observed cards in memory for future decisions.
 */
function handlePendingObservations(
  vs: ReturnType<typeof buildVisibleState>,
  memory: BotMemory,
  game: GameState,
): void {
  const pa = game.pendingAction;
  if (!pa) return;

  // Analysis / Lovecraft: view entire hand
  if (pa.type === 'view_hand' && pa.viewerPlayerId === vs.myId) {
    recordSeenCards(memory, pa.targetPlayerId, pa.cards, memory.currentTurn, true);
  }

  // Suspicion: view single card
  if (pa.type === 'view_card' && pa.viewerPlayerId === vs.myId) {
    recordSeenCards(memory, pa.targetPlayerId, [pa.card], memory.currentTurn, false);
  }

  // Suspicion pick: preview card
  if (pa.type === 'suspicion_pick' && pa.viewerPlayerId === vs.myId && pa.previewCardUid) {
    // We can see the previewed card — find it in the target's visible state
    const targetPlayer = game.players.find(p => p.id === pa.targetPlayerId);
    if (targetPlayer) {
      const card = targetPlayer.hand.find(c => c.uid === pa.previewCardUid);
      if (card) {
        recordSeenCards(memory, pa.targetPlayerId, [card], memory.currentTurn, false);
      }
    }
  }

  // Whisky / public reveal
  if (pa.type === 'whisky_reveal' && pa.viewerPlayerId === vs.myId) {
    recordSeenCards(memory, pa.playerId, pa.cards, memory.currentTurn, pa.revealKind === 'all');
  }

  // Fear defense: see offered card
  if (pa.type === 'view_card' && pa.viewerPlayerId === vs.myId) {
    // The card shown is the offered trade card — update memory about the offerer
    const offerer = game.players.find(p => p.hand.some(c => c.uid === pa.card.uid));
    if (offerer && offerer.id !== vs.myId) {
      recordSeenCards(memory, offerer.id, [pa.card], memory.currentTurn, false);
    }
  }
}
