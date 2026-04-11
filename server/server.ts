import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';

import {
  createInitialState,
  currentPlayer,
  gameReducer,
} from '../src/gameLogic.ts';
import { allowsActionForPendingAction } from '../src/pendingActionGuards.ts';
import type {
  GameAction,
  GameState,
  PendingAction,
  Player,
} from '../src/types.ts';
import type {
  ApiResponse,
  CreateRoomPayload,
  RoomActionPayload,
  RoomSessionPayload,
  RoomView,
  ShoutEntry,
  ShoutPayload,
  ViewerPlayerState,
} from '../src/multiplayer.ts';
import { decideBotAction, clearRoomMemory } from './bot/index.ts';
import { createRandomSeating } from './seatAssignment.ts';
import { saveRoom, deleteRoom, loadAllRooms, createUser, getUserById, getUserByName, updateUserElo, recordGameResult, getUserStats, getCompactStats } from './db.ts';
import { hashPassword, verifyPassword, signToken, verifyToken, calcElo } from './auth.ts';

type RoomMember = {
  sessionId: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  isSpectator: boolean;
  playerId: number | null;
  userId: number | null;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
  /** Cached from Supabase; refreshed on join and after game ends */
  cachedStats: { elo: number; winRate: number; gamesPlayed: number } | null;
};

type Room = {
  code: string;
  members: RoomMember[];
  game: GameState | null;
  updatedAt: number;
  /** Ephemeral animation override — set on specific player actions, expires automatically */
  tableAnimOverride?: { event: import('../src/multiplayer.ts').TableAnimEvent; expiresAt: number } | null;
  /** Short-lived player shout phrases visible to all, expire after 5s */
  shouts: ShoutEntry[];
};

type KickedSession = {
  roomCode: string;
  expiresAt: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const rooms = new Map<string, Room>();

// Restore persisted rooms from SQLite on startup
for (const room of loadAllRooms<Room>()) {
  rooms.set(room.code, room);
}
console.log(`[db] Loaded ${rooms.size} room(s) from disk`);

const kickedSessions = new Map<string, KickedSession>();
const KICKED_BY_HOST_ERROR = 'KICKED_BY_HOST';
const KICKED_SESSION_TTL_MS = 1000 * 60 * 5;
const botTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── Rate Limiting ────────────────────────────────────────────────────────────
/** Max game actions per player per window */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10_000;
/** sessionId → { count, windowStart } */
const actionRateMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = actionRateMap.get(sessionId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    actionRateMap.set(sessionId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

// Periodically prune stale rate limit entries
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [id, entry] of actionRateMap) {
    if (entry.windowStart < cutoff) actionRateMap.delete(id);
  }
}, 60_000);

type RoomSocket = WebSocket & {
  roomCode?: string;
  sessionId?: string;
  isAlive?: boolean;
};
const roomSockets = new Map<string, Set<RoomSocket>>();

type HttpRequest = IncomingMessage;
type HttpResponse = ServerResponse<IncomingMessage>;

function randomId(size = 12): string {
  return randomBytes(size).toString('hex');
}

function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function now(): number {
  return Date.now();
}

function json<T>(data: T): string {
  return JSON.stringify(data);
}

function sendJson<T>(res: HttpResponse, statusCode: number, body: ApiResponse<T>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(json(body));
}

async function readBody<T>(req: HttpRequest): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function notFound<T>(res: HttpResponse, message = 'Not found'): void {
  sendJson<T>(res, 404, { ok: false, error: message });
}

function badRequest<T>(res: HttpResponse, message: string): void {
  sendJson<T>(res, 400, { ok: false, error: message });
}

function getRoom(code: string): Room | null {
  return rooms.get(code.toUpperCase()) ?? null;
}

function getMember(room: Room, sessionId: string): RoomMember | null {
  return room.members.find((member) => member.sessionId === sessionId) ?? null;
}

function markSessionKicked(roomCode: string, sessionId: string): void {
  kickedSessions.set(sessionId, {
    roomCode,
    expiresAt: now() + KICKED_SESSION_TTL_MS,
  });
}

function isSessionKicked(roomCode: string, sessionId: string): boolean {
  const kicked = kickedSessions.get(sessionId);
  if (!kicked) return false;
  if (kicked.expiresAt <= now()) {
    kickedSessions.delete(sessionId);
    return false;
  }
  return kicked.roomCode === roomCode;
}

function sendSessionError<T>(res: HttpResponse, roomCode: string, sessionId: string, fallback = 'Session not found.'): void {
  if (isSessionKicked(roomCode, sessionId)) {
    sendJson<T>(res, 403, { ok: false, error: KICKED_BY_HOST_ERROR });
    return;
  }
  badRequest<T>(res, fallback);
}

function closeRoomSocketSession(roomCode: string, sessionId: string): void {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;

  for (const socket of [...sockets]) {
    if (socket.sessionId !== sessionId) continue;
    sockets.delete(socket);
    socket.close(4001, 'Session closed');
  }

  if (sockets.size === 0) {
    roomSockets.delete(roomCode);
  }
}

function trimName(name: string | undefined): string {
  return (name ?? '').trim().slice(0, 20);
}

function createHostAddress(req?: Pick<HttpRequest, 'headers'> | null): string {
  if (!req) {
    return process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
  }
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? `localhost:${port}`;
  return `${protocol}://${forwardedHost}`;
}

function clonePendingAction<T extends PendingAction | null>(pendingAction: T): T {
  if (!pendingAction) {
    return pendingAction;
  }

  return JSON.parse(JSON.stringify(pendingAction)) as T;
}

function makeSceneId(prefix: string, ...parts: Array<string | number | undefined>): string {
  return [prefix, ...parts]
    .filter((part): part is string | number => part !== undefined)
    .join(':');
}

function clonePlayerForViewer(
  player: Player,
  viewer: Player | null,
  viewerId: number | null,
  revealRoles: boolean,
  isSpectator = false,
): ViewerPlayerState {
  return {
    id: player.id,
    name: player.name,
    role: revealRoles || player.id === viewerId ? player.role : null,
    avatarId: player.avatarId,
    canReceiveInfectedCardFromMe:
      viewer == null || viewer.id === player.id
        ? false
        : viewer.role === 'thing'
          ? true
          : viewer.role === 'infected'
            ? player.role === 'thing'
            : false,
    isKnownInfectedToMe:
      revealRoles
        ? player.role === 'infected'
        : viewer != null && viewer.role === 'thing' && player.role === 'infected',
    hand: player.id === viewerId || isSpectator ? [...player.hand] : [],
    handCount: player.hand.length,
    isAlive: player.isAlive,
    inQuarantine: player.inQuarantine,
    quarantineTurnsLeft: player.quarantineTurnsLeft,
    position: player.position,
  };
}

