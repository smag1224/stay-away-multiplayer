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
  avatarId: string;
  canReceiveInfectedCardFromMe: boolean;
  hand: GameState['players'][number]['hand'];
  handCount: number;
  isAlive: boolean;
  inQuarantine: boolean;
  quarantineTurnsLeft: number;
  position: number;
}

/** Lightweight public event sent to ALL players — used only for table animations, no private card data */
export type TableAnimEvent =
  /** Exchange negotiation is active: the initiator's face-down card is already in the centre */
  | {
      type: 'exchange_pending';
      sceneId: string;
      initiatorId: number;
      targetId: number;
      mode: 'trade' | 'swap' | 'temptation' | 'panic_trade';
    }
  /** Exchange was blocked by a visible defense card */
  | {
      type: 'exchange_blocked';
      sceneId: string;
      initiatorId: number;
      targetId: number;
      mode: 'trade' | 'swap' | 'temptation';
      defenseCardDefId: string;
    }
  /** Both hidden exchange cards are ready in the centre and should animate to new owners */
  | {
      type: 'exchange_ready';
      sceneId: string;
      initiatorId: number;
      targetId: number;
      mode: 'trade' | 'swap' | 'temptation' | 'panic_trade';
    }
  /** A card being played that targets someone, or a non-trade defense (face-up in centre) */
  | { type: 'card'; sceneId: string; cardDefId: string };

export interface ViewerGameState extends Omit<GameState, 'players' | 'pendingAction' | 'lang'> {
  players: ViewerPlayerState[];
  pendingAction: GameState['pendingAction'];
  /** Public animation hint visible to every player at the table */
  tableAnim: TableAnimEvent | null;
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

export type CreateRoomPayload = JoinRoomPayload;

export interface RoomActionPayload {
  sessionId: string;
  action: GameAction;
}

export interface RoomSessionPayload {
  sessionId: string;
}
