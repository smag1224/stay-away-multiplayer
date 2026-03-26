import type { GameState, Player, CardInstance } from '../types.ts';
import { log } from './utils.ts';
import {
  currentPlayer,
  hasDoorBetween,
  nextPlayerIndexFromPosition,
  getTradePartner,
  validateTradeCard,
} from './helpers.ts';

// ── Player elimination ──────────────────────────────────────────────────────

export function eliminatePlayer(s: GameState, player: Player): void {
  player.isAlive = false;

  const actuallyTheThing = player.role === 'thing' || player.hand.some(c => c.defId === 'the_thing');

  s.discard.push(...player.hand);
  player.hand = [];

  log(s,
    `${player.name} has been eliminated!`,
    `${player.name} уничтожен(а)!`
  );

  if (actuallyTheThing) {
    const humans = s.players.filter(p => p.isAlive && p.role === 'human');
    s.winner = 'humans';
    s.winnerPlayerIds = humans.map(p => p.id);
    s.phase = 'game_over';
    log(s, 'The Thing has been destroyed! Humans win!',
        'Нечто уничтожено! Люди побеждают!');
  }
}

// ── Position swapping ───────────────────────────────────────────────────────

export function swapPositions(s: GameState, p1: Player, p2: Player): void {
  const temp = p1.position;
  p1.position = p2.position;
  p2.position = temp;
  s.seats[p1.position] = p1.id;
  s.seats[p2.position] = p2.id;
}

// ── Infection ───────────────────────────────────────────────────────────────

/** Check and apply infection after a card swap */
export function checkInfection(s: GameState, p1: Player, p2: Player, cardFromP1: CardInstance, cardFromP2: CardInstance): void {
  if (cardFromP1.defId === 'infected' && p1.role === 'thing' && p2.role === 'human') {
    p2.role = 'infected';
  }
  if (cardFromP2.defId === 'infected' && p2.role === 'thing' && p1.role === 'human') {
    p1.role = 'infected';
  }
  checkInfectionOverload(s, p1);
  checkInfectionOverload(s, p2);
}

/** If a player has 4+ infection cards, they die */
export function checkInfectionOverload(s: GameState, player: Player): void {
  if (!player.isAlive) return;
  const infectedCount = player.hand.filter(c => c.defId === 'infected').length;
  if (infectedCount >= 4) {
    log(s,
      `${player.name} accumulated ${infectedCount} infections and is eliminated!`,
      `${player.name} накопил(а) ${infectedCount} заражения и выбывает из игры!`
    );
    eliminatePlayer(s, player);
  }
}

export function resolveThingVictoryIfNoHumans(s: GameState): boolean {
  if (s.phase === 'game_over') return true;

  const humans = s.players.filter((player) => player.isAlive && player.role === 'human');
  if (humans.length > 0) return false;

  const thing = s.players.find((player) => player.isAlive && player.role === 'thing');
  if (!thing) return false;

  const infected = s.players.filter((player) => player.isAlive && player.role === 'infected');
  const eliminated = s.players.filter((player) => !player.isAlive);

  s.phase = 'game_over';
  if (eliminated.length === 0) {
    s.winner = 'thing_solo';
    s.winnerPlayerIds = [thing.id];
  } else {
    s.winner = 'thing';
    s.winnerPlayerIds = [thing.id, ...infected.map((player) => player.id)];
  }

  return true;
}

// ── Turn management ─────────────────────────────────────────────────────────

export function handleTradeStep(s: GameState): void {
  if (s.tradeSkipped) {
    s.step = 'end_turn';
    advanceTurn(s);
    return;
  }

  const cur = currentPlayer(s);
  const partner = getTradePartner(s);

  if (!partner || cur.inQuarantine || partner.inQuarantine ||
      hasDoorBetween(s, cur.position, partner.position)) {
    log(s, 'Trade skipped due to obstacles.', 'Обмен пропущен из-за препятствий.');
    s.step = 'end_turn';
    advanceTurn(s);
    return;
  }

  // If the current player has no valid cards to offer (e.g. only infected
  // cards and the partner is not The Thing), skip trade so advanceTurn can
  // run checkInfectionOverload and eliminate the player if needed.
  const hasTradeableCard = partner
    ? cur.hand.some(c => validateTradeCard(cur, partner, c))
    : false;
  if (!hasTradeableCard) {
    log(s, 'Trade skipped — no valid cards to offer.', 'Обмен пропущен — нет подходящих карт.');
    s.step = 'end_turn';
    advanceTurn(s);
  }
}

export function advanceTurn(s: GameState): void {
  const finishingPlayer = currentPlayer(s);
  const finishingPosition = finishingPlayer.position;

  if (finishingPlayer.inQuarantine) {
    finishingPlayer.quarantineTurnsLeft--;
    if (finishingPlayer.quarantineTurnsLeft <= 0) {
      finishingPlayer.inQuarantine = false;
      log(s, `${finishingPlayer.name}'s quarantine ended.`, `Карантин ${finishingPlayer.name} закончился.`);
    }
  }

  checkInfectionOverload(s, finishingPlayer);

  // Sanity check: warn if player ends turn with unexpected hand size
  if (finishingPlayer.isAlive && finishingPlayer.hand.length !== 4) {
    console.warn(
      `[HAND-SIZE] ${finishingPlayer.name} ended turn with ${finishingPlayer.hand.length} cards`,
      finishingPlayer.hand.map(c => c.defId)
    );
  }

  if (resolveThingVictoryIfNoHumans(s)) {
    s.step = 'draw';
    s.tradeSkipped = false;
    s.pendingAction = null;
    return;
  }

  const alive = s.players.filter((player) => player.isAlive);
  if (s.phase === 'game_over' || alive.length <= 1) {
    s.step = 'draw';
    s.tradeSkipped = false;
    s.pendingAction = null;
    if (alive.length <= 1 && s.phase !== 'game_over') {
      s.phase = 'game_over';
      s.winner = alive[0]?.role === 'thing' ? 'thing' : 'humans';
      s.winnerPlayerIds = alive.map((player) => player.id);
    }
    return;
  }

  s.currentPlayerIndex = nextPlayerIndexFromPosition(s, finishingPosition);
  s.step = 'draw';
  s.tradeSkipped = false;
  s.pendingAction = null;
}
