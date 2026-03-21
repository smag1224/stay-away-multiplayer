import type { GameState, Player } from '../types.ts';
import { getCardDef } from '../cards.ts';
import {
  currentPlayer,
  getAdjacentPositions,
  getTradePartner,
  hasDoorBetween,
  playerAtPosition,
} from './helpers.ts';

// ── Valid Targets ────────────────────────────────────────────────────────────

/** Get valid targets for a card play */
export function getValidTargets(state: GameState, cardDefId: string): number[] {
  const cur = currentPlayer(state);
  const adjacent = getAdjacentPositions(state, cur.position);

  switch (cardDefId) {
    case 'flamethrower':
    case 'analysis':
    case 'suspicion': {
      return adjacent
        .filter(pos => !hasDoorBetween(state, cur.position, pos))
        .map(pos => playerAtPosition(state, pos)!)
        .filter(p => p && p.isAlive && !p.inQuarantine)
        .map(p => p.id);
    }
    case 'axe': {
      const targets: number[] = [];
      if (cur.inQuarantine) targets.push(cur.id);
      adjacent.forEach(pos => {
        const p = playerAtPosition(state, pos);
        if (p) {
          if (p.inQuarantine || hasDoorBetween(state, cur.position, pos)) {
            targets.push(p.id);
          }
        }
      });
      return targets;
    }
    case 'swap_places': {
      return adjacent
        .filter(pos => {
          const p = playerAtPosition(state, pos);
          return p && !p.inQuarantine && !hasDoorBetween(state, cur.position, pos);
        })
        .map(pos => playerAtPosition(state, pos)!.id);
    }
    case 'you_better_run': {
      return state.players
        .filter(p => p.isAlive && p.id !== cur.id && !p.inQuarantine)
        .map(p => p.id);
    }
    case 'quarantine': {
      const targets = [cur.id];
      adjacent
        .filter(pos => !hasDoorBetween(state, cur.position, pos))
        .forEach(pos => {
          const p = playerAtPosition(state, pos);
          if (p) targets.push(p.id);
        });
      return targets;
    }
    case 'locked_door': {
      return adjacent
        .filter(pos => !hasDoorBetween(state, cur.position, pos))
        .map(pos => playerAtPosition(state, pos)!)
        .filter(p => p !== undefined)
        .map(p => p.id);
    }
    case 'temptation': {
      return state.players
        .filter(p => p.isAlive && p.id !== cur.id && !p.inQuarantine)
        .map(p => p.id);
    }
    case 'lovecraft':
    case 'necronomicon': {
      return state.players
        .filter(p => p.isAlive && p.id !== cur.id)
        .map(p => p.id);
    }
    case 'whisky':
    case 'watch_your_back':
    case 'persistence': {
      return [];
    }
    default:
      return [];
  }
}

/** Can the current player play this card? */
export function canPlayCard(state: GameState, cardDefId: string): boolean {
  const cur = currentPlayer(state);
  const def = getCardDef(cardDefId);

  if (def.category === 'infection') return false;
  if (def.category === 'defense' && state.step !== 'trade_response') return false;
  if (def.category === 'panic') return false;
  if (cur.inQuarantine) return false;
  if (['whisky', 'watch_your_back', 'persistence'].includes(cardDefId)) return true;

  const targets = getValidTargets(state, cardDefId);
  if (['flamethrower', 'analysis', 'suspicion', 'swap_places',
       'you_better_run', 'quarantine', 'locked_door', 'temptation', 'axe',
       'lovecraft', 'necronomicon'].includes(cardDefId)) {
    return targets.length > 0;
  }

  return true;
}

export function canResolveSuspicionPick(state: GameState, cardUid: string): boolean {
  if (!state.pendingAction || state.pendingAction.type !== 'suspicion_pick') return false;
  return state.pendingAction.selectableCardUids.includes(cardUid);
}

// ── Card validation for discard ─────────────────────────────────────────────

export function canDiscardCard(_state: GameState, player: Player, cardUid: string): boolean {
  const card = player.hand.find(c => c.uid === cardUid);
  if (!card) return false;

  if (card.defId === 'the_thing') return false;

  if (player.role === 'infected' && card.defId === 'infected') {
    const infectedCount = player.hand.filter(c => c.defId === 'infected').length;
    if (infectedCount <= 1) return false;
  }

  return true;
}

// ── Card validation for trade ───────────────────────────────────────────────

export function canTradeCard(state: GameState, player: Player, cardUid: string): boolean {
  const card = player.hand.find(c => c.uid === cardUid);
  if (!card) return false;

  if (card.defId === 'the_thing') return false;

  if (card.defId === 'infected' && player.role !== 'thing') {
    if (player.role === 'infected') {
      const partner = getTradePartner(state);
      if (partner && partner.role === 'thing') return true;
    }
    return false;
  }

  if (player.role === 'infected' && card.defId === 'infected') {
    const infectedCount = player.hand.filter(c => c.defId === 'infected').length;
    if (infectedCount <= 1) return false;
  }

  return true;
}
