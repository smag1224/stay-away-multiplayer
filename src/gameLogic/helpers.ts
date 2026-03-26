import type { GameState, Player, CardInstance } from '../types.ts';
import { CARD_DEFS, getCardDef } from '../cards.ts';
import { uid, shuffle, log } from './utils.ts';

// ── Neighbor / Seat Helpers ─────────────────────────────────────────────────

/** Get alive player positions in seat order */
export function alivePositions(state: GameState): number[] {
  return state.players
    .filter(p => p.isAlive)
    .map(p => p.position)
    .sort((a, b) => a - b);
}

/** Get adjacent alive positions to a given position */
export function getAdjacentPositions(state: GameState, position: number): number[] {
  const alive = alivePositions(state);
  if (alive.length <= 1) return [];
  const idx = alive.indexOf(position);
  if (idx === -1) return [];
  const left = alive[(idx - 1 + alive.length) % alive.length];
  const right = alive[(idx + 1) % alive.length];
  return left === right ? [left] : [left, right];
}

export function areAdjacentPlayers(state: GameState, player1Id: number, player2Id: number): boolean {
  const player1 = getPlayer(state, player1Id);
  const adjacent = getAdjacentPositions(state, player1.position);
  return adjacent.includes(getPlayer(state, player2Id).position);
}

/** Check if a locked door exists between two positions */
export function hasDoorBetween(state: GameState, pos1: number, pos2: number): boolean {
  return state.doors.some(
    d => (d.between[0] === pos1 && d.between[1] === pos2) ||
         (d.between[0] === pos2 && d.between[1] === pos1)
  );
}

/** Get player by ID */
export function getPlayer(state: GameState, id: number): Player {
  return state.players.find(p => p.id === id)!;
}

/** Get player at a seat position */
export function playerAtPosition(state: GameState, pos: number): Player | undefined {
  return state.players.find(p => p.position === pos && p.isAlive);
}

/** Get current active player */
export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

/** Get next player index based on a seat position, even if that player just died */
export function nextPlayerIndexFromPosition(state: GameState, position: number): number {
  const alivePos = alivePositions(state);
  if (alivePos.length <= 1) return state.currentPlayerIndex;

  let nextPos = alivePos[0];

  if (state.direction === 1) {
    nextPos = alivePos.find((seatPos) => seatPos > position) ?? alivePos[0];
  } else {
    nextPos = [...alivePos].reverse().find((seatPos) => seatPos < position) ?? alivePos[alivePos.length - 1];
  }

  const next = state.players.find((player) => player.position === nextPos && player.isAlive);
  return next ? state.players.indexOf(next) : state.currentPlayerIndex;
}

/** Get next player in turn direction */
export function nextPlayerIndex(state: GameState): number {
  return nextPlayerIndexFromPosition(state, currentPlayer(state).position);
}

/** Get the trade partner (next player in turn direction) */
export function getTradePartner(state: GameState): Player | null {
  const cur = currentPlayer(state);
  const alivePos = alivePositions(state);
  const curIdx = alivePos.indexOf(cur.position);
  const nextIdx = (curIdx + state.direction + alivePos.length) % alivePos.length;
  const nextPos = alivePos[nextIdx];
  return playerAtPosition(state, nextPos) || null;
}

// ── Deck Operations ─────────────────────────────────────────────────────────

/** Draw a card from deck, reshuffling discard if needed */
export function drawFromDeck(state: GameState): CardInstance | null {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    state.deck = shuffle([...state.discard]);
    state.discard = [];
    state.reshuffleCount += 1;
    log(state, 'Deck reshuffled from discard pile.', 'Колода перемешана из сброса.');
  }
  return state.deck.pop()!;
}

/** Draw an event card (skip panics, put them face-down in discard).
 *  Returns null if no event cards remain (all are in players' hands) —
 *  this is an accepted edge case in very late game. */
export function drawEventCard(state: GameState): CardInstance | null {
  // Count event cards still available (deck + discard)
  const available = [...state.deck, ...state.discard]
    .filter(c => getCardDef(c.defId).back === 'event').length;
  if (available === 0) return null;

  let attempts = 0;
  while (attempts < 200) {
    const card = drawFromDeck(state);
    if (!card) return null;
    const def = getCardDef(card.defId);
    if (def.back === 'event') return card;
    state.discard.push(card);
    attempts++;
  }
  return null;
}

// ── Build Deck ──────────────────────────────────────────────────────────────

export function buildDeck(playerCount: number): { deck: CardInstance[]; thingCard: CardInstance } {
  const cards: CardInstance[] = [];
  let thingCard: CardInstance | null = null;

  const countIdx = Math.min(Math.max(playerCount - 4, 0), 7);

  for (const def of CARD_DEFS) {
    if (def.category === 'promo') continue;
    if (def.minPlayers > playerCount) continue;

    const copies = def.copiesByPlayerCount ? def.copiesByPlayerCount[countIdx] : def.copies;
    for (let i = 0; i < copies; i++) {
      const card: CardInstance = { uid: uid(), defId: def.id };
      if (def.id === 'the_thing') {
        thingCard = card;
      } else {
        cards.push(card);
      }
    }
  }

  if (!thingCard) throw new Error('The Thing card not found');
  shuffle(cards);
  return { deck: cards, thingCard };
}

/** Check if a card requires a target selection */
export function needsTarget(defId: string): boolean {
  return ['flamethrower', 'analysis', 'axe', 'suspicion', 'swap_places',
          'you_better_run', 'quarantine', 'locked_door', 'temptation',
          'lovecraft', 'necronomicon'].includes(defId);
}

/** Validate if a player can give a specific card in a trade/temptation context */
export function validateTradeCard(giver: Player, _receiver: Player, card: CardInstance): boolean {
  if (card.defId === 'the_thing') return false;
  if (card.defId === 'infected') {
    if (giver.role === 'thing') return true;
    if (giver.role === 'infected') {
      if (_receiver.role !== 'thing') return false;
      if (giver.hand.filter(c => c.defId === 'infected').length <= 1) return false;
      return true;
    }
    return false;
  }
  return true;
}
