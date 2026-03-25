/**
 * Renders the draw pile and discard pile on the table.
 * - Draw pile: upper-left area, shows card back (event/panic).
 * - Discard pile: upper-right area, shows card back (only played cards fly face-up).
 * - Stack thickness reflects number of cards with visible light edges.
 * - Animates cards: deck→player on draw, player→discard on play/discard.
 */
import { useRef, useEffect, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCardDef, getCardImage } from '../../cards.ts';
import type { ViewerGameState } from '../../multiplayer.ts';

/* ── Layout helpers (mirrors PlayerCircle positioning) ────────────────────── */
function getOrbitLayout(totalPlayers: number) {
  const total = Math.max(4, totalPlayers);
  if (total <= 4) return { cx: 50, cy: 54, rx: 49, ry: 36.5 };
  if (total <= 6) return { cx: 50, cy: 53, rx: 50, ry: 37 };
  if (total <= 8) return { cx: 50, cy: 52, rx: 51, ry: 38 };
  return { cx: 50, cy: 51, rx: 52, ry: 39 };
}

function getPlayerPos(position: number, total: number) {
  const { cx, cy, rx, ry } = getOrbitLayout(total);
  const angle = (position / total) * 360 - 90;
  const rad = (angle * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

/* ── Stack thickness helpers ──────────────────────────────────────────────── */
function stackLayers(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  if (count <= 18) return 4;
  if (count <= 28) return 5;
  return 6;
}

/* ── Card back image paths ────────────────────────────────────────────────── */
const EVENT_BACK = '/cards/card-back-event.png';
const PANIC_BACK = '/cards/panic_card_back.png';

function topCardBackImage(deck: ViewerGameState['deck']): string {
  if (deck.length === 0) return EVENT_BACK;
  const topCard = deck[deck.length - 1];
  const def = getCardDef(topCard.defId);
  return def.back === 'panic' ? PANIC_BACK : EVENT_BACK;
}

function discardTopBackImage(discard: ViewerGameState['discard']): string {
  if (discard.length === 0) return EVENT_BACK;
  const topCard = discard[discard.length - 1];
  const def = getCardDef(topCard.defId);
  return def.back === 'panic' ? PANIC_BACK : EVENT_BACK;
}

/* ── Fly-animation data ───────────────────────────────────────────────────── */
interface FlyCard {
  key: number;
  type: 'draw' | 'discard';
  /** Image to show on the flying card */
  imgSrc: string;
  /** Player position as % of container */
  playerPos: { x: number; y: number };
}

/* ── Deck positions (% of player-circle container) ────────────────────────── */
/* Desktop positions (% of player-circle) — indexed by player count bracket */
function getDeckPositions(totalPlayers: number, mobile: boolean) {
  if (mobile) return { drawX: 8, drawY: 10, discX: 92, discY: 10 };
  // 7+ players: push decks to edges so they don't overlap avatars
  if (totalPlayers >= 7) return { drawX: 0.5, drawY: 10, discX: 99.5, discY: 10 };
  return { drawX: 12, drawY: 18, discX: 88, discY: 18 };
}

/* ── Responsive hook ──────────────────────────────────────────────────────── */
const mqlMobile = typeof window !== 'undefined'
  ? window.matchMedia('(max-width: 768px)')
  : null;
function subscribeMql(cb: () => void) {
  mqlMobile?.addEventListener('change', cb);
  return () => mqlMobile?.removeEventListener('change', cb);
}
function getIsMobile() { return mqlMobile?.matches ?? false; }

/* ── Component ────────────────────────────────────────────────────────────── */
export function TableDecks({
  game,
}: {
  game: ViewerGameState;
  orbitCenterX: number;
  orbitCenterY: number;
}) {
  const isMobile = useSyncExternalStore(subscribeMql, getIsMobile, () => false);
  const total = game.players.length;
  const { drawX, drawY, discX, discY } = getDeckPositions(total, isMobile);

  const prevDeckLen = useRef(game.deck.length);
  const prevDiscardLen = useRef(game.discard.length);
  const prevLogLen = useRef(game.log.length);
  const [flyCards, setFlyCards] = useState<FlyCard[]>([]);
  const flyKeyRef = useRef(0);

  useEffect(() => {
    const dDeck = game.deck.length - prevDeckLen.current;
    const dDiscard = game.discard.length - prevDiscardLen.current;
    const newLogCount = game.log.length - prevLogLen.current;
    prevDeckLen.current = game.deck.length;
    prevDiscardLen.current = game.discard.length;
    prevLogLen.current = game.log.length;

    const newFlies: FlyCard[] = [];

    // DRAW: deck shrank → card flies deck → current player (always card back)
    if (dDeck < 0) {
      const curPlayer = game.players[game.currentPlayerIndex];
      if (curPlayer) {
        const pos = getPlayerPos(curPlayer.position, total);
        let backImg = EVENT_BACK;
        // Determine back type from log if possible
        if (newLogCount > 0 && game.log[0].cardDefId) {
          const def = getCardDef(game.log[0].cardDefId);
          backImg = def.back === 'panic' ? PANIC_BACK : EVENT_BACK;
        }
        newFlies.push({
          key: ++flyKeyRef.current,
          type: 'draw',
          imgSrc: backImg,
          playerPos: pos,
        });
      }
    }

    // DISCARD: discard grew → card flies player → discard
    // Only show FACE-UP for played cards (have cardDefId in log); back for others
    if (dDiscard > 0 && newLogCount > 0) {
      for (let i = 0; i < Math.min(newLogCount, dDiscard); i++) {
        const entry = game.log[i];
        const fromId = entry.fromPlayerId;
        const fromPlayer = fromId !== undefined
          ? game.players.find(p => p.id === fromId)
          : game.players[game.currentPlayerIndex];
        if (!fromPlayer) continue;
        const pos = getPlayerPos(fromPlayer.position, total);

        // Played card (has cardDefId) → show face image
        // Discarded card (no cardDefId or just "discarded") → show back
        let imgSrc: string;
        if (entry.cardDefId) {
          const faceImg = getCardImage(entry.cardDefId);
          if (faceImg) {
            imgSrc = faceImg;
          } else {
            const def = getCardDef(entry.cardDefId);
            imgSrc = def.back === 'panic' ? PANIC_BACK : EVENT_BACK;
          }
        } else {
          imgSrc = EVENT_BACK;
        }
        newFlies.push({
          key: ++flyKeyRef.current,
          type: 'discard',
          imgSrc,
          playerPos: pos,
        });
      }
    }

    if (newFlies.length > 0) {
      setFlyCards(prev => [...prev, ...newFlies]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.deck.length, game.discard.length, game.log.length]);

  const removeFly = (key: number) => {
    setFlyCards(prev => prev.filter(f => f.key !== key));
  };

  const deckCount = game.deck.length;
  const discardCount = game.discard.length;
  const deckLayers = stackLayers(deckCount);
  const discardLayers = stackLayers(discardCount);

  const topDeckBack = topCardBackImage(game.deck);
  const topDiscardBack = discardTopBackImage(game.discard);

  return (
    <>
      {/* ── Draw pile (upper-left) ────────────────────────────────── */}
      <div
        className="table-deck table-deck--draw"
        style={{ left: `${drawX}%`, top: `${drawY}%` }}
      >
        <div className="table-deck__stack">
          {/* Bottom layers — largest offset first, decreasing toward top */}
          {Array.from({ length: deckLayers }).map((_, i) => (
            <div
              key={i}
              className="table-deck__sub-card"
              style={{
                transform: `translate(${2 * (deckLayers - i)}px, ${2.5 * (deckLayers - i)}px)`,
                filter: `brightness(${0.5 + i * 0.08})`,
                zIndex: i,
              }}
            >
              <img src={EVENT_BACK} alt="" draggable={false} />
            </div>
          ))}
          {/* Top card — at (0,0), sits on top of the cascade */}
          {deckCount > 0 && (
            <div className="table-deck__top-card" style={{ zIndex: deckLayers }}>
              <img src={topDeckBack} alt="Draw pile" draggable={false} />
            </div>
          )}
        </div>
        <div className="table-deck__count">{deckCount}</div>
      </div>

      {/* ── Discard pile (upper-right) ────────────────────────────── */}
      <div
        className="table-deck table-deck--discard"
        style={{ left: `${discX}%`, top: `${discY}%` }}
      >
        <div className="table-deck__stack">
          {Array.from({ length: discardLayers }).map((_, i) => (
            <div
              key={i}
              className="table-deck__sub-card"
              style={{
                transform: `translate(${2 * (discardLayers - i)}px, ${2.5 * (discardLayers - i)}px)`,
                filter: `brightness(${0.5 + i * 0.08})`,
                zIndex: i,
              }}
            >
              <img src={EVENT_BACK} alt="" draggable={false} />
            </div>
          ))}
          {discardCount > 0 && (
            <div className="table-deck__top-card" style={{ zIndex: discardLayers }}>
              <img src={topDiscardBack} alt="Discard pile" draggable={false} />
            </div>
          )}
        </div>
        <div className="table-deck__count">{discardCount}</div>
      </div>

      {/* ── Flying card animations ───────────────────────────────── */}
      <AnimatePresence>
        {flyCards.map((fly) => {
          const isDrawn = fly.type === 'draw';
          const fromX = isDrawn ? drawX : fly.playerPos.x;
          const fromY = isDrawn ? drawY : fly.playerPos.y;
          const toX = isDrawn ? fly.playerPos.x : discX;
          const toY = isDrawn ? fly.playerPos.y : discY;

          return (
            <motion.div
              key={fly.key}
              className="table-deck__fly-card"
              initial={{
                left: `${fromX}%`,
                top: `${fromY}%`,
                opacity: 1,
                scale: 0.8,
              }}
              animate={{
                left: `${toX}%`,
                top: `${toY}%`,
                opacity: [1, 1, 0.7],
                scale: [0.8, 1.05, 0.9],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.2, 0, 0.5, 1] }}
              onAnimationComplete={() => removeFly(fly.key)}
            >
              <img src={fly.imgSrc} alt="" draggable={false} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </>
  );
}