function canViewerSeePendingAction(
  pendingAction: PendingAction,
  game: GameState,
  viewerId: number | null,
): boolean {
  if (viewerId === null) {
    return Boolean(
      pendingAction.type === 'whisky_reveal' && pendingAction.public,
    );
  }

  switch (pendingAction.type) {
    case 'choose_target':
    case 'choose_card_to_discard':
    case 'choose_card_to_give':
    case 'persistence_pick':
    case 'temptation_target':
    case 'declare_victory':
      return currentPlayer(game).id === viewerId;
    case 'trade_offer':
      return pendingAction.fromId === viewerId || pendingAction.toId === viewerId;
    case 'trade_defense':
      return pendingAction.defenderId === viewerId;
    case 'suspicion_pick':
      return true;
    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal':
      return pendingAction.public === true || pendingAction.viewerPlayerId === viewerId;
    case 'show_hand_confirm':
      return pendingAction.playerId === viewerId;
    case 'party_pass':
      // All participants (pending + already chosen) must see this panel
      return pendingAction.pendingPlayerIds.includes(viewerId) ||
        pendingAction.chosen.some(c => c.playerId === viewerId);
    case 'temptation_response':
      return viewerId === pendingAction.fromId || viewerId === pendingAction.toId;
    case 'just_between_us_pick':
      return viewerId === pendingAction.playerA || viewerId === pendingAction.playerB;
    case 'panic_effect':
      return currentPlayer(game).id === viewerId;
    case 'just_between_us':
    case 'panic_choose_target':
    case 'blind_date_swap':
    case 'forgetful_discard':
    case 'panic_trade':
    case 'axe_choice':
      return currentPlayer(game).id === viewerId;
    case 'panic_trade_response':
      return viewerId === pendingAction.fromId || viewerId === pendingAction.toId;
    case 'revelations_round': {
      const revIdx = pendingAction.revealOrder[pendingAction.currentRevealerIdx];
      return game.players[revIdx]?.id === viewerId;
    }
    default:
      return false;
  }
}

function sanitizePendingAction(
  pendingAction: PendingAction | null,
  game: GameState,
  viewerId: number | null,
): PendingAction | null {
  if (!pendingAction) {
    return null;
  }

  if (!canViewerSeePendingAction(pendingAction, game, viewerId)) {
    return null;
  }

  if (pendingAction.type === 'suspicion_pick') {
    return clonePendingAction(pendingAction);
  }

  return clonePendingAction(pendingAction);
}

/** Build a lightweight public animation hint.
 *  Checks room-level ephemeral overrides first (set by specific player actions),
 *  then falls back to the current pending action. No private card data included. */
function buildTableAnim(
  game: GameState,
  room: Room,
): import('../src/multiplayer.ts').TableAnimEvent | null {
  // Ephemeral override (e.g. "defense card just played", "cards swapping")
  if (room.tableAnimOverride && room.tableAnimOverride.expiresAt > Date.now()) {
    return room.tableAnimOverride.event;
  }

  const pa = game.pendingAction;
  if (!pa) return null;

  // Exchange being negotiated — show the initiator card in the centre and wait for the target.
  if (pa.type === 'trade_offer') {
    return {
      type: 'exchange_pending',
      sceneId: makeSceneId('trade-offer', pa.fromId, pa.toId, pa.offeredCardUid),
      initiatorId: pa.fromId,
      targetId: pa.toId,
      mode: 'trade',
    };
  }
  if (pa.type === 'temptation_response') {
    return {
      type: 'exchange_pending',
      sceneId: makeSceneId('temptation', pa.fromId, pa.toId, pa.offeredCardUid),
      initiatorId: pa.fromId,
      targetId: pa.toId,
      mode: 'temptation',
    };
  }
  if (pa.type === 'panic_trade_response') {
    return {
      type: 'exchange_pending',
      sceneId: makeSceneId('panic-trade', pa.fromId, pa.toId, pa.offeredCardUid),
      initiatorId: pa.fromId,
      targetId: pa.toId,
      mode: 'panic_trade',
    };
  }
  if (pa.type === 'trade_defense') {
    if (pa.reason === 'trade' || pa.reason === 'swap' || pa.reason === 'temptation' || pa.reason === 'panic_trade') {
      return {
        type: 'exchange_pending',
        sceneId: makeSceneId(`trade-defense-${pa.reason}`, pa.fromId, pa.defenderId, pa.offeredCardUid),
        initiatorId: pa.fromId,
        targetId: pa.defenderId,
        mode: pa.reason === 'panic_trade' ? 'panic_trade' : pa.reason,
      };
    }
    // flamethrower / analysis — show the attack card while defender decides
    return { type: 'card', sceneId: makeSceneId('pending-card', pa.reason, pa.defenderId), cardDefId: pa.reason };
  }

  // Card being played (targeting phase) or persistence
  if (pa.type === 'choose_target')       return { type: 'card', sceneId: makeSceneId('choose-target', pa.cardDefId, pa.cardUid), cardDefId: pa.cardDefId };
  if (pa.type === 'persistence_pick')    return { type: 'card', sceneId: 'persistence-pick', cardDefId: 'persistence' };
  if (pa.type === 'panic_choose_target') return { type: 'card', sceneId: makeSceneId('panic-target', pa.panicDefId), cardDefId: pa.panicDefId };
  if (pa.type === 'temptation_target')   return { type: 'card', sceneId: makeSceneId('temptation-target', pa.cardUid), cardDefId: 'temptation' };
  if (pa.type === 'blind_date_swap')     return { type: 'card', sceneId: 'blind-date', cardDefId: 'panic_blind_date' };
  if (pa.type === 'panic_trade')         return { type: 'card', sceneId: 'panic-trade-card', cardDefId: 'cant_be_friends' };
  if (pa.type === 'forgetful_discard')   return { type: 'card', sceneId: makeSceneId('forgetful', pa.remaining), cardDefId: 'panic_forgetful' };
  if (pa.type === 'revelations_round')   return { type: 'card', sceneId: makeSceneId('revelations', pa.currentRevealerIdx), cardDefId: 'panic_revelations' };
  if (pa.type === 'party_pass')          return { type: 'card', sceneId: makeSceneId('party-pass', pa.chosen.length, pa.pendingPlayerIds.length), cardDefId: 'panic_chain_reaction' };

  return null;
}

