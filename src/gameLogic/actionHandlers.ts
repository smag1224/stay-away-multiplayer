import type { GameState, GameAction, Player, Role } from '../types.ts';
import { PLAYER_AVATAR_IDS } from '../avatarCatalog.ts';
import { getCardDef } from '../cards.ts';
import { log, shuffle } from './utils.ts';
import {
  currentPlayer,
  getPlayer,
  getTradePartner,
  hasDoorBetween,
  playerAtPosition,
  alivePositions,
  areAdjacentPlayers,
  drawFromDeck,
  drawEventCard,
  buildDeck,
  needsTarget,
  validateTradeCard,
} from './helpers.ts';
import {
  eliminatePlayer,
  swapPositions,
  checkInfection,
  checkInfectionOverload,
  handleTradeStep,
  advanceTurn,
} from './mutations.ts';
import { applyCardEffect } from './cardEffects.ts';
import { applyPanicEffect, resolvePanicTarget } from './panicEffects.ts';
import { canDiscardCard, canTradeCard, getValidTargets } from './validation.ts';

// Type for the recursive reducer callback needed by PLAY_CARD and SELECT_TARGET
export type GameReducerFn = (state: GameState, action: GameAction) => GameState;

type TradeDefenseReason = 'trade' | 'temptation' | 'flamethrower' | 'swap' | 'analysis' | 'panic_trade';

function resolveDefenseSelfElimination(s: GameState, reason: TradeDefenseReason): GameState {
  s.pendingAction = null;

  if (s.phase === 'game_over') return s;

  if (reason === 'panic_trade') {
    s.step = 'draw';
    return s;
  }

  if (reason === 'trade' || reason === 'temptation') {
    s.step = 'end_turn';
    advanceTurn(s);
    return s;
  }

  if (s.step === 'play_or_discard') {
    s.step = 'trade';
    handleTradeStep(s);
  }

  return s;
}

// ── Handler functions ───────────────────────────────────────────────────────

export function handleSetLang(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'SET_LANG') return s;
  s.lang = action.lang;
  return s;
}

export function handleStartGame(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'START_GAME') return s;
  const names = action.playerNames;
  const count = names.length;
  const { deck, thingCard } = buildDeck(count);
  const avatarPool = shuffle([...PLAYER_AVATAR_IDS]);
  console.log('[handleStartGame] PLAYER_AVATAR_IDS:', PLAYER_AVATAR_IDS, 'avatarPool:', avatarPool);

  while (avatarPool.length < count) {
    avatarPool.push(...shuffle([...PLAYER_AVATAR_IDS]));
  }

  const eventCards = deck.filter(c => getCardDef(c.defId).back === 'event' && c.defId !== 'infected');
  const infectedCards = deck.filter(c => c.defId === 'infected');
  const panicCards = deck.filter(c => getCardDef(c.defId).back === 'panic');

  const players: Player[] = names.map((name, i) => ({
    id: i,
    name,
    role: 'human' as Role,
    avatarId: avatarPool[i],
    hand: [],
    isAlive: true,
    inQuarantine: false,
    quarantineTurnsLeft: 0,
    position: i,
  }));

  // In Anomaly mode we keep strong cards in the deck as much as possible.
  // Some player counts do not have enough non-strong event cards for a full
  // opening deal, so we spill only the minimum required number into hands.
  const STRONG_CARD_IDS = ['flamethrower', 'analysis', 'no_barbecue', 'persistence', 'anti_analysis', 'fear', 'quarantine'];

  if (action.chaosMode) {
    // Anomaly: The Thing's position is random (50/50 in deck or hand).
    const strongCards = shuffle(eventCards.filter(c => STRONG_CARD_IDS.includes(c.defId)));
    const normalCards = shuffle(eventCards.filter(c => !STRONG_CARD_IDS.includes(c.defId)));
    const thingOnHand = Math.random() < 0.5;
    const requiredDealCards = count * 4 - (thingOnHand ? 1 : 0);
    const strongOverflowCount = Math.max(0, requiredDealCards - normalCards.length);
    const overflowStrongCards = strongCards.splice(0, strongOverflowCount);
    const dealPool = shuffle([...normalCards, ...overflowStrongCards]);

    if (thingOnHand) {
      const thingPlayerIdx = Math.floor(Math.random() * count);
      players[thingPlayerIdx].role = 'thing';
      for (let i = 0; i < count; i++) {
        if (i === thingPlayerIdx) {
          players[i].hand.push(thingCard);
          for (let j = 0; j < 3; j++) { const c = dealPool.pop(); if (c) players[i].hand.push(c); }
        } else {
          for (let j = 0; j < 4; j++) { const c = dealPool.pop(); if (c) players[i].hand.push(c); }
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < 4; j++) { const c = dealPool.pop(); if (c) players[i].hand.push(c); }
      }
    }

    const mainDeck = [...dealPool, ...strongCards, ...(thingOnHand ? [] : [thingCard]), ...infectedCards, ...panicCards];
    shuffle(mainDeck);
    s.deck = mainDeck;
  } else if (action.thingInDeck) {
    const dealPool = shuffle([...eventCards]);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 4; j++) {
        const card = dealPool.pop();
        if (card) players[i].hand.push(card);
      }
    }
    const mainDeck = [...dealPool, thingCard, ...infectedCards, ...panicCards];
    shuffle(mainDeck);
    s.deck = mainDeck;
  } else {
    const thingPlayerIdx = Math.floor(Math.random() * count);
    players[thingPlayerIdx].role = 'thing';
    shuffle(eventCards);

    for (let i = 0; i < count; i++) {
      if (i === thingPlayerIdx) {
        players[i].hand.push(thingCard);
        for (let j = 0; j < 3; j++) {
          const card = eventCards.pop();
          if (card) players[i].hand.push(card);
        }
      } else {
        for (let j = 0; j < 4; j++) {
          const card = eventCards.pop();
          if (card) players[i].hand.push(card);
        }
      }
    }

    const mainDeck = [...eventCards, ...infectedCards, ...panicCards];
    shuffle(mainDeck);
    s.deck = mainDeck;
  }

  s.players = players;
  s.seats = players.map(p => p.id);
  s.phase = 'role_reveal';
  s.revealingPlayer = 0;
  s.currentPlayerIndex = 0;
  s.step = 'draw';
  s.direction = 1;
  log(s, `Game started with ${count} players.`, `Игра началась с ${count} игроками.`);
  return s;
}

