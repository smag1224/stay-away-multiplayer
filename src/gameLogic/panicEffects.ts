import type { GameState, Player } from '../types.ts';
import type { CardInstance } from '../types.ts';
import { log } from './utils.ts';
import {
  currentPlayer,
  getAdjacentPositions,
  getPlayer,
  hasDoorBetween,
  playerAtPosition,
  drawEventCard,
} from './helpers.ts';
import { swapPositions } from './mutations.ts';
import { canDiscardCard } from './validation.ts';

// ── Panic Effects ───────────────────────────────────────────────────────────

export function applyPanicEffect(s: GameState, card: CardInstance): void {
  const cur = currentPlayer(s);

  switch (card.defId) {
    case 'panic_1234': {
      s.doors = [];
      log(s, 'All locked doors removed! (...Three, Four...)',
          'Все заколоченные двери убраны! (...Три, четыре...)');
      break;
    }

    case 'panic_one_two': {
      const alive = s.players.filter(p => p.isAlive);
      const alivePos = alive.map(p => p.position).sort((a, b) => a - b);
      const curIdx = alivePos.indexOf(cur.position);
      if (curIdx === -1 || alivePos.length < 4) {
        log(s, 'One, Two... — not enough players for swap.', 'Раз, два... — недостаточно игроков.');
        break;
      }
      const leftIdx = (curIdx - 3 + alivePos.length) % alivePos.length;
      const leftPlayer = alive.find(p => p.position === alivePos[leftIdx]);
      const rightIdx = (curIdx + 3) % alivePos.length;
      const rightPlayer = alive.find(p => p.position === alivePos[rightIdx]);

      const targets: number[] = [];
      if (leftPlayer && !leftPlayer.inQuarantine && leftPlayer.id !== cur.id) targets.push(leftPlayer.id);
      if (rightPlayer && !rightPlayer.inQuarantine && rightPlayer.id !== cur.id && rightPlayer.id !== leftPlayer?.id) targets.push(rightPlayer.id);

      if (targets.length === 0) {
        log(s, 'One, Two... — no valid targets (quarantine).', 'Раз, два... — нет доступных целей (карантин).');
      } else if (targets.length === 1) {
        swapPositions(s, cur, getPlayer(s, targets[0]));
        log(s, `One, Two... ${cur.name} swapped seats!`, `Раз, два... ${cur.name} поменялся(-ась) местами!`);
      } else {
        s.pendingAction = { type: 'panic_choose_target', panicDefId: 'panic_one_two', targets };
      }
      break;
    }

    case 'panic_party': {
      s.players.forEach(p => { p.inQuarantine = false; p.quarantineTurnsLeft = 0; });
      s.doors = [];
      log(s, 'Party! All quarantine and locked doors removed!',
          'Вечеринка! Все карантины и двери убраны!');

      const alive = s.players.filter(p => p.isAlive);
      const sorted = alive.slice().sort((a, b) => {
        const aOff = (a.position - cur.position + s.players.length) % s.players.length;
        const bOff = (b.position - cur.position + s.players.length) % s.players.length;
        return aOff - bOff;
      });
      for (let i = 0; i + 1 < sorted.length; i += 2) {
        swapPositions(s, sorted[i], sorted[i + 1]);
      }
      if (sorted.length >= 2) {
        log(s, 'Players swapped seats in pairs!', 'Игроки попарно поменялись местами!');
      }
      break;
    }

    case 'panic_chain_reaction': {
      const alive = s.players.filter(p => p.isAlive && p.hand.length > 0);
      if (alive.length < 2) break;
      s.pendingAction = {
        type: 'party_pass',
        pendingPlayerIds: alive.map(p => p.id),
        chosen: [],
        direction: s.direction,
      };
      break;
    }

    case 'panic_between_us': {
      const adjacent = getAdjacentPositions(s, cur.position);
      const targets = adjacent
        .map(pos => playerAtPosition(s, pos))
        .filter((p): p is Player => !!p && p.isAlive && !hasDoorBetween(s, cur.position, p.position))
        .map(p => p.id);
      if (targets.length === 0) {
        log(s, 'Just Between Us — no adjacent players.', 'Только между нами — нет соседних игроков.');
      } else if (targets.length === 1) {
        s.pendingAction = {
          type: 'view_hand',
          targetPlayerId: targets[0],
          cards: [...cur.hand],
          viewerPlayerId: targets[0],
          public: false,
        };
        log(s, `${cur.name} shows cards to ${getPlayer(s, targets[0]).name} (Just Between Us).`,
            `${cur.name} показывает карты ${getPlayer(s, targets[0]).name} (Только между нами).`);
      } else {
        s.pendingAction = { type: 'panic_choose_target', panicDefId: 'panic_between_us', targets };
      }
      break;
    }

    case 'panic_oops': {
      s.pendingAction = {
        type: 'whisky_reveal',
        playerId: cur.id,
        cards: [...cur.hand],
        viewerPlayerId: cur.id,
        public: true,
      };
      log(s, `Oops! ${cur.name} shows all cards to everyone!`,
          `Упс! ${cur.name} показывает все карты всем!`);
      break;
    }

    case 'panic_blind_date': {
      if (cur.hand.length === 0) break;
      s.pendingAction = { type: 'blind_date_swap' };
      break;
    }

    case 'panic_forgetful': {
      const discardable = cur.hand.filter(c => canDiscardCard(s, cur, c.uid));
      const toDiscard = Math.min(3, discardable.length);
      if (toDiscard === 0) {
        for (let i = 0; i < 3; i++) {
          const drawn = drawEventCard(s);
          if (drawn) cur.hand.push(drawn);
        }
        log(s, `${cur.name} drew new cards (Forgetful).`, `${cur.name} взял(а) новые карты (Забывчивость).`);
        s.log[0].fromPlayerId = cur.id;
      } else {
        s.pendingAction = { type: 'forgetful_discard', remaining: toDiscard };
      }
      break;
    }

    case 'panic_revelations': {
      const alive = s.players.filter(p => p.isAlive);
      if (alive.length < 2) break;
      const alivePos = alive.map(p => p.position).sort((a, b) => a - b);
      const curPosIdx = alivePos.indexOf(cur.position);
      const revealOrder: number[] = [];
      for (let i = 0; i < alive.length; i++) {
        const posIdx = (curPosIdx + i * s.direction + alivePos.length * alive.length) % alivePos.length;
        const player = alive.find(p => p.position === alivePos[posIdx]);
        if (player) revealOrder.push(s.players.indexOf(player));
      }
      s.pendingAction = { type: 'revelations_round', currentRevealerIdx: 0, revealOrder };
      log(s, 'Revelations! Each player decides whether to show their hand.',
          'Время признаний! Каждый игрок решает, показывать ли карты.');
      break;
    }

    case 'get_out_of_here': {
      const targets = s.players
        .filter(p => p.isAlive && p.id !== cur.id && !p.inQuarantine)
        .map(p => p.id);
      if (targets.length === 0) {
        log(s, 'Get Out of Here! — no valid targets.', 'Убирайся прочь! — нет доступных целей.');
      } else if (targets.length === 1) {
        swapPositions(s, cur, getPlayer(s, targets[0]));
        log(s, `${cur.name} swapped seats (Get Out of Here!)`, `${cur.name} поменялся(-ась) местами (Убирайся прочь!)`);
      } else {
        s.pendingAction = { type: 'panic_choose_target', panicDefId: 'get_out_of_here', targets };
      }
      break;
    }

    case 'cant_be_friends': {
      const targets = s.players
        .filter(p => p.isAlive && p.id !== cur.id && !p.inQuarantine)
        .map(p => p.id);
      if (targets.length === 0) {
        log(s, "Can't We Be Friends? — no valid targets.", 'Давай дружить? — нет доступных целей.');
      } else if (targets.length === 1) {
        s.pendingAction = { type: 'panic_trade', targetPlayerId: targets[0] };
      } else {
        s.pendingAction = { type: 'panic_choose_target', panicDefId: 'cant_be_friends', targets };
      }
      break;
    }

    case 'rotten_ropes': {
      s.players.forEach(p => { p.inQuarantine = false; p.quarantineTurnsLeft = 0; });
      log(s, 'Rotten Ropes! All quarantines removed!', 'Старые верёвки! Все карантины сняты!');
      break;
    }
  }
}

