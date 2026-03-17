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
  const def = getCardDef(cardDefId);
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
      // Can target self (remove own quarantine) or adjacent (remove quarantine/door)
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
      // Adjacent, not quarantine, not behind locked door
      return adjacent
        .filter(pos => {
          const p = playerAtPosition(state, pos);
          return p && !p.inQuarantine && !hasDoorBetween(state, cur.position, pos);
        })
        .map(pos => playerAtPosition(state, pos)!.id);
    }
    case 'get_out_of_here': {
      // Any alive player not in quarantine (doors ignored)
      return state.players
        .filter(p => p.isAlive && p.id !== cur.id && !p.inQuarantine)
        .map(p => p.id);
    }
    case 'quarantine': {
      // Self or adjacent
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
      // Adjacent positions only, target cannot be in quarantine
      return adjacent
        .filter(pos => !hasDoorBetween(state, cur.position, pos))
        .map(pos => playerAtPosition(state, pos)!)
        .filter(p => p && !p.inQuarantine)
        .map(p => p.id);
    }
    case 'temptation': {
      // Any alive, not in quarantine
      return state.players
        .filter(p => p.isAlive && p.id !== cur.id && !p.inQuarantine)
        .map(p => p.id);
    }
    case 'whisky':
    case 'watch_your_back':
    case 'persistence': {
      // Self-targeted, no target selection needed
      return [];
    }
    default:
      if (def.category === 'defense') return [];
      return [];
  }
}

/** Can the current player play this card? */
export function canPlayCard(state: GameState, cardDefId: string): boolean {
  const cur = currentPlayer(state);
  const def = getCardDef(cardDefId);

  // Cannot play infection cards
  if (def.category === 'infection') return false;

  // Cannot play defense cards during action phase (only during trade)
  if (def.category === 'defense' && state.step !== 'trade_response') return false;

  // Quarantined players cannot play events
  if (cur.inQuarantine && def.category !== 'panic') return false;

  // Self-targeted cards always playable
  if (['whisky', 'watch_your_back', 'persistence'].includes(cardDefId)) return true;

  // Cards requiring targets need at least one valid target
  const targets = getValidTargets(state, cardDefId);
  if (['flamethrower', 'analysis', 'suspicion', 'swap_places', 'get_out_of_here',
       'quarantine', 'locked_door', 'temptation'].includes(cardDefId)) {
    return targets.length > 0;
  }

  return true;
}

// ── Card validation for discard ─────────────────────────────────────────────

