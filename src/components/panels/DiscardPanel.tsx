import { useTranslation } from 'react-i18next';
import { canDiscardCard } from '../../gameLogic.ts';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function DiscardPanel({
  game,
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
      <div className="panel-header"><h3>{t('target.chooseDiscard')}</h3></div>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canDiscardCard(game as unknown as import('../../types.ts').GameState, me as unknown as import('../../types.ts').Player, card.uid);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp />
              <button className="btn small secondary" disabled={!allowed || loading} onClick={() => void onAction({ type: 'DISCARD_CARD', cardUid: card.uid })} type="button">
                {t('action.discardBtn')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
