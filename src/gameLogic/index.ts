import type {
  GameState, GameAction,
} from '../types.ts';
import { allowsActionForPendingAction } from '../pendingActionGuards.ts';
import { resetCounters } from './utils.ts';
import {
  handleSetLang,
  handleStartGame,
  handleRevealNext,
  handleDrawCard,
  handleDiscardCard,
  handlePlayCard,
  handleSelectTarget,
  handleSuspicionConfirmCard,
  handleSuspicionPreviewCard,
  handleOfferTrade,
  handleRespondTrade,
  handlePlayDefense,
  handleDeclineDefense,
  handleEndTurn,
  handleConfirmView,
  handlePersistencePick,
  handleDeclareVictory,
  handleTemptationSelect,
  handleTemptationRespond,
  handlePartyPassCard,
  handleJustBetweenUsSelect,
  handleJustBetweenUsPick,
  handlePanicSelectTarget,
  handleBlindDatePick,
  handleForgetfulDiscardPick,
  handlePanicTradeSelect,
  handlePanicTradeRespond,
  handleRevelationsRespond,
} from './actionHandlers.ts';

// ── Re-exports (public API) ─────────────────────────────────────────────────

export { getAdjacentPositions, hasDoorBetween, getPlayer, playerAtPosition, currentPlayer } from './helpers.ts';
export { getValidTargets, canPlayCard, canDiscardCard, canTradeCard } from './validation.ts';

// ── State Synchronizer ──────────────────────────────────────────────────────

/**
 * Ensures player roles are consistent with their hand contents.
 * If a player holds "the_thing" card, their role MUST be "thing".
 * This prevents desync bugs (e.g. drawing The Thing from deck but staying "human").
 */
function syncPlayerRoles(s: GameState): void {
  for (const player of s.players) {
    if (!player.isAlive) continue;

    const hasTheThing = player.hand.some(c => c.defId === 'the_thing');

    if (hasTheThing && player.role !== 'thing') {
      player.role = 'thing';
    }
  }
}

// ── Initial State ───────────────────────────────────────────────────────────

export function createInitialState(): GameState {
  resetCounters();
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
    reshuffleCount: 0,
    lang: 'ru',
  };
}

// ── Reducer ─────────────────────────────────────────────────────────────────

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (!allowsActionForPendingAction(state.pendingAction, action)) {
    return state;
  }

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

  const result = applyAction(s, state, action);

  // Always sync roles after every action to prevent desync bugs
  syncPlayerRoles(result);

  return result;
}

function applyAction(s: GameState, originalState: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_LANG':
      return handleSetLang(s, originalState, action);
    case 'START_GAME':
      return handleStartGame(s, originalState, action);
    case 'REVEAL_NEXT':
      return handleRevealNext(s, originalState, action);
    case 'DRAW_CARD':
      return handleDrawCard(s, originalState, action);
    case 'DISCARD_CARD':
      return handleDiscardCard(s, originalState, action);
    case 'PLAY_CARD':
      return handlePlayCard(s, originalState, action, gameReducer);
    case 'SELECT_TARGET':
      return handleSelectTarget(s, originalState, action, gameReducer);
    case 'SUSPICION_PREVIEW_CARD':
      return handleSuspicionPreviewCard(s, originalState, action);
    case 'SUSPICION_CONFIRM_CARD':
      return handleSuspicionConfirmCard(s, originalState, action);
    case 'OFFER_TRADE':
      return handleOfferTrade(s, originalState, action);
    case 'RESPOND_TRADE':
      return handleRespondTrade(s, originalState, action);
    case 'PLAY_DEFENSE':
      return handlePlayDefense(s, originalState, action);
    case 'DECLINE_DEFENSE':
      return handleDeclineDefense(s, originalState, action);
    case 'END_TURN':
      return handleEndTurn(s, originalState, action);
    case 'CONFIRM_VIEW':
      return handleConfirmView(s, originalState, action);
    case 'PERSISTENCE_PICK':
      return handlePersistencePick(s, originalState, action);
    case 'DECLARE_VICTORY':
      return handleDeclareVictory(s, originalState, action);
    case 'TEMPTATION_SELECT':
      return handleTemptationSelect(s, originalState, action);
    case 'TEMPTATION_RESPOND':
      return handleTemptationRespond(s, originalState, action);
    case 'PARTY_PASS_CARD':
      return handlePartyPassCard(s, originalState, action);
    case 'JUST_BETWEEN_US_SELECT':
      return handleJustBetweenUsSelect(s, originalState, action);
    case 'JUST_BETWEEN_US_PICK':
      return handleJustBetweenUsPick(s, originalState, action);
    case 'PANIC_SELECT_TARGET':
      return handlePanicSelectTarget(s, originalState, action);
    case 'BLIND_DATE_PICK':
      return handleBlindDatePick(s, originalState, action);
    case 'FORGETFUL_DISCARD_PICK':
      return handleForgetfulDiscardPick(s, originalState, action);
    case 'PANIC_TRADE_SELECT':
      return handlePanicTradeSelect(s, originalState, action);
    case 'PANIC_TRADE_RESPOND':
      return handlePanicTradeRespond(s, originalState, action);
    case 'REVELATIONS_RESPOND':
      return handleRevelationsRespond(s, originalState, action);
    default:
      return s;
  }
}
