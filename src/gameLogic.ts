// Re-export everything from the new modular gameLogic package.
// This file exists for backward compatibility with existing imports.

export {
  getAdjacentPositions,
  hasDoorBetween,
  getPlayer,
  playerAtPosition,
  currentPlayer,
  createInitialState,
  gameReducer,
} from './gameLogic/index.ts';

export {
  getValidTargets,
  canPlayCard,
  canDiscardCard,
  canTradeCard,
} from './gameLogic/validation.ts';
