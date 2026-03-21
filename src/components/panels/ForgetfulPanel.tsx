import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function ForgetfulPanel({
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'forgetful_discard' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('forgetful.title')}</h3></div>
      <p className="helper-text">
        {t('forgetful.description', { count: pending.remaining })}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = card.defId !== 'the_thing' &&
            !(me.role === 'infected' && card.defId === 'infected' && me.hand.filter(c => c.defId === 'infected').length <= 1);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp />
              <button className="btn small secondary" disabled={!allowed || loading} onClick={() => void onAction({ type: 'FORGETFUL_DISCARD_PICK', cardUid: card.uid })} type="button">
                {t('action.discardBtn')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
