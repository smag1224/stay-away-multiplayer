import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { TableAnimEvent, ViewerGameState } from '../../multiplayer.ts';
import type { CardInstance } from '../../types.ts';
import { ShowCardTextCtx } from './ShowCardTextCtx.ts';
import { CardView } from './CardView.tsx';

type ExchangeScene = Extract<TableAnimEvent, { type: 'exchange_pending' | 'exchange_ready' | 'exchange_blocked' }>;
type CardScene = Extract<TableAnimEvent, { type: 'card' }>;
type LegacyExchangeContext = {
  initiatorId: number;
  targetId: number;
  mode: 'trade' | 'swap' | 'temptation' | 'panic_trade';
};
type ExchangePhase =
  | 'idle'
  | 'initiator_card_selected'
  | 'waiting_target_response'
  | 'target_defense_revealed'
  | 'target_card_selected'
  | 'exchange_animating'
  | 'exchange_resolved'
  | 'exchange_blocked';

type TableVisualState =
  | { kind: 'exchange'; key: number; phase: Exclude<ExchangePhase, 'idle'>; scene: ExchangeScene }
  | { kind: 'card'; key: number; scene: CardScene }
  | null;

const BACK_CARD: CardInstance = { uid: 'anim-back', defId: 'suspicion' };
const SPRING = { type: 'spring' as const, stiffness: 280, damping: 24 };
const LEFT_SLOT_X = 46.2;
const RIGHT_SLOT_X = 53.8;

function matchTradeOfferLog(game: ViewerGameState, text: string, textRu: string): LegacyExchangeContext | null {
  for (const initiator of game.players) {
    for (const target of game.players) {
      if (initiator.id === target.id) continue;
      if (
        text === `${initiator.name} offers a trade to ${target.name}.` ||
        textRu === `${initiator.name} предлагает обмен ${target.name}.`
      ) {
        return {
          initiatorId: initiator.id,
          targetId: target.id,
          mode: 'trade',
        };
      }
    }
  }

  return null;
}

function matchTradeResolvedLog(
  game: ViewerGameState,
  text: string,
  textRu: string,
): { initiatorId: number; targetId: number } | null {
  for (const initiator of game.players) {
    for (const target of game.players) {
      if (initiator.id === target.id) continue;
      if (
        text === `${initiator.name} and ${target.name} traded cards.` ||
        textRu === `${initiator.name} и ${target.name} обменялись картами.`
      ) {
        return {
          initiatorId: initiator.id,
          targetId: target.id,
        };
      }
    }
  }

  return null;
}

function matchBlockedTradeLog(
  game: ViewerGameState,
  text: string,
  textRu: string,
): { defenderId: number; defenseCardDefId: 'no_thanks' | 'fear' | 'miss' | 'im_fine_here'; mode: 'trade' | 'swap' } | null {
  const matchers = [
    {
      defId: 'no_thanks' as const,
      mode: 'trade' as const,
      textSuffix: 'played No Thanks! Trade refused.',
      textRuSuffix: 'сыграл(а) «Нет уж, спасибо!» Обмен отклонён.',
    },
    {
      defId: 'fear' as const,
      mode: 'trade' as const,
      textSuffix: 'played Fear! Trade refused, card viewed.',
      textRuSuffix: 'сыграл(а) «Страх!» Обмен отклонён, карта просмотрена.',
    },
    {
      defId: 'miss' as const,
      mode: 'trade' as const,
      textSuffix: 'played Miss! Next player must trade instead.',
      textRuSuffix: 'сыграл(а) «Мимо!» Следующий игрок обменивается.',
    },
    {
      defId: 'im_fine_here' as const,
      mode: 'swap' as const,
      textSuffix: "played I'm Fine Here! Swap cancelled.",
      textRuSuffix: 'сыграл(а) «Мне и здесь неплохо!» Обмен местами отменён.',
    },
  ];

  for (const player of game.players) {
    for (const matcher of matchers) {
      if (
        text === `${player.name} ${matcher.textSuffix}` ||
        textRu === `${player.name} ${matcher.textRuSuffix}`
      ) {
        return {
          defenderId: player.id,
          defenseCardDefId: matcher.defId,
          mode: matcher.mode,
        };
      }
    }
  }

  return null;
}

