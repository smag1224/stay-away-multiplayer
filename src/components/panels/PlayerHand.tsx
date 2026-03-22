import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { canDiscardCard, canPlayCard } from '../../gameLogic.ts';
import { getCurrentPlayer, localTradeCheck } from '../../appHelpers.ts';
import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { CardInstance, GameAction } from '../../types.ts';
import { CardView } from './CardView.tsx';

/** Compute fan rotation & vertical offset for card at index i out of total */
function fanStyle(i: number, total: number) {
  if (total <= 1) return {};
  const mid = (total - 1) / 2;
  const t = (i - mid) / Math.max(mid, 1); // -1..1
  const rotate = total >= 7 ? t * 3.5 : total >= 5 ? t * 4.5 : t * 6;
  const translateY = total >= 7 ? Math.abs(t) * 10 : Math.abs(t) * 18;
  const overlap = total >= 8 ? -6 : total >= 6 ? -10 : total >= 4 ? -14 : -20;
  return {
    transform: `rotate(${rotate}deg) translateY(${translateY}px)`,
    marginLeft: i === 0 ? 0 : overlap,
    zIndex: i + 1,
    transformOrigin: 'bottom center',
  };
}

const cardVariants = {
  initial: { opacity: 0, y: 40, scale: 0.8, rotate: 0 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -30, scale: 0.8 },
};

type ExtraHandEntry = {
  isExtra: true;
  card: CardInstance;
  source: 'persistence' | 'reveal';
  btnLabel?: string;
  btnCss?: string;
  actionFn?: () => void;
};

type PlayerHandEntry = {
  isExtra: false;
  card: CardInstance;
};