export function handleRevealNext(s: GameState, _originalState: GameState, _action: GameAction): GameState {
  if (s.revealingPlayer < s.players.length - 1) {
    s.revealingPlayer++;
  } else {
    s.phase = 'playing';
    s.step = 'draw';
    s.currentPlayerIndex = 0;
    log(s, 'All players have seen their cards. Game begins!',
        'Все игроки увидели свои карты. Игра начинается!');
  }
  return s;
}

export function handleDrawCard(s: GameState, _originalState: GameState, _action: GameAction): GameState {
  if (s.step !== 'draw') return s;
  if (s.pendingAction) return s;
  s.panicAnnouncement = null;
  const cur = currentPlayer(s);
  const card = drawFromDeck(s);
  if (!card) return s;

  const def = getCardDef(card.defId);

  if (def.back === 'panic') {
    log(s,
      `${cur.name} drew panic card: ${def.name}`,
      `${cur.name} вытянул(а) панику: ${def.nameRu}`
    );
    s.log[0].fromPlayerId = cur.id;
    s.panicAnnouncement = card.defId;
    applyPanicEffect(s, card);
    s.discard.push(card);
    if (!s.pendingAction) {
      s.step = 'draw';
    }
  } else if (card.defId === 'the_thing') {
    cur.role = 'thing';
    cur.hand.push(card);
    log(s, `${cur.name} drew a card.`, `${cur.name} взял(а) карту.`);
    s.log[0].fromPlayerId = cur.id;
    s.step = 'play_or_discard';
  } else {
    cur.hand.push(card);
    log(s,
      `${cur.name} drew a card.`,
      `${cur.name} взял(а) карту.`
    );
    s.log[0].fromPlayerId = cur.id;

    if (cur.inQuarantine) {
      s.pendingAction = { type: 'choose_card_to_discard' };
      s.step = 'play_or_discard';
    } else {
      s.step = 'play_or_discard';
    }
  }
  return s;
}

export function handleDiscardCard(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'DISCARD_CARD') return s;
  const cur = currentPlayer(s);
  if (!canDiscardCard(s, cur, action.cardUid)) return s;

  const idx = cur.hand.findIndex(c => c.uid === action.cardUid);
  if (idx === -1) return s;
  const [discarded] = cur.hand.splice(idx, 1);
  s.discard.push(discarded);
  s.pendingAction = null;

  log(s, `${cur.name} discarded a card.`, `${cur.name} сбросил(а) карту.`);

  if (s.step === 'play_or_discard') {
    s.step = 'trade';
    handleTradeStep(s);
  }
  return s;
}

export function handlePlayCard(
  s: GameState, originalState: GameState, action: GameAction,
  gameReducer: GameReducerFn,
): GameState {
  if (action.type !== 'PLAY_CARD') return s;
  const cur = currentPlayer(s);
  const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
  if (cardIdx === -1) return s;

  const card = cur.hand[cardIdx];
  const def = getCardDef(card.defId);

  if (needsTarget(card.defId) && action.targetPlayerId === undefined) {
    const targets = getValidTargets(s, card.defId);
    if (targets.length === 0) return s;
    if (targets.length === 1) {
      return gameReducer(originalState, { ...action, targetPlayerId: targets[0] });
    }
    s.pendingAction = { type: 'choose_target', cardUid: card.uid, cardDefId: card.defId, targets };
    return s;
  }

  if (needsTarget(card.defId) && action.targetPlayerId !== undefined) {
    const targets = getValidTargets(s, card.defId);
    if (!targets.includes(action.targetPlayerId)) return s;
  }

  cur.hand.splice(cardIdx, 1);
  applyCardEffect(s, cur, card, action.targetPlayerId);

  if (def.category !== 'obstacle') {
    s.discard.push(card);
  }

  log(s,
    `${cur.name} played ${def.name}${action.targetPlayerId !== undefined ? ` on ${getPlayer(s, action.targetPlayerId).name}` : ''}.`,
    `${cur.name} сыграл(а) ${def.nameRu}${action.targetPlayerId !== undefined ? ` на ${getPlayer(s, action.targetPlayerId).name}` : ''}.`
  );
  // Tag the log entry so all clients can animate the played card
  s.log[0].cardDefId = card.defId;
  s.log[0].fromPlayerId = cur.id;
  if (action.targetPlayerId !== undefined) {
    s.log[0].targetPlayerId = action.targetPlayerId;
  }

  if (s.step === 'play_or_discard' && !s.pendingAction) {
    s.step = 'trade';
    handleTradeStep(s);
  }

  return s;
}

