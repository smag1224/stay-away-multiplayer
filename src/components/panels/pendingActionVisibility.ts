import type { PendingAction } from '../../types.ts';

export function hasRenderablePendingActionPanel(
  pending: PendingAction | null | undefined,
  meId: number,
) {
  if (!pending) return false;

  return (
    pending.type === 'choose_target' ||
    pending.type === 'choose_card_to_discard' ||
    pending.type === 'persistence_pick' ||
    pending.type === 'choose_card_to_give' ||
    (pending.type === 'suspicion_pick' && pending.viewerPlayerId === meId) ||
    pending.type === 'view_hand' ||
    pending.type === 'view_card' ||
    pending.type === 'whisky_reveal' ||
    pending.type === 'trade_defense' ||
    pending.type === 'just_between_us' ||
    pending.type === 'just_between_us_pick' ||
    pending.type === 'party_pass' ||
    pending.type === 'temptation_response' ||
    pending.type === 'panic_choose_target' ||
    pending.type === 'blind_date_swap' ||
    pending.type === 'forgetful_discard' ||
    pending.type === 'panic_trade' ||
    pending.type === 'panic_trade_response' ||
    pending.type === 'revelations_round'
  );
}