function sanitizeGame(game: GameState, viewerId: number | null, room: Room, isWatcher = false): import('../src/multiplayer.ts').ViewerGameState {
  const viewer = viewerId === null ? null : game.players.find((player) => player.id === viewerId) ?? null;
  // Reveal everything to: watchers (external spectators), eliminated players who accepted spectator mode, and after game_over
  const isSpectator = isWatcher || (viewer != null && !viewer.isAlive && game.phase !== 'game_over');
  const revealRoles = game.phase === 'game_over' || isSpectator;

  return {
    ...game,
    players: game.players.map((player) => clonePlayerForViewer(player, viewer, viewerId, revealRoles, isSpectator)),
    pendingAction: sanitizePendingAction(game.pendingAction, game, viewerId),
    tableAnim: buildTableAnim(game, room),
  };
}

function roomView(room: Room, member: RoomMember, req?: Pick<HttpRequest, 'headers'> | null): RoomView {
  return {
    code: room.code,
    me: {
      sessionId: member.sessionId,
      name: member.name,
      isHost: member.isHost,
      isSpectator: member.isSpectator,
      playerId: member.playerId,
    },
    members: room.members.map((roomMember) => ({
      sessionId: roomMember.sessionId,
      name: roomMember.name,
      isHost: roomMember.isHost,
      isBot: roomMember.isBot,
      isSpectator: roomMember.isSpectator,
      playerId: roomMember.playerId,
      connected: roomMember.connected,
      joinedAt: roomMember.joinedAt,
      stats: roomMember.cachedStats ?? null,
    })),
    game: room.game ? sanitizeGame(room.game, member.playerId, room, member.isSpectator) : null,
    hostAddress: createHostAddress(req),
    updatedAt: room.updatedAt,
    shouts: (room.shouts ?? []).filter(s => s.expiresAt > now()),
  };
}

function touchRoom(room: Room): void {
  room.updatedAt = now();
  saveRoom(room);
}

/** Fetch stats from Supabase and store on member (call after login or game end) */
async function refreshMemberStats(member: RoomMember): Promise<void> {
  if (!member.userId) return;
  try {
    const user = await getUserById(member.userId);
    if (!user) return;
    member.cachedStats = await getCompactStats(user.id, user.elo);
  } catch (err) {
    console.error('[stats] Failed to refresh member stats:', err);
  }
}

/** Push room state to all WebSocket subscribers for this room */
function broadcastRoom(room: Room): void {
  const sockets = roomSockets.get(room.code);
  if (!sockets || sockets.size === 0) return;

  for (const socket of [...sockets]) {
    if (socket.readyState !== WebSocket.OPEN || !socket.sessionId) continue;
    const member = getMember(room, socket.sessionId);
    if (!member) continue;
    const view = roomView(room, member);
    socket.send(JSON.stringify({ ok: true, data: view }));
  }
}

function cleanupRooms(): void {
  const nowMs = now();
  const STALE_CUTOFF = nowMs - 1000 * 60 * 60 * 12;      // 12h — any inactive room
  const EMPTY_CUTOFF = nowMs - 1000 * 60 * 60;            // 1h  — room with no connected members
  const NO_MEMBERS_CUTOFF = nowMs - 1000 * 60 * 5;        // 5m  — room with zero members at all

  for (const [code, room] of rooms.entries()) {
    const connectedCount = room.members.filter(m => m.connected).length;
    const memberCount = room.members.length;

    const isStale = room.updatedAt < STALE_CUTOFF;
    const isAbandoned = connectedCount === 0 && room.updatedAt < EMPTY_CUTOFF;
    const isEmpty = memberCount === 0 && room.updatedAt < NO_MEMBERS_CUTOFF;

    if (isStale || isAbandoned || isEmpty) {
      const botTimer = botTurnTimers.get(code);
      if (botTimer) {
        clearTimeout(botTimer);
        botTurnTimers.delete(code);
      }
      rooms.delete(code);
      deleteRoom(code);
      clearRoomMemory(code);
      const sockets = roomSockets.get(code);
      if (sockets) {
        for (const socket of sockets) socket.close(4000, 'Room cleaned up');
        roomSockets.delete(code);
      }
      console.log(`[cleanup] Room ${code} removed (stale=${isStale}, abandoned=${isAbandoned}, empty=${isEmpty})`);
    }
  }

  for (const [sessionId, kicked] of kickedSessions.entries()) {
    if (kicked.expiresAt <= nowMs || !rooms.has(kicked.roomCode)) {
      kickedSessions.delete(sessionId);
    }
  }
}

function startRoomGame(room: Room, thingInDeck?: boolean, chaosMode?: boolean): void {
  const seating = createRandomSeating(room.members);
  const game = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames: seating.playerNames,
    thingInDeck,
    chaosMode,
  });

  if (game.phase === 'role_reveal') {
    game.phase = 'playing';
    game.revealingPlayer = game.players.length - 1;
  }

  room.members.forEach((member) => {
    member.playerId = seating.playerIdBySessionId.get(member.sessionId) ?? null;
  });
  room.game = game;
  touchRoom(room);
}

const BOT_NAMES = ['Алекс 🤖', 'Макс 🤖', 'Кира 🤖', 'Рик 🤖', 'Зои 🤖', 'Нео 🤖', 'Ева 🤖', 'Дэн 🤖', 'Сэм 🤖', 'Лия 🤖', 'Кай 🤖'];

/**
 * Build a safe fallback action when the bot AI crashes or returns null.
 * Prevents the game from hanging indefinitely on a bot exception.
 */
function buildBotFallbackAction(game: GameState, playerId: number): GameAction | null {
  const pa = game.pendingAction;
  const player = game.players.find(p => p.id === playerId);
  if (!player) return null;

  // Respond to specific pending actions first
  if (pa) {
    switch (pa.type) {
      case 'trade_offer': {
        // Must respond with a card from hand
        const card = player.hand.find(c => c.defId !== 'the_thing' && c.defId !== 'infected') ?? player.hand[0];
        if (card) return { type: 'OFFER_TRADE', cardUid: card.uid };
        break;
      }
      case 'trade_defense':
        return { type: 'DECLINE_DEFENSE' };
      case 'temptation_response': {
        const card = player.hand.find(c => c.defId !== 'the_thing' && c.defId !== 'infected') ?? player.hand[0];
        if (card) return { type: 'TEMPTATION_RESPOND', cardUid: card.uid };
        break;
      }
      case 'panic_trade_response': {
        const card = player.hand.find(c => c.defId !== 'the_thing' && c.defId !== 'infected') ?? player.hand[0];
        if (card) return { type: 'PANIC_TRADE_RESPOND', cardUid: card.uid };
        break;
      }
      default:
        break;
    }
  }

  // Default: draw if it's the draw step, otherwise discard the first non-thing card
  if (game.step === 'draw') return { type: 'DRAW_CARD' };

  const discardable = player.hand.find(c => c.defId !== 'the_thing' && c.defId !== 'infected');
  if (discardable) return { type: 'DISCARD_CARD', cardUid: discardable.uid };

  const anyCard = player.hand[0];
  if (anyCard) return { type: 'DISCARD_CARD', cardUid: anyCard.uid };

  return null;
}