export function handleSelectTarget(
  s: GameState, _originalState: GameState, action: GameAction,
  gameReducer: GameReducerFn,
): GameState {
  if (action.type !== 'SELECT_TARGET') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'choose_target') return s;
  const { cardUid } = s.pendingAction;
  s.pendingAction = null;
  return gameReducer(s, { type: 'PLAY_CARD', cardUid, targetPlayerId: action.targetPlayerId });
}

export function handleSuspicionPreviewCard(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'SUSPICION_PREVIEW_CARD') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'suspicion_pick') return s;
  if (!s.pendingAction.selectableCardUids.includes(action.cardUid)) return s;

  s.pendingAction = {
    ...s.pendingAction,
    previewCardUid: action.cardUid,
  };
  return s;
}

export function handleSuspicionConfirmCard(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'SUSPICION_CONFIRM_CARD') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'suspicion_pick') return s;
  if (!s.pendingAction.selectableCardUids.includes(action.cardUid)) return s;

  const { targetPlayerId, viewerPlayerId } = s.pendingAction;
  const target = getPlayer(s, targetPlayerId);
  const chosenCard = target.hand.find((card) => card.uid === action.cardUid);

  if (!chosenCard) return s;

  s.pendingAction = {
    type: 'view_card',
    targetPlayerId,
    viewerPlayerId,
    card: chosenCard,
  };
  return s;
}

export function handleOfferTrade(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'OFFER_TRADE') return s;
  if (s.step !== 'trade') return s;
  const cur = currentPlayer(s);
  if (!canTradeCard(s, cur, action.cardUid)) return s;

  const partner = getTradePartner(s);
  if (!partner) {
    s.step = 'end_turn';
    return s;
  }

  if (cur.inQuarantine || partner.inQuarantine ||
      hasDoorBetween(s, cur.position, partner.position)) {
    s.step = 'end_turn';
    return s;
  }

  s.pendingAction = {
    type: 'trade_defense',
    defenderId: partner.id,
    fromId: cur.id,
    offeredCardUid: action.cardUid,
    reason: 'trade',
  };
  s.step = 'trade_response';

  log(s,
    `${cur.name} offers a trade to ${partner.name}.`,
    `${cur.name} предлагает обмен ${partner.name}.`
  );
  s.log[0].fromPlayerId = cur.id;
  s.log[0].targetPlayerId = partner.id;
  return s;
}

export function handleRespondTrade(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'RESPOND_TRADE') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'trade_defense' || s.pendingAction.reason !== 'trade') return s;
  const { fromId, defenderId, offeredCardUid } = s.pendingAction;
  const from = getPlayer(s, fromId);
  const defender = getPlayer(s, defenderId);
  const defendingCard = defender.hand.find((card) => card.uid === action.cardUid);

  if (!defendingCard || !validateTradeCard(defender, from, defendingCard)) return s;

  const fromCardIdx = from.hand.findIndex(c => c.uid === offeredCardUid);
  const defCardIdx = defender.hand.findIndex(c => c.uid === action.cardUid);
  if (fromCardIdx === -1 || defCardIdx === -1) return s;

  const fromCard = from.hand[fromCardIdx];
  const defCard = defender.hand[defCardIdx];
  from.hand[fromCardIdx] = defCard;
  defender.hand[defCardIdx] = fromCard;

  checkInfection(s, from, defender, fromCard, defCard);

  log(s,
    `${from.name} and ${defender.name} traded cards.`,
    `${from.name} и ${defender.name} обменялись картами.`
  );
  s.log[0].fromPlayerId = from.id;
  s.log[0].targetPlayerId = defender.id;

  s.pendingAction = null;
  s.step = 'end_turn';
  advanceTurn(s);
  return s;
}

