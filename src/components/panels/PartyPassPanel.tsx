import { useTranslation } from 'react-i18next';
import { canGiveCardToPlayer, getDirectionalNeighbor } from '../../appHelpers.ts';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function PartyPassPanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'party_pass' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const iMyTurn = pending.pendingPlayerIds.includes(me.id);
  const alreadyChosen = pending.chosen.find((c) => c.playerId === me.id);
  const passTarget = getDirectionalNeighbor(game, me.id, pending.direction);

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('party.title')}</h3></div>
      {alreadyChosen ? (
        <p className="helper-text">{t('party.chosenWaiting')}</p>
      ) : iMyTurn ? (
        <>
          <p className="helper-text">{t('party.passCard')}</p>
          <div className="hand-grid compact">
            {me.hand.map((card) => {
              const allowed = canGiveCardToPlayer(me, card, passTarget);
              return (
                <div className="hand-card" key={card.uid}>
                  <CardView card={card} faceUp />
                  <button
                    className="btn small accent"
                    disabled={!allowed || loading}
                    onClick={() => void onAction({ type: 'PARTY_PASS_CARD', cardUid: card.uid, playerId: me.id })}
                    type="button"
                  >
                    {t('action.pass')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="helper-text">
          {t('party.waiting', { count: pending.pendingPlayerIds.length })}
        </p>
      )}
      <div className="waiting-list">
        {game.players.filter((p) => pending.pendingPlayerIds.includes(p.id)).map((p) => (
          <span className="badge dim" key={p.id}>{p.name}…</span>
        ))}
        {game.players.filter((p) => pending.chosen.some((c) => c.playerId === p.id)).map((p) => (
          <span className="badge host" key={p.id}>✓ {p.name}</span>
        ))}
      </div>
    </div>
  );
}
