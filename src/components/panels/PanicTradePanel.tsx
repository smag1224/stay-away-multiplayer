import { useTranslation } from 'react-i18next';
import { canGiveCardToPlayer } from '../../appHelpers.ts';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function PanicTradePanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'panic_trade' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const target = game.players.find((p) => p.id === pending.targetPlayerId);

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('panicTrade.title')}</h3></div>
      <p className="helper-text">
        {t('panicTrade.pickCard', { name: target?.name ?? '?' })}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGiveCardToPlayer(me, card, target);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'PANIC_TRADE_SELECT', targetPlayerId: pending.targetPlayerId, cardUid: card.uid })} type="button">
                {t('action.giveAlt')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