/**
 * Schedule bot auto-play. Checks if any bot needs to act and dispatches actions
 * with small delays to feel natural. Chains multiple actions if needed.
 */
function scheduleBotTurn(room: Room): void {
  if (!room.game || room.game.phase !== 'playing') return;
  if (botTurnTimers.has(room.code)) return;

  // Find which bot needs to act right now
  const botMember = findBotThatNeedsToAct(room);
  if (!botMember || botMember.playerId === null) return;

  // In fast mode (tests) use minimal delays; otherwise simulate "thinking" time
  const fastMode = process.env.FAST_BOT === '1';
  const pa = room.game.pendingAction;
  const isQuickAction = pa && ['view_hand', 'view_card', 'whisky_reveal', 'show_hand_confirm'].includes(pa.type);
  const delay = fastMode
    ? 20
    : isQuickAction
      ? 1500 + Math.floor(Math.random() * 1000)
      : 3000 + Math.floor(Math.random() * 3000);

  const timer = setTimeout(() => {
    botTurnTimers.delete(room.code);
    if (!room.game || room.game.phase !== 'playing') return;

    // Re-evaluate whose turn it is at execution time to avoid stale timers
    const activeBotMember = findBotThatNeedsToAct(room);
    if (!activeBotMember || activeBotMember.playerId === null) return;

    let action: GameAction | null;
    try {
      action = decideBotAction(room.game, activeBotMember.playerId, room.code);
    } catch (err) {
      console.error(`[Bot ${activeBotMember.name}] decideBotAction threw:`, err);
      action = buildBotFallbackAction(room.game, activeBotMember.playerId);
    }
    if (!action) {
      console.warn(`[Bot ${activeBotMember.name}] No action decided, step=${room.game.step}, pa=${room.game.pendingAction?.type}`);
      action = buildBotFallbackAction(room.game, activeBotMember.playerId);
      if (!action) return;
    }

    // Apply the action via the same path as human players
    const error = applyRoomAction(room, activeBotMember, action);
    if (error) {
      console.warn(`[Bot ${activeBotMember.name}] Action failed: ${error}`, action.type, JSON.stringify(action));
      return;
    }

    broadcastRoom(room);

    // Chain: after this action, check if a bot needs to act again
    scheduleBotTurn(room);
  }, delay);

  botTurnTimers.set(room.code, timer);
}

/** Find the bot member who currently needs to take an action */
function findBotThatNeedsToAct(room: Room): RoomMember | null {
  if (!room.game || room.game.phase !== 'playing') return null;

  const game = room.game;
  const pa = game.pendingAction;

  // If there's a pending action, find which player needs to respond
  if (pa) {
    let responderId: number | null = null;

    switch (pa.type) {
      case 'choose_target':
      case 'persistence_pick':
      case 'blind_date_swap':
      case 'forgetful_discard':
      case 'panic_trade':
      case 'axe_choice':
      case 'declare_victory':
      case 'choose_card_to_discard':
      case 'choose_card_to_give':
      case 'panic_choose_target':
      case 'temptation_target':
      case 'just_between_us':
        responderId = currentPlayer(game).id;
        break;
      case 'trade_defense':
        responderId = pa.defenderId;
        break;
      case 'trade_offer':
        responderId = pa.toId;
        break;
      case 'temptation_response':
        responderId = pa.toId;
        break;
      case 'panic_trade_response':
        responderId = pa.toId;
        break;
      case 'suspicion_pick':
        responderId = pa.viewerPlayerId;
        break;
      case 'view_hand':
      case 'view_card':
      case 'whisky_reveal':
        responderId = pa.viewerPlayerId;
        break;
      case 'show_hand_confirm':
        responderId = pa.playerId;
        break;
      case 'party_pass':
        // Find first pending bot
        for (const pid of pa.pendingPlayerIds) {
          const m = room.members.find(rm => rm.playerId === pid && rm.isBot);
          if (m) return m;
        }
        return null;
      case 'revelations_round':
        responderId = pa.revealOrder[pa.currentRevealerIdx];
        break;
      case 'just_between_us_pick': {
        // Find whichever side hasn't acted yet — check if either is a bot
        const mA = room.members.find(rm => rm.playerId === pa.playerA && rm.isBot);
        const mB = room.members.find(rm => rm.playerId === pa.playerB && rm.isBot);
        if (mA && pa.cardUidA === null) return mA;
        if (mB && pa.cardUidB === null) return mB;
        return null;
      }
      default:
        return null;
    }

    if (responderId !== null) {
      return room.members.find(m => m.playerId === responderId && m.isBot) ?? null;
    }
    return null;
  }

  // No pending action — check if it's a bot's normal turn
  const curId = currentPlayer(game).id;
  return room.members.find(m => m.playerId === curId && m.isBot) ?? null;
}

function resetRoom(room: Room): void {
  const botTimer = botTurnTimers.get(room.code);
  if (botTimer) {
    clearTimeout(botTimer);
    botTurnTimers.delete(room.code);
  }
  room.game = null;
  room.members.forEach((member) => {
    member.playerId = null;
  });
  clearRoomMemory(room.code);
  touchRoom(room);
}

function currentPlayerId(room: Room): number | null {
  return room.game ? currentPlayer(room.game).id : null;
}

