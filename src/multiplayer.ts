import type { GameAction, GameState, Role } from './types.ts';

export interface SessionInfo {
  roomCode: string;
  sessionId: string;
}

export interface RoomMemberView {
  sessionId: string;
  name: string;
  isHost: boolean;
  playerId: number | null;
  connected: boolean;
  joinedAt: number;
}

export interface ViewerPlayerState {
  id: number;
  name: string;
  role: Role | null;
  hand: GameState['players'][number]['hand'];
  handCount: number;
  isAlive: boolean;
  inQuarantine: boolean;
  quarantineTurnsLeft: number;
  position: number;
}

export interface ViewerGameState extends Omit<GameState, 'players' | 'pendingAction' | 'lang'> {
  players: ViewerPlayerState[];
  pendingAction: GameState['pendingAction'];
}

export interface RoomView {
  code: string;
  me: {
    sessionId: string;
    name: string;
    isHost: boolean;
    playerId: number | null;
  };
  members: RoomMemberView[];
  game: ViewerGameState | null;
  hostAddress: string;
  updatedAt: number;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface JoinRoomPayload {
  name: string;
}

export interface CreateRoomPayload extends JoinRoomPayload {}

export interface RoomActionPayload {
  sessionId: string;
  action: GameAction;
}

export interface RoomSessionPayload {
  sessionId: string;
}