/** Resolve a panic card effect after target was selected */
export function resolvePanicTarget(s: GameState, panicDefId: string, targetPlayerId: number): void {
  const cur = currentPlayer(s);
  const target = getPlayer(s, targetPlayerId);

  switch (panicDefId) {
    case 'panic_one_two': {
      if (!target.inQuarantine) {
        swapPositions(s, cur, target);
        log(s, `One, Two... ${cur.name} swapped with ${target.name}!`,
            `Раз, два... ${cur.name} поменялся(-ась) с ${target.name}!`);
      } else {
        log(s, `One, Two... ${target.name} is in quarantine, no swap.`,
            `Раз, два... ${target.name} на карантине, обмен не произошёл.`);
      }
      s.step = 'draw';
      break;
    }
    case 'panic_between_us': {
      s.pendingAction = {
        type: 'view_hand',
        targetPlayerId: targetPlayerId,
        cards: [...cur.hand],
        viewerPlayerId: targetPlayerId,
        public: false,
      };
      log(s, `${cur.name} shows cards to ${target.name} (Just Between Us).`,
          `${cur.name} показывает карты ${target.name} (Только между нами).`);
      break;
    }
    case 'get_out_of_here': {
      swapPositions(s, cur, target);
      log(s, `${cur.name} swapped seats with ${target.name} (Get Out of Here!)`,
          `${cur.name} поменялся(-ась) местами с ${target.name} (Убирайся прочь!)`);
      s.step = 'draw';
      break;
    }
    case 'cant_be_friends': {
      s.pendingAction = { type: 'panic_trade', targetPlayerId: targetPlayerId };
      break;
    }
  }
}