export function canDiscardCard(_state: GameState, player: Player, cardUid: string): boolean {
  const card = player.hand.find(c => c.uid === cardUid);
  if (!card) return false;

  // The Thing card can NEVER be discarded
  if (card.defId === 'the_thing') return false;

  // Infected players must keep at least 1 Infected! card
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

  // The Thing card can NEVER be traded
  if (card.defId === 'the_thing') return false;

  // Only The Thing can offer Infected! cards
  if (card.defId === 'infected' && player.role !== 'thing') {
    // Infected can give back to The Thing only
    if (player.role === 'infected') {
      // Check if trading with The Thing
      const partner = getTradePartner(state);
      if (partner && partner.role === 'thing') return true;
    }
    return false;
  }

  // Infected must keep at least 1 Infected! card
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

  for (const def of CARD_DEFS) {
    if (def.minPlayers > playerCount) continue;

    for (let i = 0; i < def.copies; i++) {
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
  // Clone state (shallow is fine for most fields, deep clone players/deck/etc.)
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

      // Separate event and panic cards for initial deal
      const eventCards = deck.filter(c => getCardDef(c.defId).back === 'event' && c.defId !== 'infected');
      const infectedCards = deck.filter(c => c.defId === 'infected');
      const panicCards = deck.filter(c => getCardDef(c.defId).back === 'panic');

      // Create players
      const thingPlayerIdx = Math.floor(Math.random() * count);
      const players: Player[] = names.map((name, i) => ({
        id: i,
        name,
        role: (i === thingPlayerIdx ? 'thing' : 'human') as Role,
        hand: [],
        isAlive: true,
        inQuarantine: false,
        quarantineTurnsLeft: 0,
        position: i,
      }));

      // Deal starting hands: 4 cards each
      // The Thing gets "The Thing" card + 3 random event cards
      // Others get 4 random event cards each
      // Total starting cards = 4 * count (including The Thing card)
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

      // Remaining event cards + all infected + all panic = main deck
      const mainDeck = [...eventCards, ...infectedCards, ...panicCards];
      shuffle(mainDeck);

      s.players = players;
      s.deck = mainDeck;
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
      if (s.pendingAction) return s; // Don't draw while a pending action is active
      s.panicAnnouncement = null; // Clear previous panic announcement
      const cur = currentPlayer(s);
      const card = drawFromDeck(s);
      if (!card) return s;

      const def = getCardDef(card.defId);

      if (def.back === 'panic') {
        // Panic card: play immediately, show announcement to all players
        log(s,
          `${cur.name} drew panic card: ${def.name}`,
          `${cur.name} вытянул(а) панику: ${def.nameRu}`
        );
        s.panicAnnouncement = card.defId;
        applyPanicEffect(s, card);
        s.discard.push(card);
        // After panic, draw again (unless a pending action like just_between_us needs resolution first)
        if (!s.pendingAction) {
          s.step = 'draw'; // Player draws again after panic
        }
        // If pendingAction was set by panic (e.g. just_between_us), step stays 'draw'
        // and we wait for the pending action to resolve before allowing the next draw
      } else {
        // Event card: add to hand
        cur.hand.push(card);
        log(s,
          `${cur.name} drew a card.`,
          `${cur.name} взял(а) карту.`
        );

        // If quarantined: must discard 1 card (can't play)
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

      // If card needs a target and none provided, show target selection
      if (needsTarget(card.defId) && action.targetPlayerId === undefined) {
        const targets = getValidTargets(s, card.defId);
        if (targets.length === 0) return s;
        if (targets.length === 1) {
          // Auto-select single target
          return gameReducer(state, { ...action, targetPlayerId: targets[0] });
        }
        s.pendingAction = { type: 'choose_target', cardUid: card.uid, cardDefId: card.defId, targets };
        return s;
      }

      // Remove card from hand
      cur.hand.splice(cardIdx, 1);

      // Apply effect
      applyCardEffect(s, cur, card, action.targetPlayerId);

      // Discard played card (unless it's an obstacle that stays on table)
      if (def.category !== 'obstacle') {
        s.discard.push(card);
      }

      log(s,
        `${cur.name} played ${def.name}${action.targetPlayerId !== undefined ? ` on ${getPlayer(s, action.targetPlayerId).name}` : ''}.`,
        `${cur.name} сыграл(а) ${def.nameRu}${action.targetPlayerId !== undefined ? ` на ${getPlayer(s, action.targetPlayerId).name}` : ''}.`
      );

      // Check if we need to stay in play_or_discard (Persistence allows extra plays)
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

      // Check for obstacles
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

      // Check responder can trade this card
      if (!canTradeCard(s, defender, action.cardUid)) return s;

      // Execute the swap
      const fromCardIdx = from.hand.findIndex(c => c.uid === offeredCardUid);
      const defCardIdx = defender.hand.findIndex(c => c.uid === action.cardUid);
      if (fromCardIdx === -1 || defCardIdx === -1) return s;

      const fromCard = from.hand[fromCardIdx];
      const defCard = defender.hand[defCardIdx];
      from.hand[fromCardIdx] = defCard;
      defender.hand[defCardIdx] = fromCard;

      // Check infection
      if (fromCard.defId === 'infected' && from.role === 'thing' && defender.role === 'human') {
        defender.role = 'infected';
        log(s,
          `${defender.name} has been infected!`,
          `${defender.name} заражён(а)!`
        );
      }
      if (defCard.defId === 'infected' && defender.role === 'thing' && from.role === 'human') {
        from.role = 'infected';
        log(s,
          `${from.name} has been infected!`,
          `${from.name} заражён(а)!`
        );
      }

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

      // Remove defense card and discard
      defender.hand.splice(cardIdx, 1);
      s.discard.push(card);

      // Draw replacement event card for defender
      const replacement = drawEventCard(s);
      if (replacement) defender.hand.push(replacement);

      switch (card.defId) {
        case 'no_thanks': {
          log(s, `${defender.name} played No Thanks! Trade refused.`,
              `${defender.name} сыграл(а) «Нет, спасибо!» Обмен отклонён.`);
          s.pendingAction = null;
          s.step = 'end_turn';
          advanceTurn(s);
          break;
        }
        case 'fear': {
          // Defender sees the offered card
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
          // Find next player after defender in turn direction
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
              `${defender.name} сыграл(а) «Мне и тут хорошо!» Обмен местами отменён.`);
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
      // Defender chooses NOT to play their defense card (e.g. No Barbecue, I'm Fine Here)
      if (!s.pendingAction || s.pendingAction.type !== 'trade_defense') return s;
      const { fromId, defenderId, reason } = s.pendingAction;
      const defFrom = getPlayer(s, fromId);
      const defTarget = getPlayer(s, defenderId);

      s.pendingAction = null;

      if (reason === 'flamethrower') {
        // Defender accepts elimination
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
        // Defender accepts the seat swap
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
        // After viewing during trade (e.g. Fear defense), advance turn
        s.step = 'end_turn';
        advanceTurn(s);
      } else if (s.step === 'play_or_discard') {
        // After viewing during play phase (e.g. Analysis, Whisky), move to trade
        s.step = 'trade';
        handleTradeStep(s);
      } else if (s.step === 'end_turn') {
        // Fallback: if somehow stuck at end_turn with a view, advance
        advanceTurn(s);
      }
      // If step is 'draw', do nothing — player will draw again
      return s;
    }

    case 'PERSISTENCE_PICK': {
      const cur = currentPlayer(s);
      // This is handled via pending action with drawn cards
      if (s.pendingAction?.type === 'persistence_pick') {
        const { drawnCards } = s.pendingAction;
        const keep = drawnCards.find(c => c.uid === action.keepUid);
        if (keep) {
          cur.hand.push(keep);
          drawnCards.filter(c => c.uid !== action.keepUid).forEach(c => s.discard.push(c));
        }
        s.pendingAction = null;
        // Explicitly keep step at play_or_discard so the player can play or discard another card
        // (Persistence allows: keep 1 card, then play or discard 1 card from hand)
        s.step = 'play_or_discard';
      }
      return s;
    }

    case 'DECLARE_VICTORY': {
      const cur = currentPlayer(s);
      if (cur.role !== 'thing') return s;

      const humans = s.players.filter(p => p.isAlive && p.role === 'human');
      if (humans.length === 0) {
        // Correct declaration
        const infected = s.players.filter(p => p.isAlive && p.role === 'infected');
        const eliminated = s.players.filter(p => !p.isAlive);
        if (infected.length === 0 && eliminated.length === 0) {
          // Impossible scenario, but handle: only The Thing
          s.winner = 'thing_solo';
          s.winnerPlayerIds = [cur.id];
        } else if (eliminated.length === 0) {
          // All infected, nobody eliminated → only The Thing wins
          s.winner = 'thing_solo';
          s.winnerPlayerIds = [cur.id];
        } else {
          // The Thing + surviving infected win
          s.winner = 'thing';
          s.winnerPlayerIds = [cur.id, ...infected.map(p => p.id)];
        }
        log(s, 'The Thing declares victory — no humans remain!',
            'Нечто объявляет победу — людей больше нет!');
      } else {
        // Wrong declaration — humans win!
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

      // Find the card to trade from current player
      const cardIdx = cur.hand.findIndex(c => c.uid === action.cardUid);
      if (cardIdx === -1) return s;

      const curCard = cur.hand[cardIdx];

      // ── Infection validation for Temptation ──
      // The Thing card can never be traded
      if (curCard.defId === 'the_thing') return s;

      // Only The Thing can pass Infected cards to non-Thing players
      if (curCard.defId === 'infected') {
        if (cur.role === 'thing') {
          // Thing can infect anyone via Temptation
        } else if (cur.role === 'infected') {
          // Infected can only give Infected back to The Thing
          if (target.role !== 'thing') return s;
          // Must keep at least 1 Infected card
          if (cur.hand.filter(c => c.defId === 'infected').length <= 1) return s;
        } else {
          // Humans cannot pass Infected cards to anyone
          return s;
        }
      }

      // Pick a random tradeable card from target (skip The Thing card and protected Infected cards)
      if (target.hand.length === 0) return s;
      const targetTradeableCards = target.hand.filter(c => {
        if (c.defId === 'the_thing') return false;
        if (c.defId === 'infected') {
          // Only Thing can give Infected to non-Thing targets
          if (target.role !== 'thing' || cur.role === 'thing') {
            // Infected players must keep at least 1 Infected
            if (target.role === 'infected' && target.hand.filter(h => h.defId === 'infected').length <= 1) return false;
            // Humans/Infected can't pass Infected to non-Thing
            if (target.role !== 'thing' && cur.role !== 'thing') return false;
          }
        }
        return true;
      });
      if (targetTradeableCards.length === 0) return s;
      const targetCard = targetTradeableCards[Math.floor(Math.random() * targetTradeableCards.length)];
      const targetCardIdx = target.hand.findIndex(c => c.uid === targetCard.uid);

      cur.hand[cardIdx] = targetCard;
      target.hand[targetCardIdx] = curCard;

      // Check infection: only The Thing passing Infected infects a human
      if (curCard.defId === 'infected' && cur.role === 'thing' && target.role === 'human') {
        target.role = 'infected';
        log(s, `${target.name} has been infected!`, `${target.name} заражён(а)!`);
      }
      if (targetCard.defId === 'infected' && target.role === 'thing' && cur.role === 'human') {
        cur.role = 'infected';
        log(s, `${cur.name} has been infected!`, `${cur.name} заражён(а)!`);
      }

      s.tradeSkipped = true;
      s.pendingAction = null;
      log(s,
        `${cur.name} used Temptation to trade with ${target.name}.`,
        `${cur.name} использовал(а) Соблазн для обмена с ${target.name}.`
      );

      if (s.step === 'play_or_discard') {
        s.step = 'end_turn';
        advanceTurn(s);
      }
      return s;
    }

    case 'PARTY_PASS_CARD': {
      // Handled by panic effect — simplified for now
      s.pendingAction = null;
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
          `Just Between Us could not be resolved.`,
          `«Только между нами» не удалось выполнить.`
        );
        return s;
      }

      const firstCard = firstTradeable[Math.floor(Math.random() * firstTradeable.length)];
      const secondCard = secondTradeable[Math.floor(Math.random() * secondTradeable.length)];
      const firstIdx = first.hand.findIndex(c => c.uid === firstCard.uid);
      const secondIdx = second.hand.findIndex(c => c.uid === secondCard.uid);
      if (firstIdx === -1 || secondIdx === -1) return s;

      first.hand[firstIdx] = secondCard;
      second.hand[secondIdx] = firstCard;

      if (firstCard.defId === 'infected' && first.role === 'thing' && second.role === 'human') {
        second.role = 'infected';
      }
      if (secondCard.defId === 'infected' && second.role === 'thing' && first.role === 'human') {
        first.role = 'infected';
      }

      s.pendingAction = null;
      // Just Between Us is always from a panic card, so after resolution the player draws again
      s.step = 'draw';
      log(s,
        `${first.name} and ${second.name} traded due to Just Between Us.`,
        `${first.name} и ${second.name} обменялись из-за «Только между нами».`
      );
      return s;
    }

    default:
      return s;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function needsTarget(defId: string): boolean {
  return ['flamethrower', 'analysis', 'axe', 'suspicion', 'swap_places',
          'get_out_of_here', 'quarantine', 'locked_door', 'temptation'].includes(defId);
}

function handleTradeStep(s: GameState): void {
  if (s.tradeSkipped) {
    s.step = 'end_turn';
    advanceTurn(s);
    return;
  }

  const cur = currentPlayer(s);
  const partner = getTradePartner(s);

  // Skip trade if obstacles prevent it
  if (!partner || cur.inQuarantine || partner.inQuarantine ||
      hasDoorBetween(s, cur.position, partner.position)) {
    log(s, 'Trade skipped due to obstacles.', 'Обмен пропущен из-за препятствий.');
    s.step = 'end_turn';
    advanceTurn(s);
  }
}

function advanceTurn(s: GameState): void {
  // Decrease quarantine counters
  const cur = currentPlayer(s);
  if (cur.inQuarantine) {
    cur.quarantineTurnsLeft--;
    if (cur.quarantineTurnsLeft <= 0) {
      cur.inQuarantine = false;
      log(s, `${cur.name}'s quarantine ended.`, `Карантин ${cur.name} закончился.`);
    }
  }

  // Move to next player
  s.currentPlayerIndex = nextPlayerIndex(s);
  s.step = 'draw';
  s.tradeSkipped = false;
  s.pendingAction = null;

  // Skip dead players
  let safety = 0;
  while (!s.players[s.currentPlayerIndex].isAlive && safety < s.players.length) {
    s.currentPlayerIndex = nextPlayerIndex(s);
    safety++;
  }

  // Check if game should end (1 player left)
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
      // Check for No Barbecue defense
      const hasDefense = target.hand.some(c => c.defId === 'no_barbecue');
      if (hasDefense) {
        s.pendingAction = {
          type: 'trade_defense',
          defenderId: target.id,
          fromId: player.id,
          offeredCardUid: card.uid,
          reason: 'flamethrower',
        };
        return; // Wait for defense response
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
      // Check for "I'm Fine Here" defense
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

    case 'get_out_of_here': {
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
      // The Temptation card is already spent; now choose which remaining card to offer.
      s.pendingAction = {
        type: 'choose_card_to_give',
        targetPlayerId: target.id,
      };
      break;
    }

    case 'axe': {
      if (!target) break;
      if (target.id === player.id) {
        // Remove own quarantine
        player.inQuarantine = false;
        player.quarantineTurnsLeft = 0;
      } else {
        // Remove target quarantine or door between
        if (target.inQuarantine) {
          target.inQuarantine = false;
          target.quarantineTurnsLeft = 0;
        } else {
          // Remove door between positions
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
  }
}

function eliminatePlayer(s: GameState, player: Player): void {
  player.isAlive = false;
  // Discard all cards face-down
  s.discard.push(...player.hand);
  player.hand = [];

  log(s,
    `${player.name} has been eliminated!`,
    `${player.name} уничтожен(а)!`
  );

  // Check if The Thing was eliminated
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
  // Update seats array
  s.seats[p1.position] = p1.id;
  s.seats[p2.position] = p2.id;
}

function assignPlayersToPositions(s: GameState, assignments: Array<{ playerId: number; position: number }>): void {
  assignments.forEach(({ playerId, position }) => {
    const player = getPlayer(s, playerId);
    player.position = position;
    s.seats[position] = playerId;
  });
}

function applyPanicEffect(s: GameState, card: CardInstance): void {
  switch (card.defId) {
    case 'panic_doors_open': {
      s.doors = [];
      log(s, 'All locked doors removed!', 'Все заблокированные двери убраны!');
      break;
    }
    case 'panic_quarantine_lifted': {
      s.players.forEach(p => {
        p.inQuarantine = false;
        p.quarantineTurnsLeft = 0;
      });
      log(s, 'All quarantines removed!', 'Все карантины сняты!');
      break;
    }
    case 'panic_musical_chairs': {
      const alive = s.players.filter(p => p.isAlive);
      const positions = alive.map(p => p.position).sort((a, b) => a - b);
      const assignments = positions.map((position, index) => {
        const fromIndex = (index - s.direction + positions.length) % positions.length;
        const player = alive.find(p => p.position === positions[fromIndex])!;
        return { playerId: player.id, position };
      });
      assignPlayersToPositions(s, assignments);
      log(s, 'Musical chairs! Everyone shifts one seat.', 'Музыкальные стулья! Все сдвинулись на одно место.');
      break;
    }
    case 'panic_1234': {
      const alive = s.players.filter(p => p.isAlive);
      const positions = alive.map(p => p.position).sort((a, b) => a - b);
      if (positions.length >= 2) {
        const cur = currentPlayer(s);
        const curIdx = positions.indexOf(cur.position);
        const block = Array.from({ length: Math.min(4, positions.length) }, (_, offset) =>
          positions[(curIdx + s.direction * (offset + 1) + positions.length * 4) % positions.length]
        );
        const uniqueBlock = Array.from(new Set(block));
        if (uniqueBlock.length >= 2) {
          const assignments = uniqueBlock.map((position, index) => {
            const fromIndex = (index + s.direction + uniqueBlock.length) % uniqueBlock.length;
            const player = alive.find(p => p.position === uniqueBlock[fromIndex])!;
            return { playerId: player.id, position };
          });
          assignPlayersToPositions(s, assignments);
        }
      }
      log(s, 'One, Two... Three, Four... Players shuffling!',
          'Раз, два... три, четыре... Игроки перемещаются!');
      break;
    }
    case 'panic_party': {
      // All pass 1 card to neighbor — simplified auto-pass random card
      const alive = s.players.filter(p => p.isAlive && p.hand.length > 0);
      if (alive.length < 2) break;
      const alivePos = alive.map(p => p.position).sort((a, b) => a - b);

      // Collect cards to pass
      const cardsToPass: Map<number, CardInstance> = new Map();
      alive.forEach(p => {
        // Pick a random tradeable card
        const tradeable = p.hand.filter(c =>
          c.defId !== 'the_thing' &&
          !(p.role === 'infected' && c.defId === 'infected' &&
            p.hand.filter(h => h.defId === 'infected').length <= 1)
        );
        if (tradeable.length > 0) {
          const pick = tradeable[Math.floor(Math.random() * tradeable.length)];
          cardsToPass.set(p.id, pick);
        }
      });

      // Pass cards
      cardsToPass.forEach((card, playerId) => {
        const player = getPlayer(s, playerId);
        const posIdx = alivePos.indexOf(player.position);
        const nextPosIdx = (posIdx + s.direction + alivePos.length) % alivePos.length;
        const nextPlayer = s.players.find(p => p.position === alivePos[nextPosIdx] && p.isAlive);
        if (nextPlayer) {
          const idx = player.hand.findIndex(c => c.uid === card.uid);
          if (idx !== -1) {
            player.hand.splice(idx, 1);
            nextPlayer.hand.push(card);
            // Check infection
            if (card.defId === 'infected' && player.role === 'thing' && nextPlayer.role === 'human') {
              nextPlayer.role = 'infected';
            }
          }
        }
      });

      log(s, 'Party! Everyone passed a card to their neighbor.',
          'Вечеринка! Все передали карту соседу.');
      break;
    }
    case 'panic_between_us': {
      const alive = s.players.filter(p => p.isAlive);
      if (alive.length >= 2) {
        s.pendingAction = {
          type: 'just_between_us',
          targets: alive.map(p => p.id),
        };
      }
      break;
    }
    case 'panic_quiet_night': {
      log(s, 'Quiet Night — no talking until next turn!',
          'Тихая ночь — никаких разговоров до следующего хода!');
      break;
    }
  }
}