export function PlayerHand({
  game,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const pending = game.pendingAction;
  const isMyTurn = (getCurrentPlayer(game)?.id ?? -1) === me.id;
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const tradePartner = (() => {
    if (game.step !== 'trade') return null;
    const alivePositions = game.players
      .filter((player) => player.isAlive)
      .map((player) => player.position)
      .sort((left, right) => left - right);
    const myIdx = alivePositions.indexOf(me.position);
    if (myIdx === -1 || alivePositions.length <= 1) return null;
    const nextIdx = (myIdx + game.direction + alivePositions.length) % alivePositions.length;
    const nextPosition = alivePositions[nextIdx];
    return game.players.find((player) => player.position === nextPosition) ?? null;
  })();
  const suspicionPreviewUid =
    pending?.type === 'suspicion_pick' && pending.targetPlayerId === me.id
      ? pending.previewCardUid
      : null;

  const canGive = (card: CardInstance) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  const extraCards: ExtraHandEntry[] = [];

  const allCards: Array<ExtraHandEntry | PlayerHandEntry> = [
    ...extraCards,
    ...me.hand.map((card): PlayerHandEntry => ({ card, isExtra: false })),
  ];
  const totalCards = allCards.length;

  const handleCardClick = (uid: string) => {
    setSelectedUid(prev => prev === uid ? null : uid);
  };

  return (
    <div className="hand-fan-scroll">
      <div className="hand-fan">
        <AnimatePresence mode="popLayout">
        {allCards.map((entry, idx) => {
        const style = fanStyle(idx, totalCards);
        const isSelected = selectedUid === entry.card.uid;

        if (entry.isExtra) {
          const { card, source, btnLabel, btnCss, actionFn } = entry;
          return (
            <motion.div className={`hand-card fan-card extra-card ${isSelected ? 'selected' : ''}`} key={`extra-${card.uid}`}
              style={style}
              variants={cardVariants} initial="initial" animate="animate" exit="exit"
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              whileHover={{ y: -20, scale: 1.08, zIndex: 50, rotate: 0 }}
              onClick={() => handleCardClick(card.uid)}>
              <div style={{ fontSize: '.6rem', color: 'var(--gold)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px', textAlign: 'center' }}>
                {source === 'persistence' ? t('action.choice') : t('action.revealed')}
              </div>
              <CardView card={card} faceUp />
              {actionFn && btnLabel ? (
                <div className="hand-card-actions">
                  <button className={`btn small ${btnCss}`} disabled={loading} onClick={(e) => { e.stopPropagation(); actionFn(); }} type="button" style={{ flex: 1 }}>
                    {btnLabel}
                  </button>
                </div>
              ) : <div style={{ height: '28px' }} />}
            </motion.div>
          );
        }

        const { card } = entry;
        const isSuspicionPreview = suspicionPreviewUid === card.uid;
        const buttons: { label: string; css: string; disabled?: boolean; fn: () => void }[] = [];

        if (!pending) {
          const canPlay = isMyTurn && game.step === 'play_or_discard' && canPlayCard(game as unknown as import('../../types.ts').GameState, card.defId);
          const canDiscard = isMyTurn && game.step === 'play_or_discard' && canDiscardCard(game as unknown as import('../../types.ts').GameState, me as unknown as import('../../types.ts').Player, card.uid);
          const canTrade = isMyTurn && game.step === 'trade' && localTradeCheck(me, card, tradePartner);
          if (canPlay) buttons.push({ label: t('action.play'), css: 'primary', fn: () => { void onAction({ type: 'PLAY_CARD', cardUid: card.uid }); } });
          if (canDiscard) buttons.push({ label: t('action.discard'), css: 'secondary', fn: () => { void onAction({ type: 'DISCARD_CARD', cardUid: card.uid }); } });
          if (canTrade) buttons.push({ label: t('action.offer'), css: 'accent', fn: () => { void onAction({ type: 'OFFER_TRADE', cardUid: card.uid }); } });
        } else {
          if (pending.type === 'choose_card_to_discard') {
            const allowed = canDiscardCard(game as unknown as import('../../types.ts').GameState, me as unknown as import('../../types.ts').Player, card.uid);
            buttons.push({ label: t('action.discardBtn'), css: 'secondary', disabled: !allowed, fn: () => { void onAction({ type: 'DISCARD_CARD', cardUid: card.uid }); } });
          } else if (pending.type === 'choose_card_to_give') {
            const receiver = game.players.find((player) => player.id === pending.targetPlayerId) ?? null;
            const allowed = canGive(card) && localTradeCheck(me, card, receiver);
            buttons.push({ label: t('action.giveAlt'), css: 'accent', disabled: !allowed, fn: () => { void onAction({ type: 'TEMPTATION_SELECT', targetPlayerId: pending.targetPlayerId, cardUid: card.uid }); } });
          } else if (pending.type === 'trade_defense') {
            const receiver = game.players.find((player) => player.id === pending.fromId) ?? null;
            const allowedIds = pending.reason === 'trade' || pending.reason === 'temptation' ? ['fear', 'no_thanks', 'miss'] :
                               pending.reason === 'flamethrower' ? ['no_barbecue'] :
                               pending.reason === 'analysis' ? ['anti_analysis'] : ['im_fine_here'];
            if (allowedIds.includes(card.defId)) {
              buttons.push({ label: t('action.defend'), css: 'danger', fn: () => { void onAction({ type: 'PLAY_DEFENSE', cardUid: card.uid }); } });
            }
            if ((pending.reason === 'trade' || pending.reason === 'temptation') && localTradeCheck(me, card, receiver)) {
              buttons.push({
                label: t('action.give'),
                css: 'primary',
                fn: () => {
                  void onAction(
                    pending.reason === 'temptation'
                      ? { type: 'TEMPTATION_RESPOND', cardUid: card.uid }
                      : { type: 'RESPOND_TRADE', cardUid: card.uid },
                  );
                },
              });
            }
          } else if (pending.type === 'just_between_us_pick') {
            buttons.push({ label: t('action.pick'), css: 'accent', disabled: !canGive(card), fn: () => { void onAction({ type: 'JUST_BETWEEN_US_PICK', cardUid: card.uid, playerId: me.id }); } });
          } else if (pending.type === 'party_pass') {
            const iMyTurnPass = pending.pendingPlayerIds.includes(me.id);
            const alreadyChosen = pending.chosen.find((c) => c.playerId === me.id);
            if (iMyTurnPass && !alreadyChosen) {
              buttons.push({ label: t('action.pass'), css: 'accent', disabled: !canGive(card), fn: () => { void onAction({ type: 'PARTY_PASS_CARD', cardUid: card.uid, playerId: me.id }); } });
            }
          } else if (pending.type === 'temptation_response' && me.id === pending.toId) {
            buttons.push({ label: t('action.giveAlt'), css: 'accent', disabled: !canGive(card), fn: () => { void onAction({ type: 'TEMPTATION_RESPOND', cardUid: card.uid }); } });
          } else if (pending.type === 'blind_date_swap') {
            buttons.push({ label: t('action.swap'), css: 'accent', disabled: !canGive(card), fn: () => { void onAction({ type: 'BLIND_DATE_PICK', cardUid: card.uid }); } });
          } else if (pending.type === 'forgetful_discard') {
            const allowed = card.defId !== 'the_thing' && !(me.role === 'infected' && card.defId === 'infected' && me.hand.filter((c) => c.defId === 'infected').length <= 1);
            buttons.push({ label: t('action.discardBtn'), css: 'secondary', disabled: !allowed, fn: () => { void onAction({ type: 'FORGETFUL_DISCARD_PICK', cardUid: card.uid }); } });
          } else if (pending.type === 'panic_trade') {
            const receiver = game.players.find((player) => player.id === pending.targetPlayerId) ?? null;
            buttons.push({ label: t('action.giveAlt'), css: 'accent', disabled: !(canGive(card) && localTradeCheck(me, card, receiver)), fn: () => { void onAction({ type: 'PANIC_TRADE_SELECT', targetPlayerId: pending.targetPlayerId, cardUid: card.uid }); } });
          } else if (pending.type === 'panic_trade_response' && me.id === pending.toId) {
            const receiver = game.players.find((player) => player.id === pending.fromId) ?? null;
             buttons.push({ label: t('action.giveAlt'), css: 'accent', disabled: !(canGive(card) && localTradeCheck(me, card, receiver)), fn: () => { void onAction({ type: 'PANIC_TRADE_RESPOND', cardUid: card.uid }); } });
          }
        }

        return (
          <motion.div className={`hand-card fan-card ${isSelected ? 'selected' : ''} ${isSuspicionPreview ? 'is-suspicion-preview' : ''}`} key={card.uid}
            style={style}
            variants={cardVariants} initial="initial" animate="animate" exit="exit"
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            whileHover={{ y: -20, scale: 1.08, zIndex: 50, rotate: 0 }}
            onClick={() => handleCardClick(card.uid)}>
            <CardView card={card} faceUp />
            {buttons.length > 0 && (
              <div className="hand-card-actions">
                {buttons.map((b, i) => (
                  <button className={`btn small ${b.css}`} disabled={b.disabled || loading} key={i}
                    onClick={(e) => { e.stopPropagation(); b.fn(); }}
                    type="button" style={{ flex: 1, padding: '4px 2px' }}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        );
        })}
        </AnimatePresence>
      </div>
    </div>
  );
}
