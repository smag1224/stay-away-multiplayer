import type { GameAction, PendingAction } from './types.ts';

export function allowsActionForPendingAction(
  pendingAction: PendingAction | null | undefined,
  action: GameAction,
): boolean {
  if (!pendingAction) {
    return true;
  }

  switch (action.type) {
    case 'SET_LANG':
      return true;
    case 'SELECT_TARGET':
      return pendingAction.type === 'choose_target';
    case 'DISCARD_CARD':
      return pendingAction.type === 'choose_card_to_discard';
    case 'PERSISTENCE_PICK':
      return pendingAction.type === 'persistence_pick';
    case 'TEMPTATION_SELECT':
      return pendingAction.type === 'choose_card_to_give';
    case 'SUSPICION_PREVIEW_CARD':
    case 'SUSPICION_CONFIRM_CARD':
      return pendingAction.type === 'suspicion_pick';
    case 'RESPOND_TRADE':
      return pendingAction.type === 'trade_defense' && pendingAction.reason === 'trade';
    case 'PLAY_DEFENSE':
      return pendingAction.type === 'trade_defense';
    case 'DECLINE_DEFENSE':
      return pendingAction.type === 'trade_defense' &&
        ['flamethrower', 'analysis', 'swap'].includes(pendingAction.reason);
    case 'CONFIRM_VIEW':
      return pendingAction.type === 'view_hand' ||
        pendingAction.type === 'view_card' ||
        pendingAction.type === 'whisky_reveal' ||
        pendingAction.type === 'show_hand_confirm';
    case 'PARTY_PASS_CARD':
      return pendingAction.type === 'party_pass';
    case 'TEMPTATION_RESPOND':
      return pendingAction.type === 'temptation_response' ||
        (pendingAction.type === 'trade_defense' && pendingAction.reason === 'temptation');
    case 'JUST_BETWEEN_US_SELECT':
      return pendingAction.type === 'just_between_us';
    case 'JUST_BETWEEN_US_PICK':
      return pendingAction.type === 'just_between_us_pick';
    case 'PANIC_SELECT_TARGET':
      return pendingAction.type === 'panic_choose_target';
    case 'BLIND_DATE_PICK':
      return pendingAction.type === 'blind_date_swap';
    case 'FORGETFUL_DISCARD_PICK':
      return pendingAction.type === 'forgetful_discard';
    case 'PANIC_TRADE_SELECT':
      return pendingAction.type === 'panic_trade';
    case 'PANIC_TRADE_RESPOND':
      return pendingAction.type === 'panic_trade_response';
    case 'REVELATIONS_RESPOND':
      return pendingAction.type === 'revelations_round';
    default:
      return false;
  }
}
