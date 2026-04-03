import type { APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:8788';

export type RoomView = {
  code: string;
  me: { sessionId: string; playerId: number | null };
  game: GameView | null;
  updatedAt: number;
};

type GameView = {
  phase: string;
  step: string;
  direction: 1 | -1;
  currentPlayerIndex: number;
  players: PlayerView[];
  pendingAction: PendingAction | null;
  winner: string | null;
  winnerPlayerIds: number[];
};

type PlayerView = {
  id: number;
  role?: string | null;
  isAlive: boolean;
  hand: Array<{ uid: string; defId: string }>;
  handCount: number;
  canReceiveInfectedCardFromMe?: boolean;
  position?: number;
};

type PendingAction = { type: string; [key: string]: unknown };

// ── API helpers ──────────────────────────────────────────────────────────────

async function post<T>(req: APIRequestContext, path: string, body: unknown): Promise<T> {
  const res = await req.post(`${BASE}${path}`, { data: body });
  const json = await res.json() as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(`POST ${path} failed: ${json.error}`);
  return json.data as T;
}

async function get<T>(req: APIRequestContext, path: string): Promise<T> {
  const res = await req.get(`${BASE}${path}`);
  const json = await res.json() as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(`GET ${path} failed: ${json.error}`);
  return json.data as T;
}

// ── Room helpers ─────────────────────────────────────────────────────────────

export async function createRoom(req: APIRequestContext, name: string): Promise<RoomView> {
  return post(req, '/api/rooms/create', { name });
}

export async function joinRoom(req: APIRequestContext, code: string, name: string): Promise<RoomView> {
  return post(req, `/api/rooms/${code}/join`, { name });
}

export async function addBot(req: APIRequestContext, code: string, sessionId: string): Promise<RoomView> {
  return post(req, `/api/rooms/${code}/add-bot`, { sessionId });
}

export async function startGame(req: APIRequestContext, code: string, sessionId: string): Promise<RoomView> {
  return post(req, `/api/rooms/${code}/start`, { sessionId });
}

export async function pollRoom(req: APIRequestContext, code: string, sessionId: string): Promise<RoomView> {
  return get(req, `/api/rooms/${code}?sessionId=${sessionId}`);
}

export async function sendAction(req: APIRequestContext, code: string, sessionId: string, action: unknown): Promise<RoomView> {
  return post(req, `/api/rooms/${code}/action`, { sessionId, action });
}

function getAlivePlayersInSeatOrder(game: GameView): PlayerView[] {
  return [...game.players]
    .filter(player => player.isAlive && typeof player.position === 'number')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function getTradePartner(game: GameView, meId: number): PlayerView | null {
  const alive = getAlivePlayersInSeatOrder(game);
  const idx = alive.findIndex(player => player.id === meId);
  if (idx === -1 || alive.length < 2) return null;

  const partnerIdx =
    game.direction === 1
      ? (idx + 1) % alive.length
      : (idx - 1 + alive.length) % alive.length;

  return alive[partnerIdx] ?? null;
}

function pickTradeableCard(me: PlayerView, receiver: PlayerView | null): { uid: string; defId: string } | null {
  return pickTradeableCards(me, receiver)[0] ?? null;
}

function pickTradeableCards(me: PlayerView, receiver: PlayerView | null): Array<{ uid: string; defId: string }> {
  const candidates: Array<{ uid: string; defId: string }> = [];
  const ordinary = me.hand.find(card => card.defId !== 'the_thing' && card.defId !== 'infected');
  if (ordinary) candidates.push(ordinary);

  for (const card of me.hand) {
    if (card.defId !== 'the_thing' && card.defId !== 'infected' && !candidates.some(candidate => candidate.uid === card.uid)) {
      candidates.push(card);
    }
  }

  const infectedCards = me.hand.filter(card => card.defId === 'infected');
  if (infectedCards.length > 0) {
    if (me.role === 'thing') candidates.push(...infectedCards.filter(card => !candidates.some(candidate => candidate.uid === card.uid)));
    if (me.role === 'infected' && receiver?.canReceiveInfectedCardFromMe && infectedCards.length > 1) {
      candidates.push(...infectedCards.filter(card => !candidates.some(candidate => candidate.uid === card.uid)));
    }
  }

  for (const card of me.hand) {
    if (card.defId !== 'the_thing' && !candidates.some(candidate => candidate.uid === card.uid)) {
      candidates.push(card);
    }
  }

  return candidates;
}

function pickDiscardableCard(me: PlayerView): { uid: string; defId: string } | null {
  return pickDiscardableCards(me)[0] ?? null;
}

function pickDiscardableCards(me: PlayerView): Array<{ uid: string; defId: string }> {
  const candidates: Array<{ uid: string; defId: string }> = [];

  for (const card of me.hand) {
    if (card.defId !== 'the_thing' && card.defId !== 'infected') {
      candidates.push(card);
    }
  }

  const infectedCards = me.hand.filter(card => card.defId === 'infected');
  if (infectedCards.length > 0) {
    if (me.role !== 'infected' || infectedCards.length > 1) {
      candidates.push(...infectedCards.filter(card => !candidates.some(candidate => candidate.uid === card.uid)));
    }
  }

  return candidates;
}

function getNextAlivePlayer(game: GameView, meId: number): PlayerView | null {
  const alive = getAlivePlayersInSeatOrder(game);
  const idx = alive.findIndex(player => player.id === meId);
  if (idx === -1 || alive.length < 2) return null;

  const nextIdx =
    game.direction === 1
      ? (idx + 1) % alive.length
      : (idx - 1 + alive.length) % alive.length;

  return alive[nextIdx] ?? null;
}

function pickPartyPassCards(game: GameView, me: PlayerView): Array<{ uid: string; defId: string }> {
  const candidates: Array<{ uid: string; defId: string }> = [];

  for (const card of me.hand) {
    if (card.defId !== 'the_thing' && card.defId !== 'infected') {
      candidates.push(card);
    }
  }

  const infectedCards = me.hand.filter(card => card.defId === 'infected');
  if (infectedCards.length === 0) {
    return candidates;
  }

  if (me.role === 'thing') {
    candidates.push(...infectedCards);
    return candidates;
  }

  if (me.role === 'infected') {
    const nextPlayer = getNextAlivePlayer(game, me.id);
    const canPassInfected =
      infectedCards.length > 1 &&
      nextPlayer?.canReceiveInfectedCardFromMe === true;

    if (canPassInfected) {
      candidates.push(...infectedCards);
    }
  }

  return candidates;
}

// ── Dumb player logic ─────────────────────────────────────────────────────────
// Decides a simple action for the human player so the game can progress.
// Strategy: draw → discard → skip trade → handle any mandatory prompts.

export function decideDumbActions(room: RoomView): unknown[] {
  const { game } = room;
  if (!game || game.phase === 'game_over') return [];

  const myId = room.me.playerId;
  if (myId === null) return [];

  const me = game.players.find(p => p.id === myId);
  if (!me || !me.isAlive) return [];
  const tradePartner = getTradePartner(game, myId);

  const currentPlayer = game.players[game.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === myId;
  const pa = game.pendingAction;

  const amPendingActor = (() => {
    if (!pa) return false;

    switch (pa.type) {
      case 'choose_target':
      case 'choose_card_to_give':
      case 'choose_card_to_discard':
      case 'persistence_pick':
      case 'declare_victory':
      case 'temptation_target':
      case 'just_between_us':
      case 'panic_choose_target':
      case 'blind_date_swap':
      case 'forgetful_discard':
      case 'panic_trade':
      case 'axe_choice':
        return isMyTurn;
      case 'trade_defense':
        return (pa.defenderId as number) === myId;
      case 'trade_offer':
      case 'temptation_response':
      case 'panic_trade_response':
        return (pa.toId as number) === myId;
      case 'view_hand':
      case 'view_card':
      case 'whisky_reveal':
        return (pa.viewerPlayerId as number) === myId;
      case 'show_hand_confirm':
        return (pa.playerId as number) === myId;
      case 'suspicion_pick':
        return (pa.viewerPlayerId as number) === myId;
      case 'party_pass':
        return (pa.pendingPlayerIds as number[]).includes(myId);
      case 'just_between_us_pick':
        return (pa.playerA as number) === myId || (pa.playerB as number) === myId;
      case 'revelations_round': {
        const order = pa.revealOrder as number[];
        const idx = pa.currentRevealerIdx as number;
        return order[idx] === myId;
      }
      case 'panic_effect':
        return false;
      default:
        return false;
    }
  })();

  // ── Handle pending actions addressed to me ────────────────────────────────
  if (pa) {
    // panic_effect is purely informational — fall through to regular turn logic
    if (pa.type !== 'panic_effect') switch (pa.type) {
      // Always decline to avoid complex branching
      case 'trade_defense':
        if ((pa.defenderId as number) !== myId) return [];
        if ((pa.reason as string) === 'trade') {
          const initiator = game.players.find(player => player.id === (pa.fromId as number)) ?? null;
          return pickTradeableCards(me, initiator).map(card => ({ type: 'RESPOND_TRADE', cardUid: card.uid }));
        }
        if ((pa.reason as string) === 'temptation') {
          const initiator = game.players.find(player => player.id === (pa.fromId as number)) ?? null;
          return pickTradeableCards(me, initiator).map(card => ({ type: 'TEMPTATION_RESPOND', cardUid: card.uid }));
        }
        if ((pa.reason as string) === 'panic_trade') {
          const initiator = game.players.find(player => player.id === (pa.fromId as number)) ?? null;
          return pickTradeableCards(me, initiator).map(card => ({ type: 'PANIC_TRADE_RESPOND', cardUid: card.uid }));
        }
        return [{ type: 'DECLINE_DEFENSE' }];

      // Accept incoming trade with first card in hand
      case 'trade_offer':
        if ((pa.toId as number) === myId) {
          return pickTradeableCards(me, game.players.find(player => player.id === (pa.fromId as number)) ?? null)
            .map(card => ({ type: 'RESPOND_TRADE', cardUid: card.uid }));
        }
        return [];

      // Give first card
      case 'choose_card_to_give':
        if (amPendingActor) {
          const receiver = game.players.find(player => player.id === (pa.targetPlayerId as number)) ?? null;
          return pickTradeableCards(me, receiver).map(card => ({ type: 'OFFER_TRADE', cardUid: card.uid }));
        }
        return [];

      // Discard first card
      case 'choose_card_to_discard':
        if (amPendingActor) {
          return pickDiscardableCards(me).map(card => ({ type: 'DISCARD_CARD', cardUid: card.uid }));
        }
        return [];

      // Confirm view of hand/card
      case 'view_hand':
      case 'view_card':
      case 'show_hand_confirm':
        if ((pa.viewerPlayerId as number) === myId || (pa.playerId as number) === myId)
          return [{ type: 'CONFIRM_VIEW' }];
        return [];

      // Whisky / revelations: reveal nothing
      case 'whisky_reveal':
        if ((pa.viewerPlayerId as number) === myId)
          return [{ type: 'REVELATIONS_RESPOND', show: false }];
        return [];

      case 'revelations_round': {
        const order = pa.revealOrder as number[];
        const idx = pa.currentRevealerIdx as number;
        if (order[idx] === myId) return [{ type: 'REVELATIONS_RESPOND', show: false }];
        return [];
      }

      // Suspicion: pick first selectable card
      case 'suspicion_pick': {
        if ((pa.viewerPlayerId as number) === myId) {
          const uids = pa.selectableCardUids as string[];
          if (uids.length > 0 && pa.previewCardUid === null)
            return uids.map(uid => ({ type: 'SUSPICION_PREVIEW_CARD', cardUid: uid }));
          if (pa.previewCardUid !== null)
            return [{ type: 'SUSPICION_CONFIRM_CARD', cardUid: pa.previewCardUid }];
        }
        return [];
      }

      // Select first target
      case 'choose_target':
        if (amPendingActor) {
          const targets = pa.targets as number[];
          if (targets.length > 0) return targets.map(targetPlayerId => ({ type: 'SELECT_TARGET', targetPlayerId }));
        }
        return [];

      case 'panic_choose_target':
        if (amPendingActor) {
          const targets = pa.targets as number[];
          if (targets.length > 0) return targets.map(targetPlayerId => ({ type: 'PANIC_SELECT_TARGET', targetPlayerId }));
        }
        return [];

      case 'declare_victory':
        if (amPendingActor) return [{ type: 'DECLARE_VICTORY' }];
        return [];

      case 'persistence_pick':
        if (amPendingActor) {
          const drawn = pa.drawnCards as Array<{ uid: string }>;
          const keep = drawn[0];
          const discard = drawn.slice(1);
          if (keep) return [{ type: 'PERSISTENCE_PICK', keepUid: keep.uid, discardUids: discard.map(c => c.uid) }];
        }
        return [];

      case 'temptation_target':
        if (amPendingActor) {
          const targets = pa.targets as number[];
          const cardUid = pa.cardUid as string;
          if (targets.length > 0) return targets.map(targetPlayerId => ({ type: 'TEMPTATION_SELECT', targetPlayerId, cardUid }));
        }
        return [];

      case 'temptation_response':
        if ((pa.toId as number) === myId) {
          const initiator = game.players.find(player => player.id === (pa.fromId as number)) ?? null;
          return pickTradeableCards(me, initiator).map(card => ({ type: 'TEMPTATION_RESPOND', cardUid: card.uid }));
        }
        return [];

      case 'party_pass':
        if (amPendingActor) {
          return pickPartyPassCards(game, me).map(card => ({ type: 'PARTY_PASS_CARD', cardUid: card.uid, playerId: myId }));
        }
        return [];

      case 'just_between_us':
        if (amPendingActor) {
          const targets = pa.targets as number[];
          if (targets.length >= 2) {
            const actions: Array<{ type: 'JUST_BETWEEN_US_SELECT'; player1: number; player2: number }> = [];
            for (let left = 0; left < targets.length; left++) {
              for (let right = left + 1; right < targets.length; right++) {
                actions.push({ type: 'JUST_BETWEEN_US_SELECT', player1: targets[left], player2: targets[right] });
              }
            }
            return actions;
          }
        }
        return [];

      case 'just_between_us_pick':
        if (amPendingActor) {
          const receiverId = (pa.playerA as number) === myId ? (pa.playerB as number) : (pa.playerA as number);
          const receiver = game.players.find(player => player.id === receiverId) ?? null;
          return pickTradeableCards(me, receiver).map(card => ({ type: 'JUST_BETWEEN_US_PICK', cardUid: card.uid, playerId: myId }));
        }
        return [];

      case 'blind_date_swap':
        if (amPendingActor) {
          return me.hand.map(card => ({ type: 'BLIND_DATE_PICK', cardUid: card.uid }));
        }
        return [];

      case 'forgetful_discard':
        if (amPendingActor) {
          return pickDiscardableCards(me).map(card => ({ type: 'FORGETFUL_DISCARD_PICK', cardUid: card.uid }));
        }
        return [];

      case 'panic_trade':
        if (amPendingActor) {
          const target = pa.targetPlayerId as number;
          const receiver = game.players.find(player => player.id === target) ?? null;
          return pickTradeableCards(me, receiver).map(card => ({ type: 'PANIC_TRADE_SELECT', targetPlayerId: target, cardUid: card.uid }));
        }
        return [];

      case 'panic_trade_response':
        if ((pa.toId as number) === myId) {
          const initiator = game.players.find(player => player.id === (pa.fromId as number)) ?? null;
          return pickTradeableCards(me, initiator).map(card => ({ type: 'PANIC_TRADE_RESPOND', cardUid: card.uid }));
        }
        return [];

      case 'axe_choice':
        if (amPendingActor) {
          const canQ = pa.canRemoveQuarantine as boolean;
          return [{ type: 'AXE_CHOOSE_EFFECT', targetPlayerId: pa.targetPlayerId, choice: canQ ? 'quarantine' : 'door' }];
        }
        return [];

      default:
        return [];
    } // end switch inside if (pa.type !== 'panic_effect')
  }

  // ── Regular turn steps ────────────────────────────────────────────────────
  // Reached here if: no pending action, OR pending action is panic_effect (informational only)
  if (!isMyTurn) return [];

  switch (game.step) {
    case 'draw':
      return [{ type: 'DRAW_CARD' }];

    case 'play_or_discard': {
      return pickDiscardableCards(me).map(discard => ({ type: 'DISCARD_CARD', cardUid: discard.uid }));
    }

    case 'trade':
      {
        return pickTradeableCards(me, tradePartner).map(tradeCard => ({ type: 'OFFER_TRADE', cardUid: tradeCard.uid }));
      }

    case 'end_turn':
      return [{ type: 'END_TURN' }];

    default:
      return [];
  }
}

export function decideDumbAction(room: RoomView): unknown | null {
  return decideDumbActions(room)[0] ?? null;
}

// ── Full game runner ──────────────────────────────────────────────────────────
// Runs a complete game to game_over. Returns the final room state.

export async function runGameToCompletion(
  req: APIRequestContext,
  code: string,
  sessionId: string,
  maxActions = 2000,
): Promise<RoomView> {
  let room = await pollRoom(req, code, sessionId);
  let stalled = 0;
  let prevUpdatedAt = 0;
  const rejectedActions = new Map<string, Set<string>>();

  const stateKey = (state: RoomView): string => {
    return JSON.stringify({
      meId: state.me.playerId,
      game: state.game,
    });
  };

  for (let i = 0; i < maxActions; i++) {
    if (room.game?.phase === 'game_over') return room;

    const key = stateKey(room);
    const rejectedForState = rejectedActions.get(key) ?? new Set<string>();
    const actions = decideDumbActions(room).filter(action => !rejectedForState.has(JSON.stringify(action)));
    const action = actions[0] ?? null;

    if (action) {
      try {
        const beforeKey = key;
        const nextRoom = await sendAction(req, code, sessionId, action);
        if (stateKey(nextRoom) === beforeKey) {
          rejectedForState.add(JSON.stringify(action));
          rejectedActions.set(beforeKey, rejectedForState);
          room = nextRoom;
        } else {
          rejectedActions.delete(beforeKey);
          room = nextRoom;
          stalled = 0;
        }
      } catch {
        // Action rejected — poll and wait for bot turns
        rejectedForState.add(JSON.stringify(action));
        rejectedActions.set(key, rejectedForState);
        await new Promise(r => setTimeout(r, 150));
        room = await pollRoom(req, code, sessionId);
      }
    } else {
      // Not my turn — wait for bots
      await new Promise(r => setTimeout(r, 200));
      room = await pollRoom(req, code, sessionId);
      if (room.updatedAt === prevUpdatedAt) stalled++;
      else stalled = 0;
      if (stalled > 40) throw new Error(`Game stalled after ${i} iterations (updatedAt unchanged)`);
    }

    prevUpdatedAt = room.updatedAt;
  }

  throw new Error(`Game did not finish within ${maxActions} actions`);
}