function orbitPos(position: number, total: number) {
  const cx = 50;
  const cy = 50;
  const rx = total <= 4 ? 38 : 40;
  const ry = total <= 4 ? 30 : 33;
  const angle = (position / (total || 1)) * 360 - 90;
  const rad = (angle * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

function isSameScene(left: TableAnimEvent | null, right: TableAnimEvent | null): boolean {
  if (!left || !right) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === 'card' && right.type === 'card') {
    return left.sceneId === right.sceneId;
  }
  if (left.type !== 'card' && right.type !== 'card') {
    return left.sceneId === right.sceneId;
  }
  return false;
}

function CenterCard({ card, faceUp, slot }: { card: CardInstance; faceUp: boolean; slot: 'left' | 'right' }) {
  return (
    <motion.div
      className={`tbl-scene-card tbl-scene-card-${slot}`}
      initial={{ opacity: 0, y: 12, scale: 0.86 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.86 }}
      transition={SPRING}
    >
      <ShowCardTextCtx.Provider value={false}>
        <CardView card={card} faceUp={faceUp} />
      </ShowCardTextCtx.Provider>
    </motion.div>
  );
}

function ExchangeCardsFlying({
  game,
  scene,
}: {
  game: ViewerGameState;
  scene: Extract<ExchangeScene, { type: 'exchange_ready' }>;
}) {
  const total = game.players.length;
  const initiator = game.players.find((player) => player.id === scene.initiatorId);
  const target = game.players.find((player) => player.id === scene.targetId);
  if (!initiator || !target) return null;

  const initiatorDestination = orbitPos(target.position, total);
  const targetDestination = orbitPos(initiator.position, total);

  return (
    <>
      <motion.div
        className="tbl-flight-card"
        style={{ x: '-50%', y: '-50%' }}
        initial={{ left: `${LEFT_SLOT_X}%`, top: '50%', scale: 1, opacity: 1 }}
        animate={{ left: `${initiatorDestination.x}%`, top: `${initiatorDestination.y}%`, scale: 0.52, opacity: 0 }}
        transition={{ duration: 1.02, ease: [0.22, 1, 0.36, 1] }}
      >
        <ShowCardTextCtx.Provider value={false}>
          <CardView card={BACK_CARD} faceUp={false} />
        </ShowCardTextCtx.Provider>
      </motion.div>

      <motion.div
        className="tbl-flight-card"
        style={{ x: '-50%', y: '-50%' }}
        initial={{ left: `${RIGHT_SLOT_X}%`, top: '50%', scale: 1, opacity: 1 }}
        animate={{ left: `${targetDestination.x}%`, top: `${targetDestination.y}%`, scale: 0.52, opacity: 0 }}
        transition={{ duration: 1.02, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      >
        <ShowCardTextCtx.Provider value={false}>
          <CardView card={BACK_CARD} faceUp={false} />
        </ShowCardTextCtx.Provider>
      </motion.div>
    </>
  );
}

function ExchangeSceneBoard({
  game,
  phase,
  scene,
}: {
  game: ViewerGameState;
  phase: Exclude<ExchangePhase, 'idle'>;
  scene: ExchangeScene;
}) {
  const { t } = useTranslation();
  const initiator = game.players.find((player) => player.id === scene.initiatorId);
  const target = game.players.find((player) => player.id === scene.targetId);
  if (!initiator || !target) return null;

  const targetCardFaceUp = scene.type === 'exchange_blocked';
  const targetCard =
    scene.type === 'exchange_blocked'
      ? { uid: `center-defense-${scene.defenseCardDefId}`, defId: scene.defenseCardDefId }
      : BACK_CARD;

  const showTargetCard =
    phase === 'target_defense_revealed' ||
    phase === 'target_card_selected' ||
    phase === 'exchange_animating' ||
    phase === 'exchange_resolved' ||
    phase === 'exchange_blocked';

  const rightPlaceholderLabel =
    phase === 'initiator_card_selected'
      ? t('tableScene.placeholder.targetSeat')
      : t('tableScene.placeholder.waiting');

  return (
    <div className={`tbl-exchange-stage is-${phase}`}>
      <div className={`tbl-exchange-slots ${phase === 'exchange_animating' ? 'is-animating' : ''}`}>
        <div className="tbl-exchange-slot is-left">
          <CenterCard card={BACK_CARD} faceUp={false} key={`initiator-${scene.sceneId}`} slot="left" />
        </div>

        <div className={`tbl-exchange-connector ${scene.type === 'exchange_blocked' || phase === 'exchange_blocked' ? 'is-blocked' : ''}`}>
          <span />
          <span />
        </div>

        <div className="tbl-exchange-slot is-right">
          {showTargetCard ? (
            <CenterCard
              card={targetCard}
              faceUp={targetCardFaceUp}
              key={`target-${scene.sceneId}-${targetCardFaceUp ? targetCard.defId : 'hidden'}`}
              slot="right"
            />
          ) : (
            <motion.div
              className="tbl-empty-slot"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={SPRING}
              key={`placeholder-${scene.sceneId}`}
            >
              <span>{rightPlaceholderLabel}</span>
            </motion.div>
          )}
        </div>
      </div>

      {phase === 'exchange_animating' && scene.type === 'exchange_ready' && (
        <ExchangeCardsFlying game={game} scene={scene} />
      )}
    </div>
  );
}

function FaceUpCard({ scene }: { scene: CardScene }) {
  const fakeCard: CardInstance = { uid: `anim-${scene.cardDefId}`, defId: scene.cardDefId };
  return (
    <motion.div
      className={`tbl-faceup-wrap is-card-${scene.cardDefId}`}
      style={{ x: '-50%', y: '-50%' }}
      initial={{ scale: 0.28, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.28, opacity: 0 }}
      transition={SPRING}
    >
      <ShowCardTextCtx.Provider value={false}>
        <CardView card={fakeCard} faceUp={true} />
      </ShowCardTextCtx.Provider>
    </motion.div>
  );
}

function getAnimationPlayersSignature(game: ViewerGameState): string {
  return game.players.map((player) => `${player.id}:${player.name}:${player.position}`).join('|');
}

function TableAnimationInner({ game }: { game: ViewerGameState }) {
  const [visualState, setVisualState] = useState<TableVisualState>(null);
  const prevSceneRef = useRef<TableAnimEvent | null>(null);
  const prevLogIdRef = useRef<number | null>(game.log[0]?.id ?? null);
  const legacyExchangeRef = useRef<LegacyExchangeContext | null>(null);
  const keyRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  }, []);

  const queueStates = useCallback((steps: Array<{ delay: number; state: TableVisualState }>) => {
    clearTimers();
    steps.forEach(({ delay, state }) => {
      const timerId = window.setTimeout(() => setVisualState(state), delay);
      timersRef.current.push(timerId);
    });
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    const scene = game.tableAnim;
    const prevScene = prevSceneRef.current;
    if (isSameScene(scene, prevScene)) return;

    prevSceneRef.current = scene;
    const key = ++keyRef.current;

    if (scene?.type === 'exchange_pending' || scene?.type === 'exchange_ready' || scene?.type === 'exchange_blocked') {
      legacyExchangeRef.current = {
        initiatorId: scene.initiatorId,
        targetId: scene.targetId,
        mode: scene.mode,
      };
    }

    if (!scene) {
      clearTimers();
      setVisualState((current) => {
        if (!current) return null;
        if (current.kind === 'exchange') return null;
        if (game.step !== 'draw') return current;
        return null;
      });
      return;
    }

    if (scene.type === 'exchange_pending') {
      queueStates([
        { delay: 0, state: { kind: 'exchange', key, phase: 'initiator_card_selected', scene } },
        { delay: 420, state: { kind: 'exchange', key, phase: 'waiting_target_response', scene } },
      ]);
      return;
    }

    if (scene.type === 'exchange_blocked') {
      queueStates([
        { delay: 0, state: { kind: 'exchange', key, phase: 'target_defense_revealed', scene } },
        { delay: 900, state: { kind: 'exchange', key, phase: 'exchange_blocked', scene } },
        { delay: 2300, state: null },
      ]);
      return;
    }

    if (scene.type === 'exchange_ready') {
      queueStates([
        { delay: 0, state: { kind: 'exchange', key, phase: 'target_card_selected', scene } },
        { delay: 520, state: { kind: 'exchange', key, phase: 'exchange_animating', scene } },
        { delay: 1720, state: { kind: 'exchange', key, phase: 'exchange_resolved', scene } },
        { delay: 2380, state: null },
      ]);
      return;
    }

    queueStates([
      { delay: 0, state: { kind: 'card', key, scene } },
    ]);
  }, [clearTimers, game.step, game.tableAnim, queueStates]);

  useEffect(() => {
    const latest = game.log[0];
    if (!latest) return;

    const prevLogId = prevLogIdRef.current;
    prevLogIdRef.current = latest.id;
    if (latest.id === prevLogId) return;
    if (!game.tableAnim) {
      const tradeOffer = matchTradeOfferLog(game, latest.text, latest.textRu);
      if (tradeOffer) {
        legacyExchangeRef.current = tradeOffer;
        const key = ++keyRef.current;
        const scene: Extract<ExchangeScene, { type: 'exchange_pending' }> = {
          type: 'exchange_pending',
          sceneId: `legacy:offer:${latest.id}:${tradeOffer.initiatorId}:${tradeOffer.targetId}`,
          initiatorId: tradeOffer.initiatorId,
          targetId: tradeOffer.targetId,
          mode: tradeOffer.mode,
        };

        queueStates([
          { delay: 0, state: { kind: 'exchange', key, phase: 'initiator_card_selected', scene } },
          { delay: 420, state: { kind: 'exchange', key, phase: 'waiting_target_response', scene } },
        ]);
        return;
      }

      const tradeResolved = matchTradeResolvedLog(game, latest.text, latest.textRu);
      if (tradeResolved) {
        const context = legacyExchangeRef.current;
        const mode = context?.mode ?? 'trade';
        const key = ++keyRef.current;
        const scene: Extract<ExchangeScene, { type: 'exchange_ready' }> = {
          type: 'exchange_ready',
          sceneId: `legacy:resolved:${latest.id}:${tradeResolved.initiatorId}:${tradeResolved.targetId}`,
          initiatorId: tradeResolved.initiatorId,
          targetId: tradeResolved.targetId,
          mode,
        };

        legacyExchangeRef.current = {
          initiatorId: tradeResolved.initiatorId,
          targetId: tradeResolved.targetId,
          mode,
        };
        queueStates([
          { delay: 0, state: { kind: 'exchange', key, phase: 'target_card_selected', scene } },
          { delay: 520, state: { kind: 'exchange', key, phase: 'exchange_animating', scene } },
          { delay: 1720, state: { kind: 'exchange', key, phase: 'exchange_resolved', scene } },
          { delay: 2380, state: null },
        ]);
        return;
      }

      const blockedTrade = matchBlockedTradeLog(game, latest.text, latest.textRu);
      const context = legacyExchangeRef.current;
      if (blockedTrade && context && context.targetId === blockedTrade.defenderId) {
        const mode = context.mode === 'temptation' ? 'temptation' : blockedTrade.mode;
        const key = ++keyRef.current;
        const scene: Extract<ExchangeScene, { type: 'exchange_blocked' }> = {
          type: 'exchange_blocked',
          sceneId: `legacy:blocked:${latest.id}:${context.initiatorId}:${context.targetId}`,
          initiatorId: context.initiatorId,
          targetId: context.targetId,
          mode,
          defenseCardDefId: blockedTrade.defenseCardDefId,
        };

        queueStates([
          { delay: 0, state: { kind: 'exchange', key, phase: 'target_defense_revealed', scene } },
          { delay: 900, state: { kind: 'exchange', key, phase: 'exchange_blocked', scene } },
          { delay: 2300, state: null },
        ]);
        return;
      }
    }

    if (!latest.cardDefId) return;
    if (game.tableAnim) return;

    const key = ++keyRef.current;
    const fallbackScene: CardScene = {
      type: 'card',
      sceneId: `log:${latest.id}`,
      cardDefId: latest.cardDefId,
    };

    queueStates([
      { delay: 0, state: { kind: 'card', key, scene: fallbackScene } },
    ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.log]);

  return (
    <AnimatePresence initial={false}>
      {visualState && (
        <motion.div
          key={visualState.key}
          className="tbl-anim-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {visualState.kind === 'exchange' && (
            <ExchangeSceneBoard
              game={game}
              phase={visualState.phase}
              scene={visualState.scene}
            />
          )}
          {visualState.kind === 'card' && <FaceUpCard scene={visualState.scene} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const TableAnimation = memo(TableAnimationInner, (prevProps, nextProps) => {
  const prevLatestLog = prevProps.game.log[0];
  const nextLatestLog = nextProps.game.log[0];
  const prevSceneId = prevProps.game.tableAnim && 'sceneId' in prevProps.game.tableAnim ? prevProps.game.tableAnim.sceneId : null;
  const nextSceneId = nextProps.game.tableAnim && 'sceneId' in nextProps.game.tableAnim ? nextProps.game.tableAnim.sceneId : null;

  return (
    prevProps.game.step === nextProps.game.step &&
    prevProps.game.currentPlayerIndex === nextProps.game.currentPlayerIndex &&
    prevSceneId === nextSceneId &&
    prevLatestLog?.id === nextLatestLog?.id &&
    prevLatestLog?.text === nextLatestLog?.text &&
    prevLatestLog?.textRu === nextLatestLog?.textRu &&
    prevLatestLog?.cardDefId === nextLatestLog?.cardDefId &&
    prevLatestLog?.fromPlayerId === nextLatestLog?.fromPlayerId &&
    getAnimationPlayersSignature(prevProps.game) === getAnimationPlayersSignature(nextProps.game)
  );
});

TableAnimation.displayName = 'TableAnimation';