function allowedToDispatch(room: Room, member: RoomMember, action: GameAction): boolean {
  if (!room.game || member.playerId === null) {
    return false;
  }

  const pendingAction = room.game.pendingAction;
  const currentId = currentPlayerId(room);

  if (!allowsActionForPendingAction(pendingAction, action)) {
    return false;
  }

  switch (action.type) {
    case 'SET_LANG':
    case 'START_GAME':
    case 'REVEAL_NEXT':
      return false;
    case 'RESPOND_TRADE':
      return pendingAction?.type === 'trade_defense' &&
        pendingAction.reason === 'trade' &&
        pendingAction.defenderId === member.playerId;
    case 'PLAY_DEFENSE':
      return pendingAction?.type === 'trade_defense' && pendingAction.defenderId === member.playerId;
    case 'DECLINE_DEFENSE':
      return pendingAction?.type === 'trade_defense' &&
        ['flamethrower', 'analysis', 'swap'].includes(pendingAction.reason) &&
        pendingAction.defenderId === member.playerId;
    case 'PARTY_PASS_CARD':
      return pendingAction?.type === 'party_pass' &&
        pendingAction.pendingPlayerIds.includes(member.playerId ?? -1) &&
        action.playerId === member.playerId;
    case 'SUSPICION_PREVIEW_CARD':
    case 'SUSPICION_CONFIRM_CARD':
      return pendingAction?.type === 'suspicion_pick' &&
        pendingAction.viewerPlayerId === member.playerId;
    case 'JUST_BETWEEN_US_PICK':
      return pendingAction?.type === 'just_between_us_pick' &&
        (pendingAction.playerA === member.playerId || pendingAction.playerB === member.playerId) &&
        action.playerId === member.playerId;
    case 'TEMPTATION_RESPOND':
      return (
        (pendingAction?.type === 'temptation_response' && pendingAction.toId === member.playerId) ||
        (pendingAction?.type === 'trade_defense' && pendingAction.reason === 'temptation' && pendingAction.defenderId === member.playerId)
      );
    case 'PANIC_TRADE_RESPOND':
      return (
        (pendingAction?.type === 'panic_trade_response' && pendingAction.toId === member.playerId) ||
        (pendingAction?.type === 'trade_defense' && pendingAction.reason === 'panic_trade' && pendingAction.defenderId === member.playerId)
      );
    case 'AXE_CHOOSE_EFFECT':
      return pendingAction?.type === 'axe_choice' &&
        currentId === member.playerId &&
        pendingAction.targetPlayerId === action.targetPlayerId;
    case 'REVELATIONS_RESPOND':
      return pendingAction?.type === 'revelations_round' &&
        pendingAction.revealOrder[pendingAction.currentRevealerIdx] === member.playerId;
    case 'CONFIRM_VIEW':
      if (!pendingAction) {
        return false;
      }
      if (pendingAction.type === 'view_hand' || pendingAction.type === 'view_card' || pendingAction.type === 'whisky_reveal') {
        return pendingAction.viewerPlayerId === member.playerId;
      }
      if (pendingAction.type === 'show_hand_confirm') {
        return pendingAction.playerId === member.playerId;
      }
      return currentId === member.playerId;
    case 'END_TURN':
      return currentId === member.playerId && room.game.step === 'end_turn';
    default:
      return currentId === member.playerId;
  }
}

function applyRoomAction(room: Room, member: RoomMember, action: GameAction): string | null {
  if (!room.game || member.playerId === null) {
    return 'Game has not started yet.';
  }

  if (!allowedToDispatch(room, member, action)) {
    return 'It is not your turn for this action.';
  }

  // Capture the card being played BEFORE the reducer removes it from the hand
  let playedCardDefId: string | null = null;
  let playedDefenseDefId: string | null = null;
  if (action.type === 'PLAY_CARD') {
    const cur = room.game.players[room.game.currentPlayerIndex];
    const card = cur?.hand.find(c => c.uid === action.cardUid);
    playedCardDefId = card?.defId ?? null;
  }
  const pendingDefense = room.game.pendingAction?.type === 'trade_defense' ? room.game.pendingAction : null;
  if (action.type === 'PLAY_DEFENSE' && pendingDefense) {
    const defender = room.game.players.find(player => player.id === pendingDefense.defenderId);
    const defenseCard = defender?.hand.find(card => card.uid === action.cardUid);
    playedDefenseDefId = defenseCard?.defId ?? null;
  }

  const prevPA = room.game.pendingAction;
  room.game = gameReducer(room.game, action);

  // Set ephemeral animation overrides based on what just happened
  if (action.type === 'PLAY_DEFENSE' && prevPA?.type === 'trade_defense') {
    if (playedDefenseDefId) {
      if (prevPA.reason === 'trade' || prevPA.reason === 'swap' || prevPA.reason === 'temptation' || prevPA.reason === 'panic_trade') {
        // Show: initiator face-down offer + revealed defense card, then keep a blocked state briefly.
        room.tableAnimOverride = {
          event: {
            type: 'exchange_blocked',
            sceneId: makeSceneId('exchange-blocked', prevPA.reason, prevPA.fromId, prevPA.defenderId, action.cardUid),
            initiatorId: prevPA.fromId,
            targetId: prevPA.defenderId,
            mode: prevPA.reason === 'panic_trade' ? 'panic_trade' : prevPA.reason,
            defenseCardDefId: playedDefenseDefId,
          },
          expiresAt: Date.now() + 3200,
        };
      } else {
        // Flamethrower / analysis defense — just show the defense card face-up
        room.tableAnimOverride = {
          event: { type: 'card', sceneId: makeSceneId('defense-card', action.cardUid), cardDefId: playedDefenseDefId },
          expiresAt: Date.now() + 2500,
        };
      }
    }
  } else if (action.type === 'RESPOND_TRADE' && prevPA?.type === 'trade_defense' && prevPA.reason === 'trade') {
    // Defender accepted — show both cards in the centre, then animate them to the opposite owners.
    room.tableAnimOverride = {
      event: {
        type: 'exchange_ready',
        sceneId: makeSceneId('exchange-ready', prevPA.reason, prevPA.fromId, prevPA.defenderId, prevPA.offeredCardUid, action.cardUid),
        initiatorId: prevPA.fromId,
        targetId: prevPA.defenderId,
        mode: 'trade',
      },
      expiresAt: Date.now() + 3000,
    };
  } else if (
    action.type === 'TEMPTATION_RESPOND' &&
    (
      prevPA?.type === 'temptation_response' ||
      (prevPA?.type === 'trade_defense' && prevPA.reason === 'temptation')
    )
  ) {
    const fromId = prevPA.fromId;
    const targetId = prevPA.type === 'trade_defense' ? prevPA.defenderId : prevPA.toId;
    const offeredCardUid = prevPA.offeredCardUid;
    room.tableAnimOverride = {
      event: {
        type: 'exchange_ready',
        sceneId: makeSceneId('temptation-ready', fromId, targetId, offeredCardUid, action.cardUid),
        initiatorId: fromId,
        targetId: targetId,
        mode: 'temptation',
      },
      expiresAt: Date.now() + 3000,
    };
  } else if (
    action.type === 'PANIC_TRADE_RESPOND' &&
    (
      prevPA?.type === 'panic_trade_response' ||
      (prevPA?.type === 'trade_defense' && prevPA.reason === 'panic_trade')
    )
  ) {
    const fromId = prevPA.type === 'trade_defense' ? prevPA.fromId : prevPA.fromId;
    const targetId = prevPA.type === 'trade_defense' ? prevPA.defenderId : prevPA.toId;
    const offeredCardUid = prevPA.type === 'trade_defense' ? prevPA.offeredCardUid : prevPA.offeredCardUid;
    room.tableAnimOverride = {
      event: {
        type: 'exchange_ready',
        sceneId: makeSceneId('panic-ready', fromId, targetId, offeredCardUid, action.cardUid),
        initiatorId: fromId,
        targetId: targetId,
        mode: 'panic_trade',
      },
      expiresAt: Date.now() + 3000,
    };
  } else if (action.type === 'PLAY_CARD' && playedCardDefId) {
    // Show the played card face-up in centre for all players to see (~2.5 s)
    room.tableAnimOverride = {
      event: { type: 'card', sceneId: makeSceneId('played-card', action.cardUid, playedCardDefId), cardDefId: playedCardDefId },
      expiresAt: Date.now() + 2500,
    };
  } else if (action.type === 'SELECT_TARGET' || action.type === 'PANIC_SELECT_TARGET') {
    // Resolves target selection — keep whatever card override was set by the preceding PLAY_CARD
  } else {
    // Only clear the override if it has already expired naturally.
    // This prevents actions by OTHER players (e.g. DRAW_CARD on the next turn)
    // from wiping the animation mid-display.
    if (!room.tableAnimOverride || room.tableAnimOverride.expiresAt <= Date.now()) {
      room.tableAnimOverride = null;
    }
  }

  // Record game results when the game just ended
  if (room.game.phase === 'game_over' && room.game.winner !== null) {
    void recordRoomResults(room); // fire-and-forget async
  }

  touchRoom(room);
  return null;
}

