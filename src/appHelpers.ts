import { getCardDef } from './cards.ts';
import type {
  CardInstance,
  GameAction,
  PendingAction,
} from './types.ts';
import type {
  ApiResponse,
  RoomView,
  SessionInfo,
  ViewerGameState,
  ViewerPlayerState,
} from './multiplayer.ts';

export type Lang = 'en' | 'ru';

export const SESSION_STORAGE_KEY = 'stay-away-multiplayer-session';
export const LANG_STORAGE_KEY = 'stay-away-multiplayer-lang';

export function readStoredSession(): SessionInfo | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SessionInfo;
    if (!parsed.roomCode || !parsed.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: SessionInfo | null): void {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function readStoredLang(): Lang {
  const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
  return raw === 'en' ? 'en' : 'ru';
}

export function writeStoredLang(lang: Lang): void {
  window.localStorage.setItem(LANG_STORAGE_KEY, lang);
}

export function text(lang: Lang, ru: string, en: string): string {
  return lang === 'ru' ? ru : en;
}

export async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const raw = await response.text();
  let payload: ApiResponse<T>;

  try {
    payload = JSON.parse(raw) as ApiResponse<T>;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

export function localTradeCheck(player: ViewerPlayerState, card: CardInstance): boolean {
  if (card.defId === 'the_thing') return false;
  if (card.defId === 'infected') {
    if (player.role === 'thing') return true;
    if (player.role === 'infected') {
      const infectedCount = player.hand.filter((item) => item.defId === 'infected').length;
      return infectedCount > 1;
    }
    return false;
  }
  return true;
}

export function getCurrentPlayer(game: ViewerGameState): ViewerPlayerState {
  return game.players[game.currentPlayerIndex];
}

export function getViewerPlayer(game: ViewerGameState, playerId: number | null): ViewerPlayerState | null {
  if (playerId === null) return null;
  return game.players.find((player) => player.id === playerId) ?? null;
}

export function roleLabel(role: string | null, lang: Lang): string {
  switch (role) {
    case 'human':
      return text(lang, 'Человек', 'Human');
    case 'thing':
      return text(lang, 'Нечто', 'The Thing');
    case 'infected':
      return text(lang, 'Заражённый', 'Infected');
    default:
      return text(lang, 'Скрыто', 'Hidden');
  }
}

export function stepLabel(step: ViewerGameState['step'], lang: Lang): string {
  switch (step) {
    case 'draw':
      return text(lang, 'Возьмите карту', 'Draw a card');
    case 'play_or_discard':
      return text(lang, 'Сыграйте или сбросьте карту', 'Play or discard a card');
    case 'trade':
      return text(lang, 'Обмен с соседом', 'Trade with a neighbor');
    case 'trade_response':
      return text(lang, 'Ожидается ответ на действие', 'Waiting for a response');
    case 'end_turn':
      return text(lang, 'Завершите ход', 'End the turn');
  }
}

export function actionReasonLabel(reason: 'trade' | 'flamethrower' | 'swap' | 'analysis', lang: Lang): string {
  switch (reason) {
    case 'trade':
      return text(lang, 'обмен', 'trade');
    case 'flamethrower':
      return text(lang, 'огнемёт', 'flamethrower');
    case 'swap':
      return text(lang, 'перемещение', 'seat swap');
    case 'analysis':
      return text(lang, 'анализ', 'analysis');
  }
}

export function extractPendingOwner(pendingAction: PendingAction | null): number | null {
  if (!pendingAction) return null;

  switch (pendingAction.type) {
    case 'trade_offer':
      return pendingAction.toId;
    case 'trade_defense':
      return pendingAction.defenderId;
    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal':
      return pendingAction.viewerPlayerId;
    case 'show_hand_confirm':
      return pendingAction.playerId;
    default:
      return null;
  }
}

export function pendingSummary(
  pendingAction: PendingAction | null,
  game: ViewerGameState,
  lang: Lang,
): string | null {
  if (!pendingAction) return null;

  switch (pendingAction.type) {
    case 'trade_defense': {
      const defender = game.players.find((player) => player.id === pendingAction.defenderId);
      return text(
        lang,
        `${defender?.name ?? 'Игрок'} решает, как ответить на ${actionReasonLabel(pendingAction.reason, lang)}.`,
        `${defender?.name ?? 'A player'} is deciding how to respond to the ${actionReasonLabel(pendingAction.reason, lang)}.`,
      );
    }
    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal':
      return text(lang, 'Открыт приватный просмотр карт.', 'A private card reveal is in progress.');
    case 'choose_target':
      return text(lang, 'Нужно выбрать цель.', 'A target must be chosen.');
    case 'choose_card_to_discard':
      return text(lang, 'Нужно выбрать карту для сброса.', 'A card must be discarded.');
    case 'choose_card_to_give':
      return text(lang, 'Нужно выбрать карту для обмена.', 'Choose a card to exchange.');
    case 'persistence_pick':
      return text(lang, 'Нужно выбрать карту, которую оставить.', 'Choose which card to keep.');
    case 'just_between_us':
      return text(lang, 'Нужно выбрать двух соседних игроков для обязательного обмена.', 'Choose two adjacent players for a forced trade.');
    default:
      return null;
  }
}

export function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  return Promise.reject(new Error('Clipboard API unavailable.'));
}

export function cardCategoryLabel(card: CardInstance, lang: Lang): string {
  const def = getCardDef(card.defId);
  switch (def.category) {
    case 'infection':
      return text(lang, 'Заражение', 'Infection');
    case 'action':
      return text(lang, 'Действие', 'Action');
    case 'defense':
      return text(lang, 'Защита', 'Defense');
    case 'obstacle':
      return text(lang, 'Препятствие', 'Obstacle');
    case 'panic':
      return text(lang, 'Паника', 'Panic');
    case 'promo':
      return text(lang, 'Промо', 'Promo');
  }
}

export type RoomActionSender = (action: GameAction) => Promise<void>;
export type RoomRefresher = (path: string, body: object) => Promise<void>;
export type RoomState = RoomView | null;
