import type { GameState, Player, CardInstance } from '../types.ts';
import { getPlayer, drawEventCard } from './helpers.ts';
import { eliminatePlayer, swapPositions } from './mutations.ts';

// ── Card Effects ────────────────────────────────────────────────────────────

export function applyCardEffect(s: GameState, player: Player, card: CardInstance, targetId?: number): void {
  const target = targetId !== undefined ? getPlayer(s, targetId) : undefined;

  switch (card.defId) {
    case 'flamethrower': {
      if (!target) break;
      const hasDefense = target.hand.some(c => c.defId === 'no_barbecue');
      if (hasDefense) {
        s.pendingAction = {
          type: 'trade_defense',
          defenderId: target.id,
          fromId: player.id,
          offeredCardUid: card.uid,
          reason: 'flamethrower',
        };
        return;
      }
      eliminatePlayer(s, target);
      break;
    }

    case 'analysis': {
      if (!target) break;
      const hasAntiAnalysis = target.hand.some(c => c.defId === 'anti_analysis');
      if (hasAntiAnalysis) {
        s.pendingAction = {
          type: 'trade_defense',
          defenderId: target.id,
          fromId: player.id,
          offeredCardUid: card.uid,
          reason: 'analysis',
        };
        return;
      }
      s.pendingAction = {
        type: 'view_hand',
        targetPlayerId: target.id,
        cards: [...target.hand],
        viewerPlayerId: player.id,
      };
      break;
    }

    case 'suspicion': {
      if (!target || target.hand.length === 0) break;
      s.pendingAction = {
        type: 'suspicion_pick',
        targetPlayerId: target.id,
        viewerPlayerId: player.id,
        selectableCardUids: target.hand.map((item) => item.uid),
        previewCardUid: null,
      };
      break;
    }

    case 'whisky': {
      s.pendingAction = {
        type: 'whisky_reveal',
        playerId: player.id,
        cards: [...player.hand],
        viewerPlayerId: player.id,
        public: true,
      };
      break;
    }

    case 'persistence': {
      const drawn: CardInstance[] = [];
      for (let i = 0; i < 3; i++) {
        const c = drawEventCard(s);
        if (c) drawn.push(c);
      }
      if (drawn.length > 0) {
        s.pendingAction = { type: 'persistence_pick', drawnCards: drawn };
      }
      break;
    }

    case 'watch_your_back': {
      s.direction = s.direction === 1 ? -1 : 1;
      break;
    }

    case 'swap_places': {
      if (!target) break;
      const hasFineHere = target.hand.some(c => c.defId === 'im_fine_here');
      if (hasFineHere) {
        s.pendingAction = {
          type: 'trade_defense',
          defenderId: target.id,
          fromId: player.id,
          offeredCardUid: card.uid,
          reason: 'swap',
        };
        return;
      }
      swapPositions(s, player, target);
      break;
    }

    case 'you_better_run': {
      if (!target) break;
      const hasFineHere2 = target.hand.some(c => c.defId === 'im_fine_here');
      if (hasFineHere2) {
        s.pendingAction = {
          type: 'trade_defense',
          defenderId: target.id,
          fromId: player.id,
          offeredCardUid: card.uid,
          reason: 'swap',
        };
        return;
      }
      swapPositions(s, player, target);
      break;
    }

    case 'temptation': {
      if (!target) break;
      s.pendingAction = {
        type: 'choose_card_to_give',
        targetPlayerId: target.id,
      };
      break;
    }

    case 'axe': {
      if (!target) break;
      if (target.id === player.id) {
        player.inQuarantine = false;
        player.quarantineTurnsLeft = 0;
      } else {
        if (target.inQuarantine) {
          target.inQuarantine = false;
          target.quarantineTurnsLeft = 0;
        } else {
          s.doors = s.doors.filter(
            d => !((d.between[0] === player.position && d.between[1] === target.position) ||
                   (d.between[0] === target.position && d.between[1] === player.position))
          );
        }
      }
      break;
    }

    case 'quarantine': {
      if (!target) break;
      target.inQuarantine = true;
      target.quarantineTurnsLeft = 3;
      break;
    }

    case 'locked_door': {
      if (!target) break;
      s.doors.push({ between: [player.position, target.position] });
      break;
    }

    // ── Promo cards ──
    case 'lovecraft': {
      if (!target) break;
      s.pendingAction = {
        type: 'view_hand',
        targetPlayerId: target.id,
        cards: [...target.hand],
        viewerPlayerId: player.id,
      };
      break;
    }

    case 'necronomicon': {
      if (!target) break;
      eliminatePlayer(s, target);
      break;
    }
  }
}
