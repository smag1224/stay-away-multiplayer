import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

export function RevealPanel({
  game,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'view_hand' | 'view_card' | 'whisky_reveal' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const cards = pending.type === 'view_hand' ? pending.cards : pending.type === 'view_card' ? [pending.card] : pending.cards;
  const ownerId = pending.type === 'whisky_reveal' ? pending.playerId : pending.targetPlayerId;
  const ownerName = game.players.find((p) => p.id === ownerId)?.name ?? ownerId;
  const canConfirm = pending.viewerPlayerId === me.id;

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('reveal.title')}</h3></div>
      <p className="helper-text">
        {pending.type === 'whisky_reveal'
          ? t('reveal.showsAll', { name: ownerName })
          : t('reveal.cardsOf', { name: ownerName })}
      </p>
      <div className="hand-grid compact">
        {cards.map((card) => <CardView card={card} faceUp key={card.uid} />)}
      </div>
      {canConfirm ? (
        <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'CONFIRM_VIEW' })} style={{ marginTop: '8px' }} type="button">
          {t('action.confirm')}
        </button>
      ) : (
        <p className="helper-text">{t('reveal.otherMustConfirm')}</p>
      )}
    </div>
  );
}
