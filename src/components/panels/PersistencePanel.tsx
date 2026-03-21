import { useTranslation } from 'react-i18next';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function PersistencePanel({
  loading,
  pending,
  onAction,
}: {
  loading: boolean;
  pending: Extract<PendingAction, { type: 'persistence_pick' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('persistence.title')}</h3></div>
      <div className="hand-grid compact">
        {pending.drawnCards.map((card) => (
          <div className="hand-card" key={card.uid}>
            <CardView card={card} faceUp />
            <button
              className="btn small primary"
              disabled={loading}
              onClick={() => void onAction({
                type: 'PERSISTENCE_PICK',
                keepUid: card.uid,
                discardUids: pending.drawnCards.filter((c) => c.uid !== card.uid).map((c) => c.uid),
              })}
              type="button"
            >
              {t('action.keep')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
