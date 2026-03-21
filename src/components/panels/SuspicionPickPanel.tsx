import { useTranslation } from 'react-i18next';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function SuspicionPickPanel({
  loading,
  pending,
  onAction,
}: {
  loading: boolean;
  pending: Extract<PendingAction, { type: 'suspicion_pick' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const selectedUid = pending.previewCardUid;

  return (
    <div className="suspicion-pick-panel">
      <div className="suspicion-pick-desktop">
        <div className="suspicion-pick-actions suspicion-pick-actions-desktop">
          <button
            className="btn primary"
            disabled={!selectedUid || loading}
            onClick={() => {
              if (!selectedUid) return;
              void onAction({ type: 'SUSPICION_CONFIRM_CARD', cardUid: selectedUid });
            }}
            type="button"
          >
            {t('suspicion.confirm')}
          </button>
        </div>
      </div>

      <div className="suspicion-pick-mobile">
        <div className="panel-header"><h3>{t('suspicion.title')}</h3></div>
        <div className="suspicion-pick-grid" role="list">
          {pending.selectableCardUids.map((uid) => {
            const isSelected = uid === selectedUid;
            return (
              <button
                className={`suspicion-pick-card ${isSelected ? 'selected' : ''}`}
                disabled={loading}
                key={uid}
                onClick={() => void onAction({ type: 'SUSPICION_PREVIEW_CARD', cardUid: uid })}
                type="button"
              >
                <CardView card={{ uid, defId: 'suspicion' }} faceUp={false} />
              </button>
            );
          })}
        </div>
        <div className="suspicion-pick-actions">
          <button
            className="btn primary"
            disabled={!selectedUid || loading}
            onClick={() => {
              if (!selectedUid) return;
              void onAction({ type: 'SUSPICION_CONFIRM_CARD', cardUid: selectedUid });
            }}
            type="button"
          >
            {t('suspicion.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
