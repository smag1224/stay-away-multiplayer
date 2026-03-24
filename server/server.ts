import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

type RoomMember = {
  sessionId: string;
  name: string;
  isHost: boolean;
  playerId: number | null;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const rooms = new Map<string, Room>();

// SSE subscribers: roomCode → Set of { res, sessionId }
type SseClient = { res: ServerResponse<IncomingMessage>; sessionId: string };
const sseClients = new Map<string, Set<SseClient>>();

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

function trimName(name: string | undefined): string {
  return (name ?? '').trim().slice(0, 20);
}

function createHostAddress(req: HttpRequest): string {
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
    hand: player.id === viewerId ? [...player.hand] : [],
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

function sanitizeGame(game: GameState, viewerId: number | null, room: Room): import('../src/multiplayer.ts').ViewerGameState {
  const revealRoles = game.phase === 'game_over';
  const viewer = viewerId === null ? null : game.players.find((player) => player.id === viewerId) ?? null;

  return {
    ...game,
    players: game.players.map((player) => clonePlayerForViewer(player, viewer, viewerId, revealRoles)),
    pendingAction: sanitizePendingAction(game.pendingAction, game, viewerId),
    tableAnim: buildTableAnim(game, room),
  };
}

function roomView(room: Room, member: RoomMember, req: HttpRequest): RoomView {
  return {
    code: room.code,
    me: {
      sessionId: member.sessionId,
      name: member.name,
      isHost: member.isHost,
      playerId: member.playerId,
    },
    members: room.members.map((roomMember) => ({
      sessionId: roomMember.sessionId,
      name: roomMember.name,
      isHost: roomMember.isHost,
      playerId: roomMember.playerId,
      connected: roomMember.connected,
      joinedAt: roomMember.joinedAt,
    })),
    game: room.game ? sanitizeGame(room.game, member.playerId, room) : null,
    hostAddress: createHostAddress(req),
    updatedAt: room.updatedAt,
    shouts: (room.shouts ?? []).filter(s => s.expiresAt > now()),
  };
}

function touchRoom(room: Room): void {
  room.updatedAt = now();
}

/** Push room state to all SSE subscribers for this room */
function broadcastRoom(room: Room, req: HttpRequest): void {
  const clients = sseClients.get(room.code);
  if (!clients || clients.size === 0) return;

  for (const client of clients) {
    const member = getMember(room, client.sessionId);
    if (!member) continue;
    const view = roomView(room, member, req);
    const data = JSON.stringify({ ok: true, data: view });
    client.res.write(`data: ${data}\n\n`);
  }
}

function cleanupRooms(): void {
  const cutoff = now() - 1000 * 60 * 60 * 12;

  for (const [code, room] of rooms.entries()) {
    if (room.updatedAt < cutoff) {
      rooms.delete(code);
      // Close SSE connections for deleted rooms
      const clients = sseClients.get(code);
      if (clients) {
        for (const client of clients) client.res.end();
        sseClients.delete(code);
      }
    }
  }
}

function startRoomGame(room: Room, thingInDeck?: boolean, chaosMode?: boolean): void {
  const playerNames = room.members.map((member) => member.name);
  const game = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames,
    thingInDeck,
    chaosMode,
  });

  if (game.phase === 'role_reveal') {
    game.phase = 'playing';
    game.revealingPlayer = game.players.length - 1;
  }

  room.members.forEach((member, index) => {
    member.playerId = index;
  });
  room.game = game;
  touchRoom(room);
}

function resetRoom(room: Room): void {
  room.game = null;
  room.members.forEach((member) => {
    member.playerId = null;
  });
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

  touchRoom(room);
  return null;
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

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      return false;
    }

    const body = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const contentType = ({
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.json': 'application/json; charset=utf-8',
    } as Record<string, string>)[extension] ?? 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(body);
    return true;
  } catch {
    try {
      const indexFile = await fs.readFile(path.join(distDir, 'index.html'));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(indexFile);
      return true;
    } catch {
      return false;
    }
  }
}

