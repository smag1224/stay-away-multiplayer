import type { GameState, Player, CardInstance } from '../types.ts';
import { log } from './utils.ts';
import {
  currentPlayer,
  hasDoorBetween,
  nextPlayerIndex,
  getTradePartner,
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
  }
}

export function advanceTurn(s: GameState): void {
  const cur = currentPlayer(s);
  if (cur.inQuarantine) {
    cur.quarantineTurnsLeft--;
    if (cur.quarantineTurnsLeft <= 0) {
      cur.inQuarantine = false;
      log(s, `${cur.name}'s quarantine ended.`, `Карантин ${cur.name} закончился.`);
    }
  }

  s.currentPlayerIndex = nextPlayerIndex(s);
  s.step = 'draw';
  s.tradeSkipped = false;
  s.pendingAction = null;

  let safety = 0;
  while (!s.players[s.currentPlayerIndex].isAlive && safety < s.players.length) {
    s.currentPlayerIndex = nextPlayerIndex(s);
    safety++;
  }

  const alive = s.players.filter(p => p.isAlive);
  if (alive.length <= 1) {
    s.phase = 'game_over';
    s.winner = alive[0]?.role === 'thing' ? 'thing' : 'humans';
    s.winnerPlayerIds = alive.map(p => p.id);
  }
}
