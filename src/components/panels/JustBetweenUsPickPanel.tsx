import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';
import { InfoPanel } from './InfoPanel.tsx';

export function JustBetweenUsPickPanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'just_between_us_pick' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const isA = me.id === pending.playerA;
  const isB = me.id === pending.playerB;
  const isInvolved = isA || isB;
  const myChoice = isA ? pending.cardUidA : pending.cardUidB;
  const alreadyChose = myChoice !== null;
  const partnerName = game.players.find((p) => p.id === (isA ? pending.playerB : pending.playerA))?.name ?? '?';

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected' && me.role === 'infected') {
      return me.hand.filter((c) => c.defId === 'infected').length > 1;
    }
    return true;
  };

  if (!isInvolved) {
    const aName = game.players.find((p) => p.id === pending.playerA)?.name ?? '?';
    const bName = game.players.find((p) => p.id === pending.playerB)?.name ?? '?';
    return (
      <InfoPanel
        title={t('justBetweenUs.title')}
        body={t('justBetweenUs.choosing', { a: aName, b: bName })}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('justBetweenUs.title')}</h3></div>
      {alreadyChose ? (
        <p className="helper-text">{t('justBetweenUs.waitingPartner', { name: partnerName })}</p>
      ) : (
        <>
          <p className="helper-text">{t('justBetweenUs.tradeWith', { name: partnerName })}</p>
          <div className="hand-grid compact">
            {me.hand.map((card) => {
              const allowed = canGive(card);
              return (
                <div className="hand-card" key={card.uid}>
                  <CardView card={card} faceUp />
                  <button
                    className="btn small accent"
                    disabled={!allowed || loading}
                    onClick={() => void onAction({ type: 'JUST_BETWEEN_US_PICK', cardUid: card.uid, playerId: me.id })}
                    type="button"
                  >
                    {t('action.pick')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