export function handlePlayDefense(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'PLAY_DEFENSE') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'trade_defense') return s;
  const { fromId, defenderId, offeredCardUid, reason } = s.pendingAction;
  const defender = getPlayer(s, defenderId);

  const cardIdx = defender.hand.findIndex(c => c.uid === action.cardUid);
  if (cardIdx === -1) return s;
  const card = defender.hand[cardIdx];
  const def = getCardDef(card.defId);

  if (def.category !== 'defense') return s;

  const allowedDefenseIds =
    reason === 'trade' || reason === 'temptation' || reason === 'panic_trade'
      ? ['fear', 'no_thanks', 'miss']
      : reason === 'flamethrower'
        ? ['no_barbecue']
        : reason === 'analysis'
          ? ['anti_analysis']
          : ['im_fine_here'];

  if (!allowedDefenseIds.includes(card.defId)) return s;

  defender.hand.splice(cardIdx, 1);
  s.discard.push(card);

  const replacement = drawEventCard(s);
  if (replacement) defender.hand.push(replacement);
  checkInfectionOverload(s, defender);
  if (!defender.isAlive) {
    return resolveDefenseSelfElimination(s, reason);
  }

  switch (card.defId) {
    case 'no_thanks': {
      if (reason === 'temptation') {
        s.tradeSkipped = true;
      }
      log(s, `${defender.name} played No Thanks! Trade refused.`,
          `${defender.name} сыграл(а) «Нет уж, спасибо!» Обмен отклонён.`);
      s.log[0].cardDefId = card.defId;
      s.pendingAction = null;
      if (reason === 'panic_trade') {
        s.step = 'draw';
      } else {
        s.step = 'end_turn';
        advanceTurn(s);
      }
      break;
    }
    case 'fear': {
      const from = getPlayer(s, fromId);
      const offeredCard = from.hand.find(c => c.uid === offeredCardUid);
      if (reason === 'temptation') {
        s.tradeSkipped = true;
      }
      if (offeredCard) {
        s.pendingAction = {
          type: 'view_card',
          targetPlayerId: fromId,
          card: offeredCard,
          viewerPlayerId: defender.id,
        };
      }
      log(s, `${defender.name} played Fear! Trade refused, card viewed.`,
          `${defender.name} сыграл(а) «Страх!» Обмен отклонён, карта просмотрена.`);
      s.log[0].cardDefId = card.defId;
      break;
    }
    case 'miss': {
      if (reason === 'temptation') {
        s.tradeSkipped = true;
        log(s, `${defender.name} played Miss! Temptation cancelled.`,
            `${defender.name} сыграл(а) «Мимо!» «Соблазн» отменён.`);
        s.log[0].cardDefId = card.defId;
        s.pendingAction = null;
        s.step = 'end_turn';
        advanceTurn(s);
        break;
      }

      log(s, `${defender.name} played Miss! Next player must trade instead.`,
          `${defender.name} сыграл(а) «Мимо!» Следующий игрок обменивается.`);
      s.log[0].cardDefId = card.defId;
      const alivePos = alivePositions(s);
      const defPosIdx = alivePos.indexOf(defender.position);
      const nextIdx = (defPosIdx + s.direction + alivePos.length) % alivePos.length;
      const nextPos = alivePos[nextIdx];
      const nextP = playerAtPosition(s, nextPos);
      const canRedirect =
        nextP &&
        nextP.id !== fromId &&
        !nextP.inQuarantine &&
        (
          reason === 'panic_trade' ||
          !hasDoorBetween(s, getPlayer(s, fromId).position, nextP.position)
        );
      if (canRedirect && nextP) {
        s.pendingAction = {
          type: 'trade_defense',
          defenderId: nextP.id,
          fromId,
          offeredCardUid,
          reason,
        };
      } else {
        s.pendingAction = null;
        if (reason === 'panic_trade') {
          s.step = 'draw';
        } else {
          s.step = 'end_turn';
          advanceTurn(s);
        }
      }
      break;
    }
    case 'no_barbecue': {
      log(s, `${defender.name} played No Barbecue! Flamethrower cancelled.`,
          `${defender.name} сыграл(а) «Никакого шашлыка!» Огнемёт отменён.`);
      s.log[0].cardDefId = card.defId;
      s.pendingAction = null;
      if (s.step === 'play_or_discard') {
        s.step = 'trade';
        handleTradeStep(s);
      }
      break;
    }
    case 'im_fine_here': {
      log(s, `${defender.name} played I'm Fine Here! Swap cancelled.`,
          `${defender.name} сыграл(а) «Мне и здесь неплохо!» Обмен местами отменён.`);
      s.log[0].cardDefId = card.defId;
      s.pendingAction = null;
      if (s.step === 'play_or_discard') {
        s.step = 'trade';
        handleTradeStep(s);
      }
      break;
    }
    case 'anti_analysis': {
      log(s, `${defender.name} played Anti-Analysis! Analysis cancelled.`,
          `${defender.name} сыграл(а) «Анти-Анализ!» Анализ отменён.`);
      s.log[0].cardDefId = card.defId;
      s.pendingAction = null;
      if (s.step === 'play_or_discard') {
        s.step = 'trade';
        handleTradeStep(s);
      }
      break;
    }
  }
  return s;
}

export function handleDeclineDefense(s: GameState, _originalState: GameState, _action: GameAction): GameState {
  if (!s.pendingAction || s.pendingAction.type !== 'trade_defense') return s;
  const { fromId, defenderId, reason } = s.pendingAction;
  const defFrom = getPlayer(s, fromId);
  const defTarget = getPlayer(s, defenderId);

  s.pendingAction = null;

  if (reason === 'flamethrower') {
    log(s,
      `${defTarget.name} chose not to defend against Flamethrower.`,
      `${defTarget.name} решил(а) не защищаться от Огнемёта.`
    );
    eliminatePlayer(s, defTarget);
    if (s.phase !== 'game_over' && s.step === 'play_or_discard') {
      s.step = 'trade';
      handleTradeStep(s);
    }
  } else if (reason === 'analysis') {
    log(s,
      `${defTarget.name} chose not to defend against Analysis.`,
      `${defTarget.name} решил(а) не защищаться от Анализа.`
    );
    s.pendingAction = {
      type: 'view_hand',
      targetPlayerId: defTarget.id,
      cards: [...defTarget.hand],
      viewerPlayerId: defFrom.id,
    };
    return s;
  } else if (reason === 'swap') {
    log(s,
      `${defTarget.name} chose not to defend against the swap.`,
      `${defTarget.name} решил(а) не защищаться от перемещения.`
    );
    swapPositions(s, defFrom, defTarget);
    if (s.step === 'play_or_discard') {
      s.step = 'trade';
      handleTradeStep(s);
    }
  }
  return s;
}

