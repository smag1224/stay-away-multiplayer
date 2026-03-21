import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';
import { InfoPanel } from './InfoPanel.tsx';

export function TemptationResponsePanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'temptation_response' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const isTarget = me.id === pending.toId;
  const fromPlayer = game.players.find((p) => p.id === pending.fromId);
  const offeredCard = fromPlayer?.hand?.find((c) => c.uid === pending.offeredCardUid);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  if (!isTarget) {
    return (
      <InfoPanel
        title={t('temptation.title')}
        body={t('temptation.choosing', { name: game.players.find((p) => p.id === pending.toId)?.name ?? '?' })}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('temptation.yourTurn')}</h3></div>
      <p className="helper-text">
        {t('temptation.offersExchange', { name: fromPlayer?.name ?? '?' })}
      </p>
      {offeredCard && (
        <div style={{ marginBottom: '6px' }}>
          <p className="helper-text" style={{ marginBottom: '4px' }}>{t('temptation.offeredToYou')}</p>
          <CardView card={offeredCard} faceUp={false} />
        </div>
      )}
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'TEMPTATION_RESPOND', cardUid: card.uid })} type="button">
                {t('action.giveAlt')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
