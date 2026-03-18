import type {
  GameState, GameAction, Player, CardInstance,
  Role,
} from './types.ts';
import { CARD_DEFS, getCardDef } from './cards.ts';

// ── Utility ─────────────────────────────────────────────────────────────────

let nextLogId = 1;
let nextCardUid = 1;

function uid(): string {
  return `card_${nextCardUid++}`;
}

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function log(state: GameState, text: string, textRu: string): void {
  state.log.unshift({ id: nextLogId++, text, textRu, timestamp: Date.now() });
  if (state.log.length > 100) state.log.length = 100;
}

// ── Neighbor / Seat Helpers ─────────────────────────────────────────────────

/** Get alive player positions in seat order */
function alivePositions(state: GameState): number[] {
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

function areAdjacentPlayers(state: GameState, player1Id: number, player2Id: number): boolean {
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

/** Get next player in turn direction */
function nextPlayerIndex(state: GameState): number {
  const alive = state.players.filter(p => p.isAlive);
  if (alive.length <= 1) return state.currentPlayerIndex;

  const cur = currentPlayer(state);
  const alivePos = alivePositions(state);
  const curIdx = alivePos.indexOf(cur.position);
  const nextIdx = (curIdx + state.direction + alivePos.length) % alivePos.length;
  const nextPos = alivePos[nextIdx];
  const next = state.players.find(p => p.position === nextPos && p.isAlive)!;
  return state.players.indexOf(next);
}

/** Get the trade partner (next player in turn direction) */
function getTradePartner(state: GameState): Player | null {
  const cur = currentPlayer(state);
  const alivePos = alivePositions(state);
  const curIdx = alivePos.indexOf(cur.position);
  const nextIdx = (curIdx + state.direction + alivePos.length) % alivePos.length;
  const nextPos = alivePos[nextIdx];
  return playerAtPosition(state, nextPos) || null;
}

// ── Deck Operations ─────────────────────────────────────────────────────────

/** Draw a card from deck, reshuffling discard if needed */
function drawFromDeck(state: GameState): CardInstance | null {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    state.deck = shuffle([...state.discard]);
    state.discard = [];
    log(state, 'Deck reshuffled from discard pile.', 'Колода перемешана из сброса.');
  }
  return state.deck.pop()!;
}

/** Draw an event card (skip panics, put them face-down in discard) */
function drawEventCard(state: GameState): CardInstance | null {
  let attempts = 0;
  while (attempts < 200) {
    const card = drawFromDeck(state);
    if (!card) return null;
    const def = getCardDef(card.defId);
    if (def.back === 'event') return card;
    // Panic card drawn during special draw — discard face-down
    state.discard.push(card);
    attempts++;
  }
  return null;
}

// ── Valid Targets ────────────────────────────────────────────────────────────

/** Get valid targets for a card play */
export function getValidTargets(state: GameState, cardDefId: string): number[] {
  const cur = currentPlayer(state);
  const adjacent = getAdjacentPositions(state, cur.position);

  switch (cardDefId) {
    case 'flamethrower':
    case 'analysis':
    case 'suspicion': {
      // Adjacent, alive, not quarantined, not behind locked door
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
      // Any alive player not in quarantine (doors ignored)
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

  // Cannot play infection cards
  if (def.category === 'infection') return false;

  // Cannot play defense cards during action phase
  if (def.category === 'defense' && state.step !== 'trade_response') return false;

  // Cannot play panic cards from hand (they auto-play when drawn)
  if (def.category === 'panic') return false;

  // Quarantined players cannot play events
  if (cur.inQuarantine) return false;

  // Self-targeted cards always playable
  if (['whisky', 'watch_your_back', 'persistence'].includes(cardDefId)) return true;

  // Cards requiring targets need at least one valid target
  const targets = getValidTargets(state, cardDefId);
  if (['flamethrower', 'analysis', 'suspicion', 'swap_places',
       'you_better_run', 'quarantine', 'locked_door', 'temptation',
       'lovecraft', 'necronomicon'].includes(cardDefId)) {
    return targets.length > 0;
  }

  return true;
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

// ── Build Deck ──────────────────────────────────────────────────────────────

function buildDeck(playerCount: number): { deck: CardInstance[]; thingCard: CardInstance } {
  const cards: CardInstance[] = [];
  let thingCard: CardInstance | null = null;

  const countIdx = Math.min(Math.max(playerCount - 4, 0), 7);

  for (const def of CARD_DEFS) {
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

// ── Initial State ───────────────────────────────────────────────────────────

export function createInitialState(): GameState {
  nextLogId = 1;
  nextCardUid = 1;
  return {
    phase: 'lobby',
    direction: 1,
    step: 'draw',
    currentPlayerIndex: 0,
    players: [],
    seats: [],
    doors: [],
    deck: [],
    discard: [],
    log: [],
    winner: null,
    winnerPlayerIds: [],
    pendingAction: null,
    revealingPlayer: 0,
    tradeSkipped: false,
    panicAnnouncement: null,
    lang: 'ru',
  };
}

// ── Reduce ──────────────────────────────────────────────────────────────────

export function gameReducer(state: GameState, action: GameAction): GameState {
  const s: GameState = {
    ...state,
    players: state.players.map(p => ({ ...p, hand: [...p.hand] })),
    deck: [...state.deck],
    discard: [...state.discard],
    doors: [...state.doors],
    log: [...state.log],
    seats: [...state.seats],
    winnerPlayerIds: [...state.winnerPlayerIds],
    panicAnnouncement: state.panicAnnouncement,
  };

  switch (action.type) {
    case 'SET_LANG': {
      s.lang = action.lang;
      return s;
    }

    case 'START_GAME': {
      const names = action.playerNames;
      const count = names.length;
      const { deck, thingCard } = buildDeck(count);

      const eventCards = deck.filter(c => getCardDef(c.defId).back === 'event' && c.defId !== 'infected');
      const infectedCards = deck.filter(c => c.defId === 'infected');
      const panicCards = deck.filter(c => getCardDef(c.defId).back === 'panic');

      const players: Player[] = names.map((name, i) => ({
        id: i,
        name,
        role: 'human' as Role,
        hand: [],
        isAlive: true,
        inQuarantine: false,
        quarantineTurnsLeft: 0,
        position: i,
      }));

      if (action.thingInDeck) {
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

    case 'REVEAL_NEXT': {
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

    case 'DRAW_CARD': {
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
        s.step = 'play_or_discard';
      } else {
        cur.hand.push(card);
        log(s,
          `${cur.name} drew a card.`,
          `${cur.name} взял(а) карту.`
        );

        if (cur.inQuarantine) {
          s.pendingAction = { type: 'choose_card_to_discard' };
          s.step = 'play_or_discard';
        } else {
          s.step = 'play_or_discard';
        }
      }
      return s;
    }

    case 'DISCARD_CARD': {
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

    case 'PLAY_CARD': {
      const cur = currentPlayer(s);
      const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
      if (cardIdx === -1) return s;

      const card = cur.hand[cardIdx];
      const def = getCardDef(card.defId);

      if (needsTarget(card.defId) && action.targetPlayerId === undefined) {
        const targets = getValidTargets(s, card.defId);
        if (targets.length === 0) return s;
        if (targets.length === 1) {
          return gameReducer(state, { ...action, targetPlayerId: targets[0] });
        }
        s.pendingAction = { type: 'choose_target', cardUid: card.uid, cardDefId: card.defId, targets };
        return s;
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

      if (s.step === 'play_or_discard' && !s.pendingAction) {
        s.step = 'trade';
        handleTradeStep(s);
      }

      return s;
    }

    case 'SELECT_TARGET': {
      if (!s.pendingAction || s.pendingAction.type !== 'choose_target') return s;
      const { cardUid } = s.pendingAction;
      s.pendingAction = null;
      return gameReducer(s, { type: 'PLAY_CARD', cardUid, targetPlayerId: action.targetPlayerId });
    }

    case 'OFFER_TRADE': {
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
      return s;
    }

    case 'RESPOND_TRADE': {
      if (!s.pendingAction || s.pendingAction.type !== 'trade_defense') return s;
      const { fromId, defenderId, offeredCardUid } = s.pendingAction;
      const from = getPlayer(s, fromId);
      const defender = getPlayer(s, defenderId);

      if (!canTradeCard(s, defender, action.cardUid)) return s;

      const fromCardIdx = from.hand.findIndex(c => c.uid === offeredCardUid);
      const defCardIdx = defender.hand.findIndex(c => c.uid === action.cardUid);
      if (fromCardIdx === -1 || defCardIdx === -1) return s;

      const fromCard = from.hand[fromCardIdx];
      const defCard = defender.hand[defCardIdx];
      from.hand[fromCardIdx] = defCard;
      defender.hand[defCardIdx] = fromCard;

      checkInfection(from, defender, fromCard, defCard);

      log(s,
        `${from.name} and ${defender.name} traded cards.`,
        `${from.name} и ${defender.name} обменялись картами.`
      );

      s.pendingAction = null;
      s.step = 'end_turn';
      advanceTurn(s);
      return s;
    }

    case 'PLAY_DEFENSE': {
      if (!s.pendingAction || s.pendingAction.type !== 'trade_defense') return s;
      const { fromId, defenderId, offeredCardUid, reason } = s.pendingAction;
      const defender = getPlayer(s, defenderId);

      const cardIdx = defender.hand.findIndex(c => c.uid === action.cardUid);
      if (cardIdx === -1) return s;
      const card = defender.hand[cardIdx];
      const def = getCardDef(card.defId);

      if (def.category !== 'defense') return s;

      const allowedDefenseIds =
        reason === 'trade'
          ? ['fear', 'no_thanks', 'miss']
          : reason === 'flamethrower'
            ? ['no_barbecue']
            : ['im_fine_here'];

      if (!allowedDefenseIds.includes(card.defId)) return s;

      defender.hand.splice(cardIdx, 1);
      s.discard.push(card);

      const replacement = drawEventCard(s);
      if (replacement) defender.hand.push(replacement);

      switch (card.defId) {
        case 'no_thanks': {
          log(s, `${defender.name} played No Thanks! Trade refused.`,
              `${defender.name} сыграл(а) «Нет уж, спасибо!» Обмен отклонён.`);
          s.pendingAction = null;
          s.step = 'end_turn';
          advanceTurn(s);
          break;
        }
        case 'fear': {
          const from = getPlayer(s, fromId);
          const offeredCard = from.hand.find(c => c.uid === offeredCardUid);
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
          break;
        }
        case 'miss': {
          log(s, `${defender.name} played Miss! Next player must trade instead.`,
              `${defender.name} сыграл(а) «Мимо!» Следующий игрок обменивается.`);
          const alivePos = alivePositions(s);
          const defPosIdx = alivePos.indexOf(defender.position);
          const nextIdx = (defPosIdx + s.direction + alivePos.length) % alivePos.length;
          const nextPos = alivePos[nextIdx];
          const nextP = playerAtPosition(s, nextPos);
          if (nextP && nextP.id !== fromId && !nextP.inQuarantine &&
              !hasDoorBetween(s, getPlayer(s, fromId).position, nextP.position)) {
            s.pendingAction = {
              type: 'trade_defense',
              defenderId: nextP.id,
              fromId,
              offeredCardUid,
              reason,
            };
          } else {
            s.pendingAction = null;
            s.step = 'end_turn';
            advanceTurn(s);
          }
          break;
        }
        case 'no_barbecue': {
          log(s, `${defender.name} played No Barbecue! Flamethrower cancelled.`,
              `${defender.name} сыграл(а) «Никакого шашлыка!» Огнемёт отменён.`);
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

    case 'DECLINE_DEFENSE': {
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

    case 'END_TURN': {
      advanceTurn(s);
      return s;
    }

    case 'CONFIRM_VIEW': {
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
      // If step is 'draw', do nothing — player will draw again
      return s;
    }

    case 'PERSISTENCE_PICK': {
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

    case 'DECLARE_VICTORY': {
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

    case 'TEMPTATION_SELECT': {
      if (!s.pendingAction || s.pendingAction.type !== 'choose_card_to_give') return s;
      const cur = currentPlayer(s);
      const target = getPlayer(s, s.pendingAction.targetPlayerId);

      const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
      if (cardIdx === -1) return s;

      const curCard = cur.hand[cardIdx];
      if (!validateTradeCard(cur, target, curCard)) return s;

      s.pendingAction = {
        type: 'temptation_response',
        fromId: cur.id,
        toId: target.id,
        offeredCardUid: curCard.uid,
      };
      return s;
    }

    case 'TEMPTATION_RESPOND': {
      if (!s.pendingAction || s.pendingAction.type !== 'temptation_response') return s;
      const { fromId, toId, offeredCardUid } = s.pendingAction;
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

      checkInfection(from, target, fromCard, targetCard);

      s.tradeSkipped = true;
      s.pendingAction = null;
      log(s,
        `${from.name} used Temptation to trade with ${target.name}.`,
        `${from.name} использовал(а) Соблазн для обмена с ${target.name}.`
      );

      if (s.step === 'play_or_discard') {
        s.step = 'end_turn';
        advanceTurn(s);
      }
      return s;
    }

    case 'PARTY_PASS_CARD': {
      if (!s.pendingAction || s.pendingAction.type !== 'party_pass') return s;
      const pa = s.pendingAction;
      const { playerId, cardUid } = action;

      if (!pa.pendingPlayerIds.includes(playerId)) return s;

      const player = getPlayer(s, playerId);
      const cardIdx = player.hand.findIndex(c => c.uid === cardUid);
      if (cardIdx === -1) return s;
      const card = player.hand[cardIdx];
      if (card.defId === 'the_thing') return s;
      if (card.defId === 'infected' && player.role === 'infected' &&
          player.hand.filter(c => c.defId === 'infected').length <= 1) return s;

      pa.chosen.push({ playerId, cardUid });
      pa.pendingPlayerIds = pa.pendingPlayerIds.filter(id => id !== playerId);

      if (pa.pendingPlayerIds.length === 0) {
        const direction = pa.direction;
        const alivePos = s.players.filter(p => p.isAlive).map(p => p.position).sort((a, b) => a - b);
        for (const { playerId: pid, cardUid: cuid } of pa.chosen) {
          const passer = getPlayer(s, pid);
          const posIdx = alivePos.indexOf(passer.position);
          const nextPosIdx = (posIdx + direction + alivePos.length) % alivePos.length;
          const nextPlayer = s.players.find(p => p.position === alivePos[nextPosIdx] && p.isAlive);
          if (!nextPlayer) continue;
          const idx = passer.hand.findIndex(c => c.uid === cuid);
          if (idx === -1) continue;
          const passedCard = passer.hand[idx];
          passer.hand.splice(idx, 1);
          nextPlayer.hand.push(passedCard);
          if (passedCard.defId === 'infected' && passer.role === 'thing' && nextPlayer.role === 'human') {
            nextPlayer.role = 'infected';
          }
        }
        s.pendingAction = null;
        log(s, 'Chain Reaction! Everyone passed a card.', 'Цепная реакция! Все передали карту.');
        // Chain reaction ends turn
        s.step = 'end_turn';
        advanceTurn(s);
      }
      return s;
    }

    case 'JUST_BETWEEN_US_SELECT': {
      if (!s.pendingAction || s.pendingAction.type !== 'just_between_us') return s;
      const { player1, player2 } = action;
      if (player1 === player2) return s;
      if (!s.pendingAction.targets.includes(player1) || !s.pendingAction.targets.includes(player2)) return s;
      if (!areAdjacentPlayers(s, player1, player2)) return s;

      const first = getPlayer(s, player1);
      const second = getPlayer(s, player2);
      const firstTradeable = first.hand.filter(c => canTradeCard(s, first, c.uid));
      const secondTradeable = second.hand.filter(c => canTradeCard(s, second, c.uid));

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

    case 'JUST_BETWEEN_US_PICK': {
      if (!s.pendingAction || s.pendingAction.type !== 'just_between_us_pick') return s;
      const pa = s.pendingAction;
      const { playerId, cardUid } = action;

      if (playerId !== pa.playerA && playerId !== pa.playerB) return s;

      const picker = getPlayer(s, playerId);
      if (!canTradeCard(s, picker, cardUid)) return s;
      const cardExists = picker.hand.some(c => c.uid === cardUid);
      if (!cardExists) return s;

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

        checkInfection(first, second, firstCard, secondCard);

        s.pendingAction = null;
        s.step = 'draw';
        log(s,
          `${first.name} and ${second.name} traded due to Just Between Us.`,
          `${first.name} и ${second.name} обменялись из-за «Только между нами».`
        );
      }
      return s;
    }

    // ── New panic action handlers ──────────────────────────────────────

    case 'PANIC_SELECT_TARGET': {
      if (!s.pendingAction || s.pendingAction.type !== 'panic_choose_target') return s;
      const { panicDefId, targets } = s.pendingAction;
      if (!targets.includes(action.targetPlayerId)) return s;
      s.pendingAction = null;
      resolvePanicTarget(s, panicDefId, action.targetPlayerId);
      return s;
    }

    case 'BLIND_DATE_PICK': {
      if (!s.pendingAction || s.pendingAction.type !== 'blind_date_swap') return s;
      const cur = currentPlayer(s);
      const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
      if (cardIdx === -1) return s;
      const card = cur.hand[cardIdx];
      if (card.defId === 'the_thing') return s;
      if (card.defId === 'infected' && cur.role === 'infected' &&
          cur.hand.filter(c => c.defId === 'infected').length <= 1) return s;

      // Draw top event card from deck (skip panics)
      const drawn = drawEventCard(s);
      if (drawn) {
        cur.hand[cardIdx] = drawn;
        s.discard.push(card);
      }

      s.pendingAction = null;
      log(s, `${cur.name} swapped a card with the deck (Blind Date).`,
          `${cur.name} обменял(а) карту с колодой (Свидание вслепую).`);
      // Blind date ends turn
      s.step = 'end_turn';
      advanceTurn(s);
      return s;
    }

    case 'FORGETFUL_DISCARD_PICK': {
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
        // Draw 3 event cards
        for (let i = 0; i < 3; i++) {
          const drawn = drawEventCard(s);
          if (drawn) cur.hand.push(drawn);
        }
        s.pendingAction = null;
        log(s, `${cur.name} discarded and drew new cards (Forgetful).`,
            `${cur.name} сбросил(а) и взял(а) новые карты (Забывчивость).`);
        s.step = 'draw';
      }
      return s;
    }

    case 'PANIC_TRADE_SELECT': {
      if (!s.pendingAction || s.pendingAction.type !== 'panic_trade') return s;
      const cur = currentPlayer(s);
      const target = getPlayer(s, s.pendingAction.targetPlayerId);

      const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
      if (cardIdx === -1) return s;
      const curCard = cur.hand[cardIdx];
      if (!validateTradeCard(cur, target, curCard)) return s;

      s.pendingAction = {
        type: 'panic_trade_response',
        fromId: cur.id,
        toId: target.id,
        offeredCardUid: curCard.uid,
      };
      return s;
    }

    case 'PANIC_TRADE_RESPOND': {
      if (!s.pendingAction || s.pendingAction.type !== 'panic_trade_response') return s;
      const { fromId, toId, offeredCardUid } = s.pendingAction;
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

      checkInfection(from, target, fromCard, targetCard);

      s.pendingAction = null;
      log(s,
        `${from.name} and ${target.name} traded cards (Can't We Be Friends?).`,
        `${from.name} и ${target.name} обменялись картами (Давай дружить?).`
      );
      s.step = 'draw';
      return s;
    }

    case 'REVELATIONS_RESPOND': {
      if (!s.pendingAction || s.pendingAction.type !== 'revelations_round') return s;
      const pa = s.pendingAction;
      const revealer = s.players[pa.revealOrder[pa.currentRevealerIdx]];

      if (action.show) {
        // Show this player's hand to all
        const hasInfected = revealer.hand.some(c => c.defId === 'infected');
        log(s,
          `${revealer.name} showed their hand during Revelations.`,
          `${revealer.name} показал(а) свои карты во время Времени признаний.`
        );
        if (hasInfected) {
          log(s, 'An Infected card was revealed! Revelations end.',
              'Обнаружена карта «Заражение!»! Время признаний завершено.');
          // Show this player's hand
          s.pendingAction = {
            type: 'whisky_reveal',
            playerId: revealer.id,
            cards: [...revealer.hand],
            viewerPlayerId: revealer.id,
            public: true,
          };
          return s;
        }
        // Show hand then continue
        s.pendingAction = {
          type: 'whisky_reveal',
          playerId: revealer.id,
          cards: [...revealer.hand],
          viewerPlayerId: revealer.id,
          public: true,
        };
        // After confirm, we need to continue revelations — store next index
        // We'll handle this in CONFIRM_VIEW by checking if revelations should continue
        return s;
      } else {
        // Player passes
        log(s,
          `${revealer.name} chose not to show their hand.`,
          `${revealer.name} решил(а) не показывать карты.`
        );
        const nextIdx = pa.currentRevealerIdx + 1;
        if (nextIdx >= pa.revealOrder.length) {
          s.pendingAction = null;
          log(s, 'Revelations complete.', 'Время признаний завершено.');
          s.step = 'draw';
        } else {
          s.pendingAction = { ...pa, currentRevealerIdx: nextIdx };
        }
        return s;
      }
    }

    default:
      return s;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function needsTarget(defId: string): boolean {
  return ['flamethrower', 'analysis', 'axe', 'suspicion', 'swap_places',
          'you_better_run', 'quarantine', 'locked_door', 'temptation',
          'lovecraft', 'necronomicon'].includes(defId);
}

/** Validate if a player can give a specific card in a trade/temptation context */
function validateTradeCard(giver: Player, _receiver: Player, card: CardInstance): boolean {
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

/** Check and apply infection after a card swap */
function checkInfection(p1: Player, p2: Player, cardFromP1: CardInstance, cardFromP2: CardInstance): void {
  if (cardFromP1.defId === 'infected' && p1.role === 'thing' && p2.role === 'human') {
    p2.role = 'infected';
  }
  if (cardFromP2.defId === 'infected' && p2.role === 'thing' && p1.role === 'human') {
    p1.role = 'infected';
  }
}

function handleTradeStep(s: GameState): void {
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

function advanceTurn(s: GameState): void {
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

function applyCardEffect(s: GameState, player: Player, card: CardInstance, targetId?: number): void {
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
      const randIdx = Math.floor(Math.random() * target.hand.length);
      s.pendingAction = {
        type: 'view_card',
        targetPlayerId: target.id,
        card: target.hand[randIdx],
        viewerPlayerId: player.id,
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
      // Look at any chosen player's hand (like Analysis but any player)
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
      // Eliminate any chosen player (no defense possible)
      if (!target) break;
      eliminatePlayer(s, target);
      break;
    }
  }
}

function eliminatePlayer(s: GameState, player: Player): void {
  player.isAlive = false;
  s.discard.push(...player.hand);
  player.hand = [];

  log(s,
    `${player.name} has been eliminated!`,
    `${player.name} уничтожен(а)!`
  );

  if (player.role === 'thing') {
    const humans = s.players.filter(p => p.isAlive && p.role === 'human');
    s.winner = 'humans';
    s.winnerPlayerIds = humans.map(p => p.id);
    s.phase = 'game_over';
    log(s, 'The Thing has been destroyed! Humans win!',
        'Нечто уничтожено! Люди побеждают!');
  }
}

function swapPositions(s: GameState, p1: Player, p2: Player): void {
  const temp = p1.position;
  p1.position = p2.position;
  p2.position = temp;
  s.seats[p1.position] = p1.id;
  s.seats[p2.position] = p2.id;
}

// ── Panic Effects ───────────────────────────────────────────────────────────

function applyPanicEffect(s: GameState, card: CardInstance): void {
  const cur = currentPlayer(s);

  switch (card.defId) {
    // ── ...Три, четыре... — remove all locked doors ──
    case 'panic_1234': {
      s.doors = [];
      log(s, 'All locked doors removed! (...Three, Four...)',
          'Все заколоченные двери убраны! (...Три, четыре...)');
      break;
    }

    // ── Раз, два... — swap with 3rd player left or right ──
    case 'panic_one_two': {
      const alive = s.players.filter(p => p.isAlive);
      const alivePos = alive.map(p => p.position).sort((a, b) => a - b);
      const curIdx = alivePos.indexOf(cur.position);
      if (curIdx === -1 || alivePos.length < 4) {
        log(s, 'One, Two... — not enough players for swap.', 'Раз, два... — недостаточно игроков.');
        break;
      }
      // 3rd player to the left
      const leftIdx = (curIdx - 3 + alivePos.length) % alivePos.length;
      const leftPlayer = alive.find(p => p.position === alivePos[leftIdx]);
      // 3rd player to the right
      const rightIdx = (curIdx + 3) % alivePos.length;
      const rightPlayer = alive.find(p => p.position === alivePos[rightIdx]);

      const targets: number[] = [];
      if (leftPlayer && !leftPlayer.inQuarantine && leftPlayer.id !== cur.id) targets.push(leftPlayer.id);
      if (rightPlayer && !rightPlayer.inQuarantine && rightPlayer.id !== cur.id && rightPlayer.id !== leftPlayer?.id) targets.push(rightPlayer.id);

      if (targets.length === 0) {
        log(s, 'One, Two... — no valid targets (quarantine).', 'Раз, два... — нет доступных целей (карантин).');
      } else if (targets.length === 1) {
        // Auto-swap
        swapPositions(s, cur, getPlayer(s, targets[0]));
        log(s, `One, Two... ${cur.name} swapped seats!`, `Раз, два... ${cur.name} поменялся(-ась) местами!`);
      } else {
        s.pendingAction = { type: 'panic_choose_target', panicDefId: 'panic_one_two', targets };
      }
      break;
    }

    // ── И это вы называете вечеринкой? — remove obstacles + pair swap ──
    case 'panic_party': {
      // Remove all quarantine and doors
      s.players.forEach(p => { p.inQuarantine = false; p.quarantineTurnsLeft = 0; });
      s.doors = [];
      log(s, 'Party! All quarantine and locked doors removed!',
          'Вечеринка! Все карантины и двери убраны!');

      // Pair swap starting from current player clockwise
      const alive = s.players.filter(p => p.isAlive);
      const sorted = alive.slice().sort((a, b) => {
        // Order starting from current player position clockwise
        const aOff = (a.position - cur.position + s.players.length) % s.players.length;
        const bOff = (b.position - cur.position + s.players.length) % s.players.length;
        return aOff - bOff;
      });
      // Swap in pairs: 0↔1, 2↔3, etc.
      for (let i = 0; i + 1 < sorted.length; i += 2) {
        swapPositions(s, sorted[i], sorted[i + 1]);
      }
      if (sorted.length >= 2) {
        log(s, 'Players swapped seats in pairs!', 'Игроки попарно поменялись местами!');
      }
      break;
    }

    // ── Цепная реакция — all pass card in turn direction ──
    case 'panic_chain_reaction': {
      const alive = s.players.filter(p => p.isAlive && p.hand.length > 0);
      if (alive.length < 2) break;
      // Pass in turn direction (ignoring quarantine/doors per card description)
      s.pendingAction = {
        type: 'party_pass',
        pendingPlayerIds: alive.map(p => p.id),
        chosen: [],
        direction: s.direction,
      };
      break;
    }

    // ── Только между нами... — show cards to adjacent player ──
    case 'panic_between_us': {
      const adjacent = getAdjacentPositions(s, cur.position);
      const targets = adjacent
        .map(pos => playerAtPosition(s, pos))
        .filter((p): p is Player => !!p && p.isAlive)
        .map(p => p.id);
      if (targets.length === 0) {
        log(s, 'Just Between Us — no adjacent players.', 'Только между нами — нет соседних игроков.');
      } else if (targets.length === 1) {
        // Auto-select
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

    // ── Упс! — show all cards to everyone ──
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

    // ── Свидание вслепую — swap card with deck top ──
    case 'panic_blind_date': {
      if (cur.hand.length === 0) break;
      s.pendingAction = { type: 'blind_date_swap' };
      break;
    }

    // ── Забывчивость — discard 3, draw 3 ──
    case 'panic_forgetful': {
      const discardable = cur.hand.filter(c => canDiscardCard(s, cur, c.uid));
      const toDiscard = Math.min(3, discardable.length);
      if (toDiscard === 0) {
        // Nothing to discard, just draw 3
        for (let i = 0; i < 3; i++) {
          const drawn = drawEventCard(s);
          if (drawn) cur.hand.push(drawn);
        }
        log(s, `${cur.name} drew new cards (Forgetful).`, `${cur.name} взял(а) новые карты (Забывчивость).`);
      } else {
        s.pendingAction = { type: 'forgetful_discard', remaining: toDiscard };
      }
      break;
    }

    // ── Время признаний — sequential voluntary reveal ──
    case 'panic_revelations': {
      const alive = s.players.filter(p => p.isAlive);
      if (alive.length < 2) break;
      // Build reveal order starting from current player in turn direction
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

    // ── Убирайся прочь! (panic) — swap seats with any non-quarantined ──
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

    // ── Давай дружить? (panic) — swap card with any non-quarantined ──
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

    // ── Старые верёвки (panic) — remove all quarantine ──
    case 'rotten_ropes': {
      s.players.forEach(p => { p.inQuarantine = false; p.quarantineTurnsLeft = 0; });
      log(s, 'Rotten Ropes! All quarantines removed!', 'Старые верёвки! Все карантины сняты!');
      break;
    }
  }
}

/** Resolve a panic card effect after target was selected */
function resolvePanicTarget(s: GameState, panicDefId: string, targetPlayerId: number): void {
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