export function handleEndTurn(s: GameState, _originalState: GameState, _action: GameAction): GameState {
  if (s.step !== 'end_turn') return s;
  advanceTurn(s);
  return s;
}

export function handleConfirmView(s: GameState, _originalState: GameState, _action: GameAction): GameState {
  if (s.pendingAction?.type === 'whisky_reveal' && s.pendingAction.revelationsResume) {
    const { revealOrder, nextRevealerIdx } = s.pendingAction.revelationsResume;
    if (nextRevealerIdx === null || nextRevealerIdx >= revealOrder.length) {
      s.pendingAction = null;
      s.step = 'draw';
      return s;
    }

    s.pendingAction = {
      type: 'revelations_round',
      revealOrder,
      currentRevealerIdx: nextRevealerIdx,
    };
    return s;
  }

  s.pendingAction = null;
  if (s.step === 'trade_response') {
    s.step = 'end_turn';
    advanceTurn(s);
  } else if (s.step === 'play_or_discard') {
    s.step = 'trade';
    handleTradeStep(s);
  } else if (s.step === 'end_turn') {
    advanceTurn(s);
  }
  return s;
}

export function handlePersistencePick(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'PERSISTENCE_PICK') return s;
  const cur = currentPlayer(s);
  if (s.pendingAction?.type === 'persistence_pick') {
    const { drawnCards } = s.pendingAction;
    const keep = drawnCards.find(c => c.uid === action.keepUid);
    if (keep) {
      cur.hand.push(keep);
      drawnCards.filter(c => c.uid !== action.keepUid).forEach(c => s.discard.push(c));
    }
    s.pendingAction = null;
    s.step = 'play_or_discard';
  }
  return s;
}

export function handleDeclareVictory(s: GameState, _originalState: GameState, _action: GameAction): GameState {
  const cur = currentPlayer(s);
  if (cur.role !== 'thing') return s;

  const humans = s.players.filter(p => p.isAlive && p.role === 'human');
  if (humans.length === 0) {
    const infected = s.players.filter(p => p.isAlive && p.role === 'infected');
    const eliminated = s.players.filter(p => !p.isAlive);
    if (infected.length === 0 && eliminated.length === 0) {
      s.winner = 'thing_solo';
      s.winnerPlayerIds = [cur.id];
    } else if (eliminated.length === 0) {
      s.winner = 'thing_solo';
      s.winnerPlayerIds = [cur.id];
    } else {
      s.winner = 'thing';
      s.winnerPlayerIds = [cur.id, ...infected.map(p => p.id)];
    }
    log(s, 'The Thing declares victory — no humans remain!',
        'Нечто объявляет победу — людей больше нет!');
  } else {
    s.winner = 'humans';
    s.winnerPlayerIds = humans.map(p => p.id);
    log(s, 'The Thing declared victory incorrectly — Humans win!',
        'Нечто ошиблось — люди побеждают!');
  }
  s.phase = 'game_over';
  return s;
}

export function handleTemptationSelect(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'TEMPTATION_SELECT') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'choose_card_to_give') return s;
  const cur = currentPlayer(s);
  const target = getPlayer(s, s.pendingAction.targetPlayerId);

  const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
  if (cardIdx === -1) return s;

  const curCard = cur.hand[cardIdx];
  if (!validateTradeCard(cur, target, curCard)) return s;

  const targetHasDefense = target.hand.some((card) => ['fear', 'no_thanks', 'miss'].includes(card.defId));
  const targetHasTradeableCard = target.hand.some((card) => validateTradeCard(target, cur, card));

  if (!targetHasDefense && !targetHasTradeableCard) {
    s.pendingAction = null;
    s.tradeSkipped = true;
    log(s,
      `${target.name} has no valid response to Temptation. The action is cancelled.`,
      `${target.name} не может ответить на «Соблазн». Действие отменяется.`
    );
    s.step = 'end_turn';
    advanceTurn(s);
    return s;
  }

  s.pendingAction = {
    type: 'trade_defense',
    defenderId: target.id,
    fromId: cur.id,
    offeredCardUid: curCard.uid,
    reason: 'temptation',
  };
  s.step = 'trade_response';
  return s;
}

export function handleTemptationRespond(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'TEMPTATION_RESPOND') return s;
  if (!s.pendingAction || (
    s.pendingAction.type !== 'temptation_response' &&
    !(s.pendingAction.type === 'trade_defense' && s.pendingAction.reason === 'temptation')
  )) return s;

  const { fromId, toId, offeredCardUid } = s.pendingAction.type === 'trade_defense'
    ? {
        fromId: s.pendingAction.fromId,
        toId: s.pendingAction.defenderId,
        offeredCardUid: s.pendingAction.offeredCardUid,
      }
    : s.pendingAction;

  const from = getPlayer(s, fromId);
  const target = getPlayer(s, toId);

  const fromCardIdx = from.hand.findIndex(c => c.uid === offeredCardUid);
  if (fromCardIdx === -1) return s;
  const fromCard = from.hand[fromCardIdx];

  const targetCardIdx = target.hand.findIndex(c => c.uid === action.cardUid);
  if (targetCardIdx === -1) return s;
  const targetCard = target.hand[targetCardIdx];

  if (!validateTradeCard(target, from, targetCard)) return s;

  from.hand[fromCardIdx] = targetCard;
  target.hand[targetCardIdx] = fromCard;

  checkInfection(s, from, target, fromCard, targetCard);

  s.tradeSkipped = true;
  s.pendingAction = null;
  log(s,
    `${from.name} used Temptation to trade with ${target.name}.`,
    `${from.name} использовал(а) Соблазн для обмена с ${target.name}.`
  );

  s.step = 'end_turn';
  advanceTurn(s);
  return s;
}

