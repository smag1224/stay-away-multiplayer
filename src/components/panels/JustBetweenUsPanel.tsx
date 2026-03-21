import { useTranslation } from 'react-i18next';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction, PendingAction } from '../../types.ts';

export function JustBetweenUsPanel({
  game,
  loading,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  pending: Extract<PendingAction, { type: 'just_between_us' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const alive = game.players
    .filter((p) => pending.targets.includes(p.id) && p.isAlive)
    .slice()
    .sort((a, b) => a.position - b.position);

  const seenPairs = new Set<string>();
  const pairs = alive
    .map((player, i) => {
      const next = alive[(i + 1) % alive.length];
      if (!next || next.id === player.id) return null;
      const key = [player.id, next.id].sort((a, b) => a - b).join('-');
      if (seenPairs.has(key)) return null;
      seenPairs.add(key);
      return [player, next] as const;
    })
    .filter((pair): pair is readonly [ViewerPlayerState, ViewerPlayerState] => Boolean(pair));

  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('justBetweenUs.title')}</h3></div>
      <p className="helper-text">{t('justBetweenUs.pickPair')}</p>
      <div className="stack-actions" style={{ marginTop: '8px' }}>
        {pairs.map(([p1, p2]) => (
          <button
            className="btn secondary"
            disabled={loading}
            key={`${p1.id}-${p2.id}`}
            onClick={() => void onAction({ type: 'JUST_BETWEEN_US_SELECT', player1: p1.id, player2: p2.id })}
            type="button"
          >
            {p1.name} ↔ {p2.name}
          </button>
        ))}
      </div>
    </div>
  );
}
