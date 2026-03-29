import { useTranslation } from 'react-i18next';
import { canGiveCard } from '../../appHelpers.ts';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function BlindDatePanel({
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('blindDate.title')}</h3></div>
      <p className="helper-text">{t('blindDate.description')}</p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGiveCard(me, card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'BLIND_DATE_PICK', cardUid: card.uid })} type="button">
                {t('action.swap')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