export function handlePartyPassCard(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'PARTY_PASS_CARD') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'party_pass') return s;
  const pa = s.pendingAction;
  const { playerId, cardUid } = action;

  if (!pa.pendingPlayerIds.includes(playerId)) return s;

  const player = getPlayer(s, playerId);
  const cardIdx = player.hand.findIndex(c => c.uid === cardUid);
  if (cardIdx === -1) return s;
  const card = player.hand[cardIdx];
  if (card.defId === 'the_thing') return s;

  if (card.defId === 'infected') {
    if (player.role === 'human') return s;
    if (player.role === 'infected') {
      const infectedCount = player.hand.filter(c => c.defId === 'infected').length;
      if (infectedCount <= 1) return s;
      const alivePos = s.players.filter(p => p.isAlive).map(p => p.position).sort((a, b) => a - b);
      const posIdx = alivePos.indexOf(player.position);
      const nextPosIdx = (posIdx + pa.direction + alivePos.length) % alivePos.length;
      const nextPlayer = s.players.find(p => p.position === alivePos[nextPosIdx] && p.isAlive);
      if (!nextPlayer || nextPlayer.role !== 'thing') return s;
    }
  }

  pa.chosen.push({ playerId, cardUid });
  pa.pendingPlayerIds = pa.pendingPlayerIds.filter(id => id !== playerId);

  if (pa.pendingPlayerIds.length === 0) {
    const direction = pa.direction;
    const alivePos = s.players.filter(p => p.isAlive).map(p => p.position).sort((a, b) => a - b);
    const transfers = pa.chosen.flatMap(({ playerId: pid, cardUid: cuid }) => {
      const passer = getPlayer(s, pid);
      const posIdx = alivePos.indexOf(passer.position);
      const nextPosIdx = (posIdx + direction + alivePos.length) % alivePos.length;
      const recipient = s.players.find(p => p.position === alivePos[nextPosIdx] && p.isAlive);
      const card = passer.hand.find(c => c.uid === cuid);
      if (!recipient || !card) return [];
      return [{
        passerId: passer.id,
        recipientId: recipient.id,
        cardUid: cuid,
        card,
        senderRole: passer.role,
        recipientRole: recipient.role,
      }];
    });

    for (const transfer of transfers) {
      const passer = getPlayer(s, transfer.passerId);
      const idx = passer.hand.findIndex(c => c.uid === transfer.cardUid);
      if (idx !== -1) {
        passer.hand.splice(idx, 1);
      }
    }

    for (const transfer of transfers) {
      const recipient = getPlayer(s, transfer.recipientId);
      recipient.hand.push(transfer.card);
    }

    for (const transfer of transfers) {
      if (transfer.card.defId === 'infected' && transfer.senderRole === 'thing' && transfer.recipientRole === 'human') {
        getPlayer(s, transfer.recipientId).role = 'infected';
      }
    }

    for (const p of s.players.filter(pl => pl.isAlive)) {
      checkInfectionOverload(s, p);
    }
    s.pendingAction = null;
    log(s, 'Chain Reaction! Everyone passed a card.', 'Цепная реакция! Все передали карту.');
    s.step = 'end_turn';
    advanceTurn(s);
  }
  return s;
}

export function handleJustBetweenUsSelect(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'JUST_BETWEEN_US_SELECT') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'just_between_us') return s;
  const { player1, player2 } = action;
  if (player1 === player2) return s;
  if (!s.pendingAction.targets.includes(player1) || !s.pendingAction.targets.includes(player2)) return s;
  if (!areAdjacentPlayers(s, player1, player2)) return s;

  const first = getPlayer(s, player1);
  const second = getPlayer(s, player2);
  const firstTradeable = first.hand.filter(c => validateTradeCard(first, second, c));
  const secondTradeable = second.hand.filter(c => validateTradeCard(second, first, c));

  if (firstTradeable.length === 0 || secondTradeable.length === 0) {
    s.pendingAction = null;
    log(s,
      `Just Between Us could not be resolved — a player had no tradeable cards.`,
      `«Только между нами» не выполнено — у одного из игроков нет торгуемых карт.`
    );
    s.step = 'draw';
    return s;
  }

  s.pendingAction = {
    type: 'just_between_us_pick',
    playerA: player1,
    playerB: player2,
    cardUidA: null,
    cardUidB: null,
  };
  return s;
}

