import { useTranslation } from 'react-i18next';
import type { ViewerGameState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';

export function AxeChoicePanel({
  game,
  loading,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  pending: Extract<PendingAction, { type: 'axe_choice' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const targetName = game.players.find((player) => player.id === pending.targetPlayerId)?.name ?? '?';

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('axeChoice.title')}</h3></div>
      <p className="helper-text">{t('axeChoice.description', { name: targetName })}</p>
      <div className="stack-actions">
        {pending.canRemoveQuarantine && (
          <button
            className="btn primary"
            disabled={loading}
            onClick={() => void onAction({ type: 'AXE_CHOOSE_EFFECT', targetPlayerId: pending.targetPlayerId, choice: 'quarantine' })}
            type="button">
            {t('axeChoice.removeQuarantine')}
          </button>
        )}
        {pending.canRemoveDoor && (
          <button
            className="btn secondary"
            disabled={loading}
            onClick={() => void onAction({ type: 'AXE_CHOOSE_EFFECT', targetPlayerId: pending.targetPlayerId, choice: 'door' })}
            type="button">
            {t('axeChoice.removeDoor')}
          </button>
        )}
      </div>
    </div>
  );
}
