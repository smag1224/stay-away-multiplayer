import { useTranslation } from 'react-i18next';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function PersistenceTablePicker({
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
    <div className="table-inline-picker persistence-picker">
      <div className="table-inline-picker-header">
        <strong>{t('persistence.title')}</strong>
      </div>
      <div className="table-inline-picker-row">
        {pending.drawnCards.map((card) => (
          <div className="table-inline-card" key={card.uid}>
            <CardView card={card} faceUp />
            <button
              className="btn small primary"
              disabled={loading}
              onClick={() => void onAction({
                type: 'PERSISTENCE_PICK',
                keepUid: card.uid,
                discardUids: pending.drawnCards.filter((candidate) => candidate.uid !== card.uid).map((candidate) => candidate.uid),
              })}
              type="button">
              {t('action.keep')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
