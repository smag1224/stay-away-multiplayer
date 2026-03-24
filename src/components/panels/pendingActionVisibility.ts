import type { PendingAction } from '../../types.ts';

export function hasRenderablePendingActionPanel(
  pending: PendingAction | null | undefined,
  _meId: number,
) {
  if (!pending) return false;

  return (
    pending.type === 'axe_choice' ||
    pending.type === 'just_between_us' ||
    pending.type === 'revelations_round'
  );
}
