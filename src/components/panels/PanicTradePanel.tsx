import { useTranslation } from 'react-i18next';
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
  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('panicTrade.title')}</h3></div>
      <p className="helper-text">
        {t('panicTrade.pickCard', { name: target?.name ?? '?' })}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
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
