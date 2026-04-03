import i18n from 'i18next';
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
export const PERFORMANCE_MODE_STORAGE_KEY = 'stay-away-performance-mode';
export const AUTH_TOKEN_KEY = 'stay-away-auth-token';

export function readStoredAuthToken(): string | null {
  try { return window.localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

export function writeStoredAuthToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch { /* ignore */ }
}
const API_TIMEOUT_MS = 8000;

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

export function readStoredPerformanceMode(): boolean {
  return window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY) === '1';
}

export function writeStoredPerformanceMode(enabled: boolean): void {
  if (enabled) {
    window.localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, '1');
    return;
  }

  window.localStorage.removeItem(PERFORMANCE_MODE_STORAGE_KEY);
}

export function text(lang: Lang, ru: string, en: string): string {
  return lang === 'ru' ? ru : en;
}

export async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(input, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(i18n.t('errors.requestTimeout'));
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

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

export function canGiveCard(player: ViewerPlayerState, card: CardInstance): boolean {
  if (card.defId === 'the_thing') return false;
  if (card.defId !== 'infected') return true;

  if (player.role === 'thing') return true;
  if (player.role === 'infected') {
    return player.hand.filter((item) => item.defId === 'infected').length > 1;
  }
  return false;
}

export function canGiveCardToPlayer(
  player: ViewerPlayerState,
  card: CardInstance,
  receiver?: ViewerPlayerState | null,
): boolean {
  if (!canGiveCard(player, card)) return false;
  if (card.defId !== 'infected') return true;
  if (!receiver) return true;
  return receiver.canReceiveInfectedCardFromMe;
}

export function localTradeCheck(player: ViewerPlayerState, card: CardInstance, receiver?: ViewerPlayerState | null): boolean {
  return canGiveCardToPlayer(player, card, receiver);
}

export function getDirectionalNeighbor(
  game: ViewerGameState,
  playerId: number,
  direction: 1 | -1,
): ViewerPlayerState | null {
  const alivePlayers = game.players
    .filter((player) => player.isAlive)
    .sort((left, right) => left.position - right.position);

  if (alivePlayers.length <= 1) return null;

  const currentIndex = alivePlayers.findIndex((player) => player.id === playerId);
  if (currentIndex === -1) return null;

  const targetIndex = (currentIndex + direction + alivePlayers.length) % alivePlayers.length;
  return alivePlayers[targetIndex] ?? null;
}

export function getCurrentPlayer(game: ViewerGameState): ViewerPlayerState | undefined {
  return game.players[game.currentPlayerIndex];
}

export function getViewerPlayer(game: ViewerGameState, playerId: number | null): ViewerPlayerState | null {
  if (playerId === null) return null;
  return game.players.find((player) => player.id === playerId) ?? null;
}

export function roleLabel(role: string | null, _lang?: Lang): string {
  switch (role) {
    case 'human':
      return i18n.t('role.human');
    case 'thing':
      return i18n.t('role.thing');
    case 'infected':
      return i18n.t('role.infected');
    default:
      return i18n.t('role.hidden');
  }
}

export function stepLabel(step: ViewerGameState['step'], _lang?: Lang): string {
  switch (step) {
    case 'draw':
      return i18n.t('step.draw');
    case 'play_or_discard':
      return i18n.t('step.playOrDiscard');
    case 'trade':
      return i18n.t('step.trade');
    case 'trade_response':
      return i18n.t('step.tradeResponse');
    case 'end_turn':
      return i18n.t('step.endTurn');
  }
}

export function actionReasonLabel(reason: 'trade' | 'temptation' | 'flamethrower' | 'swap' | 'analysis' | 'panic_trade', _lang?: Lang): string {
  switch (reason) {
    case 'trade':
      return i18n.t('actionReason.trade');
    case 'temptation':
      return i18n.t('actionReason.temptation');
    case 'flamethrower':
      return i18n.t('actionReason.flamethrower');
    case 'swap':
      return i18n.t('actionReason.swap');
    case 'analysis':
      return i18n.t('actionReason.analysis');
    case 'panic_trade':
      return i18n.t('actionReason.panic_trade');
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
  _lang?: Lang,
): string | null {
  if (!pendingAction) return null;

  switch (pendingAction.type) {
    case 'trade_defense': {
      const defender = game.players.find((player) => player.id === pendingAction.defenderId);
      return i18n.t('pending.tradeDefenseDeciding', {
        name: defender?.name ?? i18n.t('role.hidden'),
        reason: actionReasonLabel(pendingAction.reason),
      });
    }
    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal':
      return i18n.t('pending.privateReveal');
    case 'choose_card_to_discard':
      return i18n.t('pending.chooseCardDiscard');
    case 'persistence_pick':
      return i18n.t('pending.chooseCardKeep');
    case 'just_between_us':
      return i18n.t('pending.chooseAdjacentPlayers');
    case 'axe_choice':
      return i18n.t('pending.chooseAxeEffect');
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

export function cardCategoryLabel(card: CardInstance, _lang?: Lang): string {
  const def = getCardDef(card.defId);
  switch (def.category) {
    case 'infection':
      return i18n.t('category.infection');
    case 'action':
      return i18n.t('category.action');
    case 'defense':
      return i18n.t('category.defense');
    case 'obstacle':
      return i18n.t('category.obstacle');
    case 'panic':
      return i18n.t('category.panic');
    case 'promo':
      return i18n.t('category.promo');
  }
}

export type RoomActionSender = (action: GameAction) => Promise<void>;
export type RoomRefresher = (path: string, body: object) => Promise<void>;
export type RoomState = RoomView | null;
