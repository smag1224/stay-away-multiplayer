import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { InfoPanel } from './InfoPanel.tsx';

export function RevelationsPanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'revelations_round' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const revealerIdx = pending.revealOrder[pending.currentRevealerIdx];
  const revealer = game.players[revealerIdx];
  const isMyTurn = revealer?.id === me.id;
  const hasInfected = me.hand.some((card) => card.defId === 'infected');

  if (!isMyTurn) {
    return (
      <InfoPanel
        title={t('revelations.title')}
        body={t('revelations.deciding', { name: revealer?.name ?? '?' })}
      />
    );
  }

  return (
    <div className="panel revelations-panel">
      <div className="panel-header"><h3>{t('revelations.title')}</h3></div>
      <div className="stack-actions" style={{ marginTop: '8px' }}>
        {hasInfected && (
          <button
            className="btn danger"
            disabled={loading}
            onClick={() => void onAction({ type: 'REVELATIONS_RESPOND', show: true, mode: 'infected_only' })}
            type="button">
            {t('revelations.showInfectedOnly')}
          </button>
        )}
        <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'REVELATIONS_RESPOND', show: true })} type="button">
          {hasInfected ? t('revelations.showAllCards') : t('action.show')}
        </button>
        <button className="btn secondary" disabled={loading} onClick={() => void onAction({ type: 'REVELATIONS_RESPOND', show: false })} type="button">
          {t('action.skip')}
        </button>
      </div>
    </div>
  );
}