// Clean up stale rooms every 5 minutes instead of on every request
setInterval(cleanupRooms, 5 * 60 * 1000);

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
    if (req.method === 'POST' && pathname === '/api/rooms/create') {
      const body = await readBody<CreateRoomPayload>(req);
      const name = trimName(body.name);

      if (!name) {
        badRequest(res, 'Name is required.');
        return;
      }

      const room: Room = {
        code: randomRoomCode(),
        members: [
          {
            sessionId: randomId(8),
            name,
            isHost: true,
            playerId: null,
            connected: true,
            joinedAt: now(),
            lastSeenAt: now(),
          },
        ],
        game: null,
        updatedAt: now(),
        shouts: [],
      };

      rooms.set(room.code, room);
      sendJson(res, 200, { ok: true, data: roomView(room, room.members[0], req) });
      return;
    }

    // SSE stream endpoint: GET /api/rooms/{CODE}/stream?sessionId=...
    const streamMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/stream$/i);
    if (req.method === 'GET' && streamMatch) {
      const streamRoom = getRoom(streamMatch[1]);
      if (!streamRoom) { notFound(res, 'Room not found.'); return; }
      const sessionId = requestUrl.searchParams.get('sessionId') ?? '';
      const member = getMember(streamRoom, sessionId);
      if (!member) { badRequest(res, 'Session not found.'); return; }

      member.connected = true;
      member.lastSeenAt = now();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Send initial state
      const initial = JSON.stringify({ ok: true, data: roomView(streamRoom, member, req) });
      res.write(`data: ${initial}\n\n`);

      // Register SSE client
      const client: SseClient = { res, sessionId };
      if (!sseClients.has(streamRoom.code)) sseClients.set(streamRoom.code, new Set());
      sseClients.get(streamRoom.code)!.add(client);

      // Keep-alive ping every 30s
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.get(streamRoom.code)?.delete(client);
        member.connected = false;
        member.lastSeenAt = now();
      });
      return;
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|start|action|reset|shout))?$/i);
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

      if (!member) {
        badRequest(res, 'Session not found for this room.');
        return;
      }

      member.connected = true;
      member.lastSeenAt = now();
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      return;
    }

    if (req.method === 'POST' && actionSegment === 'join') {
      const body = await readBody<CreateRoomPayload>(req);
      const name = trimName(body.name);

      if (!name) {
        badRequest(res, 'Name is required.');
        return;
      }

      if (room.game) {
        badRequest(res, 'This room already started a game.');
        return;
      }

      if (room.members.length >= 12) {
        badRequest(res, 'Room is full.');
        return;
      }

      const member: RoomMember = {
        sessionId: randomId(8),
        name,
        isHost: false,
        playerId: null,
        connected: true,
        joinedAt: now(),
        lastSeenAt: now(),
      };

      room.members.push(member);
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room, req);
      return;
    }

    if (req.method !== 'POST' || !actionSegment) {
      notFound(res);
      return;
    }

    if (actionSegment === 'start') {
      const body = await readBody<RoomSessionPayload & { thingInDeck?: boolean; chaosMode?: boolean }>(req);
      const member = getMember(room, body.sessionId);

      if (!member) {
        badRequest(res, 'Session not found.');
        return;
      }

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
      broadcastRoom(room, req);
      return;
    }

    if (actionSegment === 'reset') {
      const body = await readBody<RoomSessionPayload>(req);
      const member = getMember(room, body.sessionId);

      if (!member) {
        badRequest(res, 'Session not found.');
        return;
      }

      if (!member.isHost) {
        badRequest(res, 'Only the host can reset the room.');
        return;
      }

      resetRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room, req);
      return;
    }

    if (actionSegment === 'action') {
      const body = await readBody<RoomActionPayload>(req);
      const member = getMember(room, body.sessionId);

      if (!member) {
        badRequest(res, 'Session not found.');
        return;
      }

      const error = applyRoomAction(room, member, body.action);
      if (error) {
        badRequest(res, error);
        return;
      }

      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room, req);
      return;
    }

    if (actionSegment === 'shout') {
      const body = await readBody<ShoutPayload>(req);
      const member = getMember(room, body.sessionId);
      if (!member || member.playerId === null) {
        badRequest(res, 'Session not found.');
        return;
      }
      room.shouts = (room.shouts ?? []).filter(s => s.playerId !== member.playerId);
      room.shouts.push({ playerId: member.playerId, phrase: body.phrase, phraseEn: body.phraseEn, expiresAt: now() + 5000 });
      touchRoom(room);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
      broadcastRoom(room, req);
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

server.listen(port, host, () => {
  console.log(`Stay Away multiplayer server listening on http://${host}:${port}`);
});
