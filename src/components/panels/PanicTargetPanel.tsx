import { useTranslation } from 'react-i18next';
import { getCardName } from '../../cards.ts';
import type { Lang } from '../../appHelpers.ts';
import type { ViewerGameState } from '../../multiplayer.ts';
import type { PendingAction } from '../../types.ts';

export function PanicTargetPanel({
  game,
  pending,
}: {
  game: ViewerGameState;
  pending: Extract<PendingAction, { type: 'panic_choose_target' }>;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ru';
  const cardName = getCardName(pending.panicDefId, lang);
  const targetNames = pending.targets
    .map((tid) => game.players.find((p) => p.id === tid)?.name ?? String(tid))
    .join(', ');
  return (
    <div className="panel">
      <div className="panel-header"><h3>{t('target.panicChooseTarget')}</h3></div>
      <p className="helper-text">{cardName}</p>
      <p className="helper-text" style={{ marginTop: '8px' }}>
        {t('target.tapPlayerIcon', { names: targetNames })}
      </p>
    </div>
  );
}