async function recordRoomResults(room: Room): Promise<void> {
  if (!room.game || room.game.winner === null) return;

  const { winnerPlayerIds, players } = room.game;

  // Collect logged-in human players (not bots, not spectators)
  const loggedIn = room.members.filter(m => m.userId !== null && m.playerId !== null && !m.isBot);
  if (loggedIn.length === 0) return;

  // Fetch all users in parallel
  const fetchedUsers = await Promise.all(loggedIn.map(m => getUserById(m.userId!)));
  const userMap = new Map(loggedIn.map((m, i) => [m.userId!, fetchedUsers[i]]));

  const winnerUsers = loggedIn.filter(m => winnerPlayerIds.includes(m.playerId!));
  const loserUsers  = loggedIn.filter(m => !winnerPlayerIds.includes(m.playerId!));

  const avgWinnerElo = winnerUsers.length
    ? winnerUsers.reduce((sum, m) => sum + (userMap.get(m.userId!)?.elo ?? 1000), 0) / winnerUsers.length
    : 1000;
  const avgLoserElo = loserUsers.length
    ? loserUsers.reduce((sum, m) => sum + (userMap.get(m.userId!)?.elo ?? 1000), 0) / loserUsers.length
    : 1000;

  const playerCount = players.length;

  await Promise.all(loggedIn.map(async member => {
    const user = userMap.get(member.userId!);
    if (!user) return;

    const gamePlayer = players.find(p => p.id === member.playerId);
    if (!gamePlayer) return;

    const won = winnerPlayerIds.includes(member.playerId!);
    const opponentAvgElo = won ? avgLoserElo : avgWinnerElo;
    const newElo = calcElo(user.elo, opponentAvgElo, won);

    await Promise.all([
      updateUserElo(user.id, newElo),
      recordGameResult({
        userId: user.id,
        roomCode: room.code,
        role: gamePlayer.role ?? 'human',
        result: won ? 'win' : 'loss',
        playerCount,
        eloBefore: user.elo,
        eloAfter: newElo,
      }),
    ]);

    // Update cached stats so next roomView shows new ELO immediately
    member.cachedStats = { elo: newElo, winRate: 0, gamesPlayed: 0 };
    void refreshMemberStats(member); // refresh full stats in background
  }));
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
  '.json': 'application/json; charset=utf-8',
};

// Types worth compressing with gzip
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json']);

function getCacheControl(urlPath: string): string {
  // Vite hashes /assets/* filenames — safe to cache forever
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  // Large static resources — cache for 1 day
  if (urlPath.startsWith('/music/') || urlPath.startsWith('/cards/') || urlPath.startsWith('/shouts/')) {
    return 'public, max-age=86400';
  }
  // index.html — revalidate on every load so users get fresh deploys
  if (urlPath === '/' || urlPath.endsWith('.html')) return 'public, max-age=0, must-revalidate';
  // Everything else — 1 hour
  return 'public, max-age=3600';
}

async function serveStatic(
  req: HttpRequest,
  res: HttpResponse,
): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const rawPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const requestedPath = decodeURIComponent(rawPath);
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[\\/])+/, '');
  const filePath = path.join(distDir, normalizedPath);

  const sendFile = async (filePath: string, urlPath: string): Promise<void> => {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
    const shouldCompress = acceptsGzip && COMPRESSIBLE.has(ext);

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', getCacheControl(urlPath));
    res.setHeader('Vary', 'Accept-Encoding');

    if (shouldCompress) {
      res.setHeader('Content-Encoding', 'gzip');
      const gzip = createGzip({ level: 6 });
      gzip.pipe(res);
      gzip.end(body);
    } else {
      res.end(body);
    }
  };

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) return false;
    await sendFile(filePath, requestUrl.pathname);
    return true;
  } catch {
    try {
      await sendFile(path.join(distDir, 'index.html'), '/index.html');
      return true;
    } catch {
      return false;
    }
  }
}

// Clean up stale rooms every 5 minutes instead of on every request
setInterval(cleanupRooms, 5 * 60 * 1000);
const wsServer = new WebSocketServer({ noServer: true });

