import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

const CONFIRM_DELAY_SEC = 5;

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
  const [secondsLeft, setSecondsLeft] = useState(CONFIRM_DELAY_SEC);
  // Reset timer whenever the pending action changes (new reveal)
  const pendingKey = `${pending.type}-${pending.viewerPlayerId}`;
  const prevKeyRef = useRef(pendingKey);

  useEffect(() => {
    setSecondsLeft(CONFIRM_DELAY_SEC);
    prevKeyRef.current = pendingKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [secondsLeft]);

  const cards = pending.type === 'view_hand' ? pending.cards : pending.type === 'view_card' ? [pending.card] : pending.cards;
  const ownerId = pending.type === 'whisky_reveal' ? pending.playerId : pending.targetPlayerId;
  const ownerName = game.players.find((p) => p.id === ownerId)?.name ?? ownerId;
  const canConfirm = pending.viewerPlayerId === me.id;

  // Delay applies only when the current player is SHOWING their own cards to others
  // (whisky/oops = public reveal; view_hand where viewer = target = "between us").
  // No delay for private peeks: suspicion (view_card) and analysis/страх (view_hand, viewer ≠ target).
  const needsDelay =
    pending.type === 'whisky_reveal' ||
    (pending.type === 'view_hand' && pending.targetPlayerId === pending.viewerPlayerId);
  const waiting = needsDelay && secondsLeft > 0;

  return (
    <div className="panel reveal-panel">
      <div className="panel-header"><h3>{t('reveal.title')}</h3></div>
      <p className={`helper-text ${pending.type === 'whisky_reveal' ? 'is-public' : ''}`}>
        {pending.type === 'whisky_reveal'
          ? pending.revealKind === 'infected_only'
            ? t('reveal.showsInfectedOnly', { name: ownerName })
            : t('reveal.showsAll', { name: ownerName })
          : t('reveal.cardsOf', { name: ownerName })}
      </p>
      <div className="reveal-inline-list" data-count={cards.length}>
        {cards.map((card) => (
          <div className="reveal-inline-card" key={card.uid}>
            <CardView card={card} faceUp />
          </div>
        ))}
      </div>
      {canConfirm ? (
        <button
          className="btn primary"
          disabled={loading || waiting}
          onClick={() => void onAction({ type: 'CONFIRM_VIEW' })}
          type="button"
        >
          {waiting ? `${t('action.confirm')} (${secondsLeft})` : t('action.confirm')}
        </button>
      ) : (
        <p className="helper-text">{t('reveal.otherMustConfirm')}</p>
      )}
    </div>
  );
}