export function handleJustBetweenUsPick(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'JUST_BETWEEN_US_PICK') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'just_between_us_pick') return s;
  const pa = s.pendingAction;
  const { playerId, cardUid } = action;

  if (playerId !== pa.playerA && playerId !== pa.playerB) return s;

  const picker = getPlayer(s, playerId);
  const receiver = getPlayer(s, playerId === pa.playerA ? pa.playerB : pa.playerA);
  const selectedCard = picker.hand.find((card) => card.uid === cardUid);
  if (!selectedCard || !validateTradeCard(picker, receiver, selectedCard)) return s;

  if (playerId === pa.playerA && pa.cardUidA === null) {
    pa.cardUidA = cardUid;
  } else if (playerId === pa.playerB && pa.cardUidB === null) {
    pa.cardUidB = cardUid;
  } else {
    return s;
  }

  if (pa.cardUidA !== null && pa.cardUidB !== null) {
    const first = getPlayer(s, pa.playerA);
    const second = getPlayer(s, pa.playerB);
    const firstIdx = first.hand.findIndex(c => c.uid === pa.cardUidA);
    const secondIdx = second.hand.findIndex(c => c.uid === pa.cardUidB);
    if (firstIdx === -1 || secondIdx === -1) return s;

    const firstCard = first.hand[firstIdx];
    const secondCard = second.hand[secondIdx];
    first.hand[firstIdx] = secondCard;
    second.hand[secondIdx] = firstCard;

    checkInfection(s, first, second, firstCard, secondCard);

    s.pendingAction = null;
    s.step = 'draw';
    log(s,
      `${first.name} and ${second.name} traded due to Just Between Us.`,
      `${first.name} и ${second.name} обменялись из-за «Только между нами».`
    );
    s.log[0].fromPlayerId = first.id;
    s.log[0].targetPlayerId = second.id;
  }
  return s;
}

export function handlePanicSelectTarget(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'PANIC_SELECT_TARGET') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'panic_choose_target') return s;
  const { panicDefId, targets } = s.pendingAction;
  if (!targets.includes(action.targetPlayerId)) return s;
  s.pendingAction = null;
  resolvePanicTarget(s, panicDefId, action.targetPlayerId);
  return s;
}

export function handleBlindDatePick(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'BLIND_DATE_PICK') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'blind_date_swap') return s;
  const cur = currentPlayer(s);
  const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
  if (cardIdx === -1) return s;
  const card = cur.hand[cardIdx];
  if (card.defId === 'the_thing') return s;
  if (card.defId === 'infected' && cur.role === 'infected' &&
      cur.hand.filter(c => c.defId === 'infected').length <= 1) return s;

  const drawn = drawEventCard(s);
  if (drawn) {
    cur.hand[cardIdx] = drawn;
    s.deck.push(card); // card goes to top of deck — next player will draw it
  }

  s.pendingAction = null;
  log(s, `${cur.name} swapped a card with the deck (Blind Date).`,
      `${cur.name} обменял(а) карту с колодой (Свидание вслепую).`);
  s.log[0].fromPlayerId = cur.id;
  s.step = 'end_turn';
  advanceTurn(s);
  return s;
}

export function handleForgetfulDiscardPick(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'FORGETFUL_DISCARD_PICK') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'forgetful_discard') return s;
  const cur = currentPlayer(s);
  const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
  if (cardIdx === -1) return s;
  if (!canDiscardCard(s, cur, action.cardUid)) return s;

  const [discarded] = cur.hand.splice(cardIdx, 1);
  s.discard.push(discarded);

  const remaining = s.pendingAction.remaining - 1;
  if (remaining > 0 && cur.hand.filter(c => canDiscardCard(s, cur, c.uid)).length > 0) {
    s.pendingAction = { type: 'forgetful_discard', remaining };
  } else {
    for (let i = 0; i < 3; i++) {
      const drawn = drawEventCard(s);
      if (drawn) cur.hand.push(drawn);
    }
    s.pendingAction = null;
    log(s, `${cur.name} discarded and drew new cards (Forgetful).`,
        `${cur.name} сбросил(а) и взял(а) новые карты (Забывчивость).`);
    s.log[0].fromPlayerId = cur.id;
    s.step = 'draw';
  }
  return s;
}

export function handlePanicTradeSelect(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'PANIC_TRADE_SELECT') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'panic_trade') return s;
  const cur = currentPlayer(s);
  const target = getPlayer(s, s.pendingAction.targetPlayerId);

  const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
  if (cardIdx === -1) return s;
  const curCard = cur.hand[cardIdx];
  if (!validateTradeCard(cur, target, curCard)) return s;

  const targetHasDefense = target.hand.some((card) => ['fear', 'no_thanks', 'miss'].includes(card.defId));
  const targetHasTradeableCard = target.hand.some((card) => validateTradeCard(target, cur, card));

  if (!targetHasDefense && !targetHasTradeableCard) {
    s.pendingAction = null;
    log(s,
      `${target.name} has no valid response to Can't We Be Friends?. The panic effect is cancelled.`,
      `${target.name} не может ответить на «Давай дружить?». Эффект паники отменён.`
    );
    s.step = 'draw';
    return s;
  }

  s.pendingAction = {
    type: 'trade_defense',
    defenderId: target.id,
    fromId: cur.id,
    offeredCardUid: curCard.uid,
    reason: 'panic_trade',
  };
  return s;
}

