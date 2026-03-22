import type { PendingAction } from '../../types.ts';

export function hasRenderablePendingActionPanel(
  pending: PendingAction | null | undefined,
  meId: number,
) {
  if (!pending) return false;

  return (
    (pending.type === 'trade_defense' &&
      pending.defenderId === meId &&
      pending.reason !== 'trade' &&
      pending.reason !== 'temptation') ||
    pending.type === 'just_between_us' ||
    pending.type === 'revelations_round'
  );
}