const server = createServer(async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = requestUrl.pathname;

  if (!pathname.startsWith('/api/')) {
    if (await serveStatic(req, res)) {
      return;
    }

    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  try {
    // ── Auth endpoints ────────────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await readBody<{ username: string; password: string }>(req);
      const username = (body.username ?? '').trim();
      const password = body.password ?? '';
      if (!username || username.length < 2 || username.length > 24) { badRequest(res, 'Username must be 2–24 characters.'); return; }
      if (!/^[a-zA-Z0-9_\-]+$/.test(username)) { badRequest(res, 'Username can only contain letters, numbers, _ and -.'); return; }
      if (!password || password.length < 4) { badRequest(res, 'Password must be at least 4 characters.'); return; }
      if (await getUserByName(username)) { badRequest(res, 'Username already taken.'); return; }
      const user = await createUser(username, hashPassword(password));
      const token = signToken(user.id);
      sendJson(res, 200, { ok: true, data: { token, userId: user.id, username: user.username, elo: user.elo } });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody<{ username: string; password: string }>(req);
      const user = await getUserByName((body.username ?? '').trim());
      if (!user || !verifyPassword(body.password ?? '', user.password_hash)) { badRequest(res, 'Invalid username or password.'); return; }
      const token = signToken(user.id);
      sendJson(res, 200, { ok: true, data: { token, userId: user.id, username: user.username, elo: user.elo } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const token = (req.headers['authorization'] ?? '').replace('Bearer ', '');
      const payload = verifyToken(token);
      if (!payload) { sendJson(res, 401, { ok: false, error: 'Unauthorized' }); return; }
      const user = await getUserById(payload.userId);
      if (!user) { sendJson(res, 401, { ok: false, error: 'User not found' }); return; }
      sendJson(res, 200, { ok: true, data: { userId: user.id, username: user.username, elo: user.elo } });
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/users/')) {
      const username = decodeURIComponent(pathname.slice('/api/users/'.length).replace(/\/stats$/, ''));
      const user = await getUserByName(username);
      if (!user) { sendJson(res, 404, { ok: false, error: 'User not found' }); return; }
      sendJson(res, 200, { ok: true, data: await getUserStats(user.id, user.elo) });
      return;
    }
    // ── End auth endpoints ────────────────────────────────────────────────────

    if (req.method === 'POST' && pathname === '/api/rooms/create') {
      const body = await readBody<CreateRoomPayload & { token?: string }>(req);
      const name = trimName(body.name);
      const authPayload = body.token ? verifyToken(body.token) : null;
      const userId = authPayload ? authPayload.userId : null;

      if (!name) {
        badRequest(res, 'Name is required.');
        return;
      }

      const hostMember: RoomMember = {
        sessionId: randomId(8),
        name,
        isHost: true,
        isBot: false,
        isSpectator: false,
        userId,
        playerId: null,
        connected: true,
        joinedAt: now(),
        lastSeenAt: now(),
        cachedStats: null,
      };
      if (userId) void refreshMemberStats(hostMember);

      const room: Room = {
        code: randomRoomCode(),
        members: [hostMember],
        game: null,
        updatedAt: now(),
        shouts: [],
      };

      rooms.set(room.code, room);
      saveRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, room.members[0], req) });
      return;
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|start|action|reset|leave|shout|add-bot|remove-bot|remove-member))?$/i);
    if (!roomMatch) {
      notFound(res);
      return;
    }

    const [, rawCode, actionSegment] = roomMatch;
    const room = getRoom(rawCode);

    if (!room) {
      notFound(res, 'Room not found.');
      return;
    }

    if (req.method === 'GET' && !actionSegment) {
      const sessionId = requestUrl.searchParams.get('sessionId') ?? '';
      const member = getMember(room, sessionId);
      if (!member) { sendSessionError(res, room.code, sessionId, 'Session not found for this room.'); return; }

      member.connected = true;
      member.lastSeenAt = now();
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      return;
    }

    if (req.method === 'POST' && actionSegment === 'join') {
      const body = await readBody<CreateRoomPayload & { spectator?: boolean; token?: string }>(req);
      const name = trimName(body.name);
      const wantsSpectator = body.spectator === true;
      const authPayload = body.token ? verifyToken(body.token) : null;
      const userId = authPayload ? authPayload.userId : null;

      if (!name) {
        badRequest(res, 'Name is required.');
        return;
      }

      if (room.game && !wantsSpectator) {
        badRequest(res, 'This room already started a game.');
        return;
      }

      // Spectators don't count toward the player limit (separate cap of 20 observers)
      const nonSpectatorCount = room.members.filter(m => !m.isSpectator).length;
      if (!wantsSpectator && nonSpectatorCount >= 12) {
        badRequest(res, 'Room is full.');
        return;
      }

      const member: RoomMember = {
        sessionId: randomId(8),
        name,
        isHost: false,
        isBot: false,
        isSpectator: wantsSpectator,
        userId,
        playerId: null,
        connected: true,
        joinedAt: now(),
        lastSeenAt: now(),
        cachedStats: null,
      };
      if (userId) void refreshMemberStats(member);

      room.members.push(member);
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      return;
    }

    if (req.method !== 'POST' || !actionSegment) {
      notFound(res);
      return;
    }

    if (actionSegment === 'start') {
      const body = await readBody<RoomSessionPayload & { thingInDeck?: boolean; chaosMode?: boolean }>(req);
      const member = getMember(room, body.sessionId);

      if (!member) { sendSessionError(res, room.code, body.sessionId); return; }

      if (!member.isHost) {
        badRequest(res, 'Only the host can start the game.');
        return;
      }

      if (room.members.length < 4) {
        badRequest(res, 'At least 4 players are required.');
        return;
      }

      if (room.members.length > 12) {
        badRequest(res, 'Maximum 12 players are allowed.');
        return;
      }

      startRoomGame(room, body.thingInDeck, body.chaosMode);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      // Kick off bot turns if the first player is a bot
      scheduleBotTurn(room);
      return;
    }

    if (actionSegment === 'reset') {
      const body = await readBody<RoomSessionPayload>(req);
      const member = getMember(room, body.sessionId);

      if (!member) { sendSessionError(res, room.code, body.sessionId); return; }

      if (!member.isHost) {
        badRequest(res, 'Only the host can reset the room.');
        return;
      }

      resetRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      return;
    }

    if (actionSegment === 'leave') {
      const body = await readBody<RoomSessionPayload>(req);
      const member = getMember(room, body.sessionId);

      if (!member) { sendSessionError(res, room.code, body.sessionId); return; }

      closeRoomSocketSession(room.code, member.sessionId);

      if (room.game && !member.isSpectator && member.playerId !== null) {
        member.connected = false;
        member.lastSeenAt = now();
        touchRoom(room);
        sendJson(res, 200, { ok: true, data: { left: true, roomDeleted: false } });
        broadcastRoom(room);
        return;
      }

      const idx = room.members.findIndex(m => m.sessionId === member.sessionId);
      if (idx !== -1) {
        room.members.splice(idx, 1);
      }

      if (!room.game && member.isHost && room.members.length > 0) {
        room.members[0].isHost = true;
      }

      if (room.members.length === 0) {
        const botTimer = botTurnTimers.get(room.code);
        if (botTimer) {
          clearTimeout(botTimer);
          botTurnTimers.delete(room.code);
        }
        rooms.delete(room.code);
        deleteRoom(room.code);
        clearRoomMemory(room.code);
        roomSockets.delete(room.code);
        sendJson(res, 200, { ok: true, data: { left: true, roomDeleted: true } });
        return;
      }

      touchRoom(room);
      sendJson(res, 200, { ok: true, data: { left: true, roomDeleted: false } });
      broadcastRoom(room);
      return;
    }

    if (actionSegment === 'action') {
      const body = await readBody<RoomActionPayload>(req);
      const member = getMember(room, body.sessionId);

      if (!member) { sendSessionError(res, room.code, body.sessionId); return; }
      if (member.isSpectator) { badRequest(res, 'Spectators cannot perform game actions.'); return; }
      if (!checkRateLimit(body.sessionId)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Too many actions. Please slow down.' }));
        return;
      }

      const error = applyRoomAction(room, member, body.action);
      if (error) {
        badRequest(res, error);
        return;
      }

      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      // After any human action, check if a bot needs to respond
      scheduleBotTurn(room);
      return;
    }

    if (actionSegment === 'add-bot') {
      const body = await readBody<RoomSessionPayload>(req);
      const member = getMember(room, body.sessionId);
      if (!member) { sendSessionError(res, room.code, body.sessionId); return; }
      if (!member.isHost) { badRequest(res, 'Only the host can add bots.'); return; }
      if (room.game) { badRequest(res, 'Cannot add bots during a game.'); return; }
      if (room.members.length >= 12) { badRequest(res, 'Room is full.'); return; }

      const usedNames = new Set(room.members.map(m => m.name));
      const botName = BOT_NAMES.find(n => !usedNames.has(n)) ?? `Бот ${room.members.length + 1} 🤖`;

      const bot: RoomMember = {
        sessionId: `bot-${randomId(6)}`,
        name: botName,
        isHost: false,
        isBot: true,
        isSpectator: false,
        userId: null,
        playerId: null,
        connected: true,
        joinedAt: now(),
        lastSeenAt: now(),
        cachedStats: null,
      };
      room.members.push(bot);
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      return;
    }

    if (actionSegment === 'remove-member' || actionSegment === 'remove-bot') {
      const body = await readBody<RoomSessionPayload & { memberSessionId?: string; botSessionId?: string }>(req);
      const member = getMember(room, body.sessionId);
      if (!member) { sendSessionError(res, room.code, body.sessionId); return; }
      if (!member.isHost) { badRequest(res, 'Only the host can remove members.'); return; }
      if (room.game) { badRequest(res, 'Cannot remove members during a game.'); return; }

      const targetSessionId = body.memberSessionId ?? body.botSessionId ?? '';
      const idx = room.members.findIndex(m => m.sessionId === targetSessionId);
      if (idx === -1) { badRequest(res, 'Member not found.'); return; }

      const target = room.members[idx];
      if (target.isHost) { badRequest(res, 'The host cannot be removed.'); return; }

      room.members.splice(idx, 1);
      markSessionKicked(room.code, target.sessionId);
      closeRoomSocketSession(room.code, target.sessionId);
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      return;
    }

    if (actionSegment === 'shout') {
      const body = await readBody<ShoutPayload>(req);
      const member = getMember(room, body.sessionId);
      if (!member || member.playerId === null) { sendSessionError(res, room.code, body.sessionId); return; }
      room.shouts = (room.shouts ?? []).filter(s => s.playerId !== member.playerId);
      room.shouts.push({ playerId: member.playerId, phrase: body.phrase, phraseEn: body.phraseEn, expiresAt: now() + 5000 });
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room);
      return;
    }

    notFound(res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/** Relay a voice signaling message to a specific session's socket */
function relayVoiceTo(room: Room, targetSessionId: string, payload: unknown): void {
  const sockets = roomSockets.get(room.code);
  if (!sockets) return;
  const json = JSON.stringify(payload);
  for (const s of sockets) {
    if (s.sessionId === targetSessionId && s.readyState === WebSocket.OPEN) {
      s.send(json);
      break;
    }
  }
}

/** Broadcast a voice signaling message to all sockets in the room except the sender */
function broadcastVoice(room: Room, payload: unknown, excludeSessionId: string): void {
  const sockets = roomSockets.get(room.code);
  if (!sockets) return;
  const json = JSON.stringify(payload);
  for (const s of sockets) {
    if (s.sessionId !== excludeSessionId && s.readyState === WebSocket.OPEN) {
      s.send(json);
    }
  }
}

/** Handle voice WebRTC signaling messages from a client */
function handleVoiceMessage(
  room: Room,
  fromSessionId: string,
  fromName: string,
  msg: Record<string, unknown>,
): void {
  const type = msg.type as string;
  switch (type) {
    case 'voice:join':
      broadcastVoice(room, { type: 'voice:join', from: fromSessionId, name: fromName }, fromSessionId);
      break;
    case 'voice:leave':
      broadcastVoice(room, { type: 'voice:leave', from: fromSessionId }, fromSessionId);
      break;
    case 'voice:offer':
    case 'voice:answer':
    case 'voice:ice': {
      const to = msg.to;
      if (typeof to !== 'string') break;
      const relay: Record<string, unknown> = { type, from: fromSessionId };
      if (type === 'voice:offer') relay.offer = msg.offer;
      else if (type === 'voice:answer') relay.answer = msg.answer;
      else relay.candidate = msg.candidate;
      relayVoiceTo(room, to, relay);
      break;
    }
  }
}

wsServer.on('connection', (socket: RoomSocket, req: IncomingMessage) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = requestUrl.pathname;
  const match = pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/ws$/i);
  const roomCode = match?.[1]?.toUpperCase() ?? '';
  const sessionId = requestUrl.searchParams.get('sessionId') ?? '';
  const room = getRoom(roomCode);

  if (!room) {
    socket.send(JSON.stringify({ ok: false, error: 'Room not found.' }));
    socket.close(4404, 'Room not found');
    return;
  }

  const member = getMember(room, sessionId);
  if (!member) {
    socket.send(JSON.stringify({ ok: false, error: isSessionKicked(room.code, sessionId) ? KICKED_BY_HOST_ERROR : 'Session not found.' }));
    socket.close(4403, 'Session not found');
    return;
  }

  socket.roomCode = room.code;
  socket.sessionId = sessionId;
  socket.isAlive = true;

  member.connected = true;
  member.lastSeenAt = now();
  touchRoom(room);

  if (!roomSockets.has(room.code)) {
    roomSockets.set(room.code, new Set());
  }
  roomSockets.get(room.code)!.add(socket);

  socket.send(JSON.stringify({ ok: true, data: roomView(room, member, req) }));
  broadcastRoom(room);

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (data) => {
    member.lastSeenAt = now();
    try {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      if (typeof msg.type === 'string' && msg.type.startsWith('voice:')) {
        handleVoiceMessage(room, sessionId, member.name, msg);
      }
    } catch {
      // Ignore malformed frames
    }
  });

  socket.on('close', () => {
    const sockets = roomSockets.get(room.code);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        roomSockets.delete(room.code);
      }
    }

    member.connected = false;
    member.lastSeenAt = now();
    touchRoom(room);
    broadcastRoom(room);
  });
});

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = requestUrl.pathname;
  if (!pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/ws$/i)) {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wsServer.emit('connection', ws, req);
  });
});

const wsHeartbeat = setInterval(() => {
  for (const sockets of roomSockets.values()) {
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }
}, 30_000);

server.on('close', () => {
  clearInterval(wsHeartbeat);
  wsServer.close();
});

server.listen(port, host, () => {
  console.log(`Нечто multiplayer server listening on http://${host}:${port}`);
});