export function handlePanicTradeRespond(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'PANIC_TRADE_RESPOND') return s;
  if (!s.pendingAction || (
    s.pendingAction.type !== 'panic_trade_response' &&
    !(s.pendingAction.type === 'trade_defense' && s.pendingAction.reason === 'panic_trade')
  )) return s;
  const { fromId, toId, offeredCardUid } = s.pendingAction.type === 'trade_defense'
    ? {
        fromId: s.pendingAction.fromId,
        toId: s.pendingAction.defenderId,
        offeredCardUid: s.pendingAction.offeredCardUid,
      }
    : s.pendingAction;
  const from = getPlayer(s, fromId);
  const target = getPlayer(s, toId);

  const fromCardIdx = from.hand.findIndex(c => c.uid === offeredCardUid);
  if (fromCardIdx === -1) return s;
  const fromCard = from.hand[fromCardIdx];

  const targetCardIdx = target.hand.findIndex(c => c.uid === action.cardUid);
  if (targetCardIdx === -1) return s;
  const targetCard = target.hand[targetCardIdx];

  if (!validateTradeCard(target, from, targetCard)) return s;

  from.hand[fromCardIdx] = targetCard;
  target.hand[targetCardIdx] = fromCard;

  checkInfection(s, from, target, fromCard, targetCard);

  s.pendingAction = null;
  log(s,
    `${from.name} and ${target.name} traded cards (Can't We Be Friends?).`,
    `${from.name} и ${target.name} обменялись картами (Давай дружить?).`
  );
  s.log[0].fromPlayerId = from.id;
  s.log[0].targetPlayerId = target.id;
  s.step = 'draw';
  return s;
}

export function handleAxeChooseEffect(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'AXE_CHOOSE_EFFECT') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'axe_choice') return s;
  if (s.pendingAction.targetPlayerId !== action.targetPlayerId) return s;

  const cur = currentPlayer(s);
  const target = getPlayer(s, action.targetPlayerId);

  if (action.choice === 'quarantine') {
    if (!s.pendingAction.canRemoveQuarantine || !target.inQuarantine) return s;
    target.inQuarantine = false;
    target.quarantineTurnsLeft = 0;
  } else {
    if (!s.pendingAction.canRemoveDoor || !hasDoorBetween(s, cur.position, target.position)) return s;
    s.doors = s.doors.filter(
      (door) => !(
        (door.between[0] === cur.position && door.between[1] === target.position) ||
        (door.between[0] === target.position && door.between[1] === cur.position)
      )
    );
  }

  s.pendingAction = null;
  if (s.step === 'play_or_discard') {
    s.step = 'trade';
    handleTradeStep(s);
  }
  return s;
}

export function handleRevelationsRespond(s: GameState, _originalState: GameState, action: GameAction): GameState {
  if (action.type !== 'REVELATIONS_RESPOND') return s;
  if (!s.pendingAction || s.pendingAction.type !== 'revelations_round') return s;
  const pa = s.pendingAction;
  const revealer = s.players[pa.revealOrder[pa.currentRevealerIdx]];
  const infectedCards = revealer.hand.filter(c => c.defId === 'infected');
  const hasInfected = infectedCards.length > 0;
  const nextIdx = pa.currentRevealerIdx + 1;
  const nextRevealerIdx = nextIdx >= pa.revealOrder.length ? null : nextIdx;

  if (action.show) {
    const revealMode = action.mode === 'infected_only' ? 'infected_only' : 'all';
    const revealOnlyInfected = revealMode === 'infected_only' && hasInfected;
    const revealedCards = revealOnlyInfected ? [infectedCards[0]] : [...revealer.hand];

    log(s,
      revealOnlyInfected
        ? `${revealer.name} revealed an Infected card during Revelations.`
        : `${revealer.name} showed their hand during Revelations.`,
      revealOnlyInfected
        ? `${revealer.name} показал(а) карту «Заражение!» во время Времени признаний.`
        : `${revealer.name} показал(а) свои карты во время Времени признаний.`
    );

    if (hasInfected) {
      log(s, 'An Infected card was revealed! Revelations end.',
          'Обнаружена карта «Заражение!»! Время признаний завершено.');
      s.pendingAction = {
        type: 'whisky_reveal',
        playerId: revealer.id,
        cards: revealedCards,
        viewerPlayerId: revealer.id,
        public: true,
        revealKind: revealOnlyInfected ? 'infected_only' : 'all',
        revelationsResume: {
          revealOrder: [...pa.revealOrder],
          nextRevealerIdx: null,
        },
      };
      return s;
    }

    s.pendingAction = {
      type: 'whisky_reveal',
      playerId: revealer.id,
      cards: revealedCards,
      viewerPlayerId: revealer.id,
      public: true,
      revealKind: revealOnlyInfected ? 'infected_only' : 'all',
      revelationsResume: {
        revealOrder: [...pa.revealOrder],
        nextRevealerIdx,
      },
    };
    return s;
  } else {
    log(s,
      `${revealer.name} chose not to show their hand.`,
      `${revealer.name} решил(а) не показывать карты.`
    );
    if (nextRevealerIdx === null) {
      s.pendingAction = null;
      log(s, 'Revelations complete.', 'Время признаний завершено.');
      s.step = 'draw';
    } else {
      s.pendingAction = { ...pa, currentRevealerIdx: nextRevealerIdx };
    }
    return s;
  }
}
