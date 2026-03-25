/**
 * Bot-visible state adapter.
 * Filters the full GameState to only what a human player would legitimately know.
 * This is the ONLY state input to all bot decision logic.
 */

import type { GameState, Player, CardInstance, PendingAction, LogEntry } from '../../src/types.ts';
import { currentPlayer, getAdjacentPositions, hasDoorBetween, playerAtPosition, getTradePartner } from '../../src/gameLogic/helpers.ts';
import { canPlayCard, canDiscardCard, canTradeCard, getValidTargets } from '../../src/gameLogic/validation.ts';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PublicPlayerInfo {
  id: number;
  name: string;
  position: number;
  isAlive: boolean;
  inQuarantine: boolean;
  quarantineTurnsLeft: number;
  handCount: number;
  /** Only set for the bot's own player */
  hand?: CardInstance[];
  /** Only set for the bot's own player */
  role?: string;
}

export interface BotVisibleState {
  /** The bot's own player ID */
  myId: number;
  /** The bot's own role */
  myRole: string;
  /** The bot's own hand */
  myHand: CardInstance[];
  /** The bot's own player */
  me: Player;

  /** Public info for all players */
  players: PublicPlayerInfo[];
  /** Alive players only */
  alivePlayers: PublicPlayerInfo[];

  /** Current turn player ID */
  currentPlayerId: number;
  /** Is it our turn? */
  isMyTurn: boolean;

  /** Current game step */
  step: string;
  /** Turn direction */
  direction: 1 | -1;
  /** Game phase */
  phase: string;

  /** Pending action (if any) */
  pendingAction: PendingAction | null;

  /** Locked doors */
  doors: GameState['doors'];

  /** Deck size (public info) */
  deckSize: number;
  /** Discard pile size */
  discardSize: number;

  /** Public game log */
  log: LogEntry[];

  /** Winner (if game over) */
  winner: string | null;

  /** Adjacent player IDs to the bot */
  myAdjacentIds: number[];

  /** Trade partner (next player in direction) */
  tradePartnerId: number | null;

  /** Playable cards from hand */
  playableCards: { card: CardInstance; defId: string; targets: number[] }[];

  /** Discardable cards from hand */
  discardableCards: CardInstance[];

  /** Tradeable cards from hand */
  tradeableCards: CardInstance[];

  /** Defense cards usable for current pending action */
  defenseCards: CardInstance[];

  /** Number of infection cards in our hand */
  myInfectedCount: number;

  /** Total alive player count */
  aliveCount: number;

  /** Has trade been skipped this turn? */
  tradeSkipped: boolean;

  /** Reshuffle count */
  reshuffleCount: number;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildVisibleState(game: GameState, botPlayerId: number): BotVisibleState {
  const bot = game.players.find(p => p.id === botPlayerId)!;
  const cur = currentPlayer(game);

  // Public player info
  const players: PublicPlayerInfo[] = game.players.map(p => ({
    id: p.id,
    name: p.name,
    position: p.position,
    isAlive: p.isAlive,
    inQuarantine: p.inQuarantine,
    quarantineTurnsLeft: p.quarantineTurnsLeft,
    handCount: p.hand.length,
    ...(p.id === botPlayerId ? { hand: p.hand, role: p.role } : {}),
  }));

  const alivePlayers = players.filter(p => p.isAlive);

  // My adjacency
  const adjPositions = getAdjacentPositions(game, bot.position);
  const myAdjacentIds = adjPositions
    .filter(pos => !hasDoorBetween(game, bot.position, pos))
    .map(pos => playerAtPosition(game, pos))
    .filter((p): p is Player => p !== undefined)
    .map(p => p.id);

  // Trade partner
  const partner = getTradePartner(game);
  const tradePartnerId = partner?.id ?? null;

  // Playable cards
  const playableCards = bot.hand
    .filter(c => canPlayCard(game, c.defId))
    .map(c => ({
      card: c,
      defId: c.defId,
      targets: getValidTargets(game, c.defId),
    }));

  // Discardable cards
  const discardableCards = bot.hand.filter(c => canDiscardCard(game, bot, c.uid));

  // Tradeable cards
  const tradeableCards = bot.hand.filter(c => canTradeCard(game, bot, c.uid));

  // Defense cards for current pending action
  const defenseCards = getAvailableDefenseCards(game, bot);

  const myInfectedCount = bot.hand.filter(c => c.defId === 'infected').length;

  return {
    myId: botPlayerId,
    myRole: bot.role,
    myHand: bot.hand,
    me: bot,
    players,
    alivePlayers,
    currentPlayerId: cur.id,
    isMyTurn: cur.id === botPlayerId,
    step: game.step,
    direction: game.direction,
    phase: game.phase,
    pendingAction: game.pendingAction,
    doors: game.doors,
    deckSize: game.deck.length,
    discardSize: game.discard.length,
    log: game.log,
    winner: game.winner,
    myAdjacentIds,
    tradePartnerId,
    playableCards,
    discardableCards,
    tradeableCards,
    defenseCards,
    myInfectedCount,
    aliveCount: alivePlayers.length,
    tradeSkipped: game.tradeSkipped,
    reshuffleCount: game.reshuffleCount,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getAvailableDefenseCards(game: GameState, bot: Player): CardInstance[] {
  const pa = game.pendingAction;
  if (!pa || pa.type !== 'trade_defense') return [];
  if (pa.defenderId !== bot.id) return [];

  const validDefenseIds = getValidDefenseIdsForReason(pa.reason);
  return bot.hand.filter(c => validDefenseIds.includes(c.defId));
}

function getValidDefenseIdsForReason(reason: string): string[] {
  switch (reason) {
    case 'trade':
    case 'temptation':
    case 'panic_trade':
      return ['fear', 'no_thanks', 'miss'];
    case 'flamethrower':
      return ['no_barbecue'];
    case 'analysis':
      return ['anti_analysis'];
    case 'swap':
      return ['im_fine_here'];
    default:
      return [];
  }
}
