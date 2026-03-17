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
  ViewerGameState,
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
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const rooms = new Map<string, Room>();

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

function clonePlayerForViewer(player: Player, viewerId: number | null, revealRoles: boolean): ViewerPlayerState {
  return {
    id: player.id,
    name: player.name,
    role: revealRoles || player.id === viewerId ? player.role : null,
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
    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal':
      return pendingAction.public === true || pendingAction.viewerPlayerId === viewerId;
    case 'show_hand_confirm':
      return pendingAction.playerId === viewerId;
    case 'party_pass':
    case 'panic_effect':
      return currentPlayer(game).id === viewerId;
    case 'just_between_us':
      return currentPlayer(game).id === viewerId;
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

  return clonePendingAction(pendingAction);
}

function sanitizeGame(game: GameState, viewerId: number | null): ViewerGameState {
  const revealRoles = game.phase === 'game_over';

  return {
    ...game,
    players: game.players.map((player) => clonePlayerForViewer(player, viewerId, revealRoles)),
    pendingAction: sanitizePendingAction(game.pendingAction, game, viewerId),
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
    game: room.game ? sanitizeGame(room.game, member.playerId) : null,
    hostAddress: createHostAddress(req),
    updatedAt: room.updatedAt,
  };
}

function touchRoom(room: Room): void {
  room.updatedAt = now();
}

function cleanupRooms(): void {
  const cutoff = now() - 1000 * 60 * 60 * 12;

  for (const [code, room] of rooms.entries()) {
    if (room.updatedAt < cutoff) {
      rooms.delete(code);
    }
  }
}

function startRoomGame(room: Room, thingInDeck?: boolean): void {
  const playerNames = room.members.map((member) => member.name);
  const game = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames,
    thingInDeck,
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

  switch (action.type) {
    case 'SET_LANG':
    case 'START_GAME':
    case 'REVEAL_NEXT':
      return false;
    case 'RESPOND_TRADE':
    case 'PLAY_DEFENSE':
    case 'DECLINE_DEFENSE':
      return pendingAction?.type === 'trade_defense' && pendingAction.defenderId === member.playerId;
    case 'PARTY_PASS_CARD':
      return pendingAction?.type === 'party_pass' &&
        pendingAction.pendingPlayerIds.includes(member.playerId ?? -1) &&
        action.playerId === member.playerId;
    case 'JUST_BETWEEN_US_PICK':
      return pendingAction?.type === 'just_between_us_pick' &&
        (pendingAction.playerA === member.playerId || pendingAction.playerB === member.playerId) &&
        action.playerId === member.playerId;
    case 'TEMPTATION_RESPOND':
      return pendingAction?.type === 'temptation_response' && pendingAction.toId === member.playerId;
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

  room.game = gameReducer(room.game, action);
  touchRoom(room);
  return null;
}

async function serveStatic(
  req: HttpRequest,
  res: HttpResponse,
): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
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

const server = createServer(async (req, res) => {
  cleanupRooms();

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
      };

      rooms.set(room.code, room);
      sendJson(res, 200, { ok: true, data: roomView(room, room.members[0], req) });
      return;
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|start|action|reset))?$/i);
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
      return;
    }

    if (req.method !== 'POST' || !actionSegment) {
      notFound(res);
      return;
    }

    if (actionSegment === 'start') {
      const body = await readBody<RoomSessionPayload & { thingInDeck?: boolean }>(req);
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

      startRoomGame(room, body.thingInDeck);
      sendJson(res, 200, { ok: true, data: roomView(room, member, req) });
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
