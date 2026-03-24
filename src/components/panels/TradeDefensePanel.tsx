import { useTranslation } from 'react-i18next';
import { actionReasonLabel, localTradeCheck, type Lang } from '../../appHelpers.ts';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function TradeDefensePanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'trade_defense' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ru';
  const allowedIds = pending.reason === 'trade' || pending.reason === 'temptation' || pending.reason === 'panic_trade'
    ? ['fear', 'no_thanks', 'miss']
    : pending.reason === 'flamethrower'
      ? ['no_barbecue']
      : pending.reason === 'analysis'
        ? ['anti_analysis']
        : ['im_fine_here'];

  const defenseCards = me.hand.filter((c) => allowedIds.includes(c.defId));
  const receiver = game.players.find((player) => player.id === pending.fromId) ?? null;
  const tradeableCards = me.hand.filter((c) => localTradeCheck(me, c, receiver));
  const fromName = game.players.find((p) => p.id === pending.fromId)?.name ?? pending.fromId;

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('tradeDefense.title')}</h3></div>
      <p className="helper-text">
        {`${fromName} → ${actionReasonLabel(pending.reason, lang)}`}
      </p>
      {defenseCards.length > 0 && (
        <>
          <h4 className="subheading">{t('tradeDefense.defense')}</h4>
          <div className="hand-grid compact">
            {defenseCards.map((card) => (
              <div className="hand-card" key={card.uid}>
                <CardView card={card} faceUp />
                <button className="btn small danger" disabled={loading} onClick={() => void onAction({ type: 'PLAY_DEFENSE', cardUid: card.uid })} type="button">
                  {t('action.defend')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {(pending.reason === 'trade' || pending.reason === 'temptation' || pending.reason === 'panic_trade') && (
        <>
          <h4 className="subheading">{t('tradeDefense.acceptTrade')}</h4>
          <div className="hand-grid compact">
            {tradeableCards.map((card) => (
              <div className="hand-card" key={card.uid}>
                <CardView card={card} faceUp />
                <button
                  className="btn small primary"
                  disabled={loading}
                  onClick={() => void onAction(
                    pending.reason === 'temptation'
                      ? { type: 'TEMPTATION_RESPOND', cardUid: card.uid }
                      : pending.reason === 'panic_trade'
                        ? { type: 'PANIC_TRADE_RESPOND', cardUid: card.uid }
                      : { type: 'RESPOND_TRADE', cardUid: card.uid },
                  )}
                  type="button">
                  {t('action.give')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {pending.reason !== 'trade' && pending.reason !== 'temptation' && (
        <div className="stack-actions" style={{ marginTop: '10px' }}>
          <button className="btn danger" disabled={loading} onClick={() => void onAction({ type: 'DECLINE_DEFENSE' })} type="button">
            {pending.reason === 'flamethrower'
              ? t('action.acceptElimination')
              : pending.reason === 'analysis'
                ? t('action.allowAnalysis')
                : t('action.acceptSwap')}
          </button>
        </div>
      )}
    </div>
  );
}
