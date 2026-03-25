import type { CSSProperties } from 'react';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { hasDoorBetween } from '../../gameLogic.ts';
import { getCurrentPlayer } from '../../appHelpers.ts';
import type { RoomMemberView, ShoutEntry, ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction } from '../../types.ts';
import { getPlayerAvatarPresentation, getPlayerAvatarSrc } from '../../playerAvatarImages.ts';
import { PLAYER_AVATAR_IDS } from '../../avatarCatalog.ts';
import quarantineOverlay from '../../assets/quarantine_overlay.webp';
import thingOverlay from '../../assets/thing_overlay.webp';
import infectedOverlay from '../../assets/infected_overlay.webp';
import { CardView } from './CardView.tsx';
import { TableAnimationBoundary } from './TableAnimationBoundary.tsx';
import { TableDecks } from './TableDecks.tsx';
import { speakShout } from '../../sounds/shoutVoice.ts';

const LOCKED_DOOR_MARKER_CARD = {
  uid: 'locked-door-marker',
  defId: 'locked_door',
} as const;

const SHOUT_PHRASES = [
  { ru: 'Чистейший!', en: 'Clean!' },
  { ru: 'На руках!',  en: 'In hand!' },
  { ru: 'В колоде',   en: 'In the deck' },
  { ru: 'Заюзаешь',  en: "You'll use it" },
  { ru: 'Грязнющий!', en: 'Dirty!' },
  { ru: 'Я свой',     en: "I'm friendly" },
  { ru: 'Посидит',    en: 'It can wait' },
  { ru: 'Передашь',   en: "You'll pass it" },
  { ru: 'Даю годнотишку', en: 'Giving you gold' },
] as const;

function getOrbitLayout(totalPlayers: number) {
  const total = Math.max(4, totalPlayers);

  if (total <= 4) {
    return {
      orbitCenterX: 50,
      orbitCenterY: 54,
      orbitRadiusX: 49,
      orbitRadiusY: 36.5,
      handOffset: 60,
      nodeLift: '-24%',
    };
  }

  if (total <= 6) {
    return {
      orbitCenterX: 50,
      orbitCenterY: 53,
      orbitRadiusX: 50,
      orbitRadiusY: 37,
      handOffset: 56,
      nodeLift: '-25%',
    };
  }

  if (total <= 8) {
    return {
      orbitCenterX: 50,
      orbitCenterY: 52,
      orbitRadiusX: 51,
      orbitRadiusY: 38,
      handOffset: 52,
      nodeLift: '-26%',
    };
  }

  return {
    orbitCenterX: 50,
    orbitCenterY: 51,
    orbitRadiusX: 52,
    orbitRadiusY: 39,
    handOffset: 48,
    nodeLift: '-27%',
  };
}

export function PlayerCircle({
  game,
  loading,
  me,
  members,
  onAction,
  shouts = [],
  onShout,
  animOverlay,
  isSpectator = false,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  members?: RoomMemberView[];
  onAction: (action: GameAction) => Promise<void>;
  shouts?: ShoutEntry[];
  onShout?: (phrase: string, phraseEn: string) => void;
  animOverlay?: React.ReactNode;
  isSpectator?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const isRu = i18n.language !== 'en';
  const [shoutMenuOpen, setShoutMenuOpen] = useState(false);
  const [peekedCardUid, setPeekedCardUid] = useState<string | null>(null);

  // Track recently died players for death animation
  const [recentlyDied, setRecentlyDied] = useState<Set<number>>(new Set());
  const prevAliveRef = useRef<Record<number, boolean>>({});
  useEffect(() => {
    const newDead = new Set<number>();
    for (const p of game.players) {
      if (prevAliveRef.current[p.id] === true && !p.isAlive) {
        newDead.add(p.id);
      }
      prevAliveRef.current[p.id] = p.isAlive;
    }
    if (newDead.size > 0) {
      setRecentlyDied(prev => new Set([...prev, ...newDead]));
      // Clear animation after 2s
      setTimeout(() => {
        setRecentlyDied(prev => {
          const next = new Set(prev);
          for (const id of newDead) next.delete(id);
          return next;
        });
      }, 2000);
    }
  }, [game.players]);
  const [shoutMenuAnchor, setShoutMenuAnchor] = useState<{
    left: number; right: number; top: number; onRight: boolean;
  } | null>(null);
  const selfAvatarRef = useRef<HTMLDivElement>(null);

  // Speak new shouts aloud via Web Speech API
  const seenShoutsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of shouts) {
      const key = `${s.playerId}-${s.expiresAt}`;
      if (!seenShoutsRef.current.has(key)) {
        seenShoutsRef.current.add(key);
        speakShout(s.phrase, s.phraseEn, isRu, s.playerId);
      }
    }
    // Clean up old entries to prevent memory leak
    if (seenShoutsRef.current.size > 50) {
      const keys = [...seenShoutsRef.current];
      seenShoutsRef.current = new Set(keys.slice(-20));
    }
  }, [shouts, isRu]);

  const openShoutMenu = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (selfAvatarRef.current) {
      const rect = selfAvatarRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const onRight = centerX > window.innerWidth / 2;
      setShoutMenuAnchor({ left: rect.left, right: rect.right, top: rect.top, onRight });
    }
    setShoutMenuOpen(v => !v);
  }, []);
  const total = game.players.length;
  const current = getCurrentPlayer(game);
  const { orbitCenterX, orbitCenterY, orbitRadiusX, orbitRadiusY, handOffset, nodeLift } = getOrbitLayout(total);
  const circleStyle = {
    '--player-node-width':
      total >= 9
        ? 'clamp(4.9rem, 7.8vw, 5.9rem)'
        : total >= 8
          ? 'clamp(5.35rem, 8.4vw, 6.6rem)'
          : total >= 6
            ? 'clamp(5.9rem, 8.9vw, 7.55rem)'
            : 'clamp(6.45rem, 9.8vw, 8.85rem)',
    '--player-avatar-size':
      total >= 9
        ? 'clamp(3.1rem, 5.3dvh, 4.3rem)'
        : total >= 8
          ? 'clamp(3.45rem, 5.9dvh, 4.85rem)'
          : total >= 6
            ? 'clamp(3.85rem, 6.45dvh, 5.45rem)'
            : 'clamp(4.25rem, 7.6dvh, 6.5rem)',
    '--player-meta-min-width':
      total >= 8
        ? 'clamp(4.5rem, 6.4vw, 5.5rem)'
        : 'clamp(5.1rem, 7vw, 6.25rem)',
    '--player-meta-max-width':
      total >= 8
        ? 'clamp(5.25rem, 7.6vw, 6.35rem)'
        : 'clamp(6rem, 8.5vw, 8rem)',
    '--circle-core-size':
      total >= 8
        ? 'clamp(3.45rem, 6dvh, 4.6rem)'
        : 'clamp(4rem, 7.6dvh, 5.75rem)',
    '--orbit-hand-distance':
      total >= 9
        ? 'clamp(2.25rem, 4.3dvh, 3rem)'
        : total >= 8
          ? 'clamp(2.5rem, 4.8dvh, 3.25rem)'
          : 'clamp(2.85rem, 5.6dvh, 4rem)',
    '--opponent-card-width':
      total >= 9
        ? 'clamp(1rem, 1.55vw, 1.25rem)'
        : total >= 8
          ? 'clamp(1.1rem, 1.75vw, 1.45rem)'
          : 'clamp(1.25rem, 2.05vw, 1.8rem)',
  } as CSSProperties;
  const targetPending = game.pendingAction?.type === 'choose_target' || game.pendingAction?.type === 'panic_choose_target'
    ? game.pendingAction
    : null;
  const suspicionPending = game.pendingAction?.type === 'suspicion_pick'
    ? game.pendingAction
    : null;
  const canSelectSuspicionCard = suspicionPending?.viewerPlayerId === me.id;


  return (
    <div className="player-circle" style={circleStyle}>
      {game.players.map((player) => {
        const safePos = typeof player.position === 'number' ? player.position : 0;
        const angle = (safePos / (total || 1)) * 360 - 90;
        const radians = (angle * Math.PI) / 180;
        const x = orbitCenterX + orbitRadiusX * Math.cos(radians);
        const topSeatOffset = Math.sin(radians) < -0.96 ? -4 : 0;
        const y = orbitCenterY + orbitRadiusY * Math.sin(radians) + topSeatOffset;
        const isUpperSeat = Math.sin(radians) < -0.12;
        const isLowerSeat = Math.sin(radians) > 0.96;
        const isLeftSeat = Math.cos(radians) < -0.28;
        const isRightSeat = Math.cos(radians) > 0.28;
        const isCurrent = current != null && player.id === current.id;
        const isSelf = player.id === me.id;
        const isDisconnected = members?.some(m => m.playerId === player.id && !m.connected) ?? false;
        const isTargetable = targetPending?.targets.includes(player.id) ?? false;
        const resolvedAvatarId = player.avatarId || PLAYER_AVATAR_IDS[player.id % PLAYER_AVATAR_IDS.length];
        if (!player.avatarId) {
          console.warn(`[PlayerCircle] player "${player.name}" (id=${player.id}) has no avatarId, using fallback "${resolvedAvatarId}"`);
        }
        const avatarSrc = getPlayerAvatarSrc(resolvedAvatarId);
        const avatarPresentation = getPlayerAvatarPresentation(resolvedAvatarId);
        const avatarFallback = player.name.trim().slice(0, 2).toUpperCase();
        const previewCount =
          suspicionPending?.targetPlayerId === player.id &&
          suspicionPending.selectableCardUids.length === player.handCount
            ? player.handCount
            : Math.min(player.handCount, 8);
        const fanMid = (previewCount - 1) / 2;
        const publicCardKeys =
          suspicionPending?.targetPlayerId === player.id &&
          suspicionPending.selectableCardUids.length === player.handCount
            ? suspicionPending.selectableCardUids
            : Array.from({ length: previewCount }, (_, idx) => `${player.id}-back-${idx}`);
        const isSuspicionTarget = suspicionPending?.targetPlayerId === player.id;
        const canPickFromFan = !isSelf && isSuspicionTarget && canSelectSuspicionCard;
        const sideBlend = Math.abs(Math.cos(radians));
        const effectiveHandOffset = handOffset * (1 - sideBlend * 0.28);
        const opponentHandStyle = {
          '--hand-offset-x': `${(-Math.cos(radians) * effectiveHandOffset).toFixed(1)}px`,
          '--hand-offset-y': `${(-Math.sin(radians) * effectiveHandOffset).toFixed(1)}px`,
          '--hand-rotation': `${angle + 270}deg`,
          '--hand-vector-x': (-Math.cos(radians)).toFixed(4),
          '--hand-vector-y': (-Math.sin(radians)).toFixed(4),
          '--fan-width': `${Math.max(2.6, 2.4 + (isSpectator ? player.hand.length : previewCount) * (isSpectator ? 1.1 : 0.82)).toFixed(2)}rem`,
        } as CSSProperties;
        const selectTarget = () => {
          if (!isTargetable || loading || !targetPending) return;
          void onAction(
            targetPending.type === 'panic_choose_target'
              ? { type: 'PANIC_SELECT_TARGET', targetPlayerId: player.id }
              : { type: 'SELECT_TARGET', targetPlayerId: player.id },
          );
        };

        const activeShout = shouts.find(s => s.playerId === player.id);
        const shoutLabel = activeShout ? (isRu ? activeShout.phrase : activeShout.phraseEn) : null;
        const isDying = recentlyDied.has(player.id);

        return (
          <motion.div
            className={`player-node ${isCurrent ? 'active' : ''} ${isSelf ? 'self' : ''} ${player.isAlive ? '' : 'dead'} ${isDying ? 'dying' : ''} ${isDisconnected ? 'disconnected' : ''} ${isTargetable ? 'is-targetable' : ''} ${isUpperSeat ? 'is-upper-seat' : ''} ${isLowerSeat ? 'is-lower-seat' : ''} ${isLeftSeat ? 'is-left-seat' : ''} ${isRightSeat ? 'is-right-seat' : ''} ${isSelf && shoutMenuOpen ? 'shout-open' : ''} ${activeShout ? 'has-shout' : ''}`}
            key={player.id}
            style={{ left: `${x}%`, top: `${y}%`, x: '-50%', y: nodeLift }}
            animate={isCurrent ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={isCurrent ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
            onClick={selectTarget}
            onKeyDown={(event) => {
              if (!isTargetable) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectTarget();
              }
            }}
            role={isTargetable ? 'button' : undefined}
            tabIndex={isTargetable ? 0 : undefined}
          >
            {!isSelf && previewCount > 0 && (
              <div className={`player-opponent-hand ${canPickFromFan ? 'is-suspicion-selectable' : ''} ${isSpectator && player.hand.length > 0 ? 'spectator-hand' : ''}`} style={opponentHandStyle}>
                <div className="opponent-hand-fan" aria-hidden={canPickFromFan ? undefined : true}>
                  {isSpectator && player.hand.length > 0
                    ? player.hand.map((card, idx) => {
                        const fm = (player.hand.length - 1) / 2;
                        const isPeeked = peekedCardUid === card.uid;
                        return (
                          <div
                            className={`opponent-card-slot spectator-card-slot ${isPeeked ? 'is-peeked' : ''}`}
                            key={card.uid}
                            style={{
                              '--card-shift': `${((idx - fm) * 0.9).toFixed(2)}rem`,
                              '--card-tilt': isPeeked ? '0deg' : `${(idx - fm) * 5}deg`,
                              '--card-depth': `${(Math.abs(idx - fm) * 0.08).toFixed(2)}rem`,
                            } as CSSProperties}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPeekedCardUid(prev => prev === card.uid ? null : card.uid);
                            }}
                          >
                            <div className="spectator-mini-card">
                              <CardView card={card} faceUp />
                            </div>
                          </div>
                        );
                      })
                    : publicCardKeys.slice(0, previewCount).map((cardKey, idx) => (
                    <div
                      className={`opponent-card-slot ${suspicionPending?.targetPlayerId === player.id && suspicionPending.previewCardUid === cardKey ? 'previewed' : ''}`}
                      key={`${player.id}-card-back-${cardKey}`}
                      style={{
                        '--card-shift': `${((idx - fanMid) * 0.6).toFixed(2)}rem`,
                        '--card-tilt': `${(idx - fanMid) * 7}deg`,
                        '--card-depth': `${(Math.abs(idx - fanMid) * 0.1).toFixed(2)}rem`,
                      } as CSSProperties}
                    >
                      <button
                        aria-label={t('suspicion.pickCard', { index: idx + 1 })}
                        aria-pressed={suspicionPending?.targetPlayerId === player.id && suspicionPending.previewCardUid === cardKey}
                        className={`opponent-card-back ${suspicionPending?.targetPlayerId === player.id && suspicionPending.previewCardUid === cardKey ? 'previewed' : ''} ${canPickFromFan ? 'is-selectable' : ''}`}
                        disabled={!canPickFromFan || loading}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!canPickFromFan || loading) return;
                          void onAction({ type: 'SUSPICION_PREVIEW_CARD', cardUid: cardKey });
                        }}
                        type="button"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div
              ref={isSelf ? selfAvatarRef : undefined}
              className={`player-avatar${isSelf ? ' player-avatar--self' : ''}`}
              onClick={isSelf && me.isAlive ? openShoutMenu : undefined}
              role={isSelf && me.isAlive ? 'button' : undefined}
              tabIndex={isSelf && me.isAlive ? 0 : undefined}
              onKeyDown={isSelf && me.isAlive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShoutMenu(e); } } : undefined}
              aria-label={isSelf && me.isAlive ? t('shout.openMenu', 'Выкрик') : undefined}
            >
              {avatarSrc ? (
                <img
                  alt={player.name}
                  className="player-avatar-image"
                  src={avatarSrc}
                  style={{
                    '--avatar-scale': avatarPresentation.scale,
                    '--avatar-position': avatarPresentation.position,
                  } as CSSProperties}
                />
              ) : (
                <span className="player-avatar-fallback">{avatarFallback}</span>
              )}
              {player.inQuarantine && (
                <img
                  alt=""
                  aria-hidden="true"
                  className="player-avatar-quarantine-overlay"
                  src={quarantineOverlay}
                />
              )}
              {!isSpectator && (player.role === 'thing' || (me.role === 'infected' && player.canReceiveInfectedCardFromMe)) && (
                <img
                  alt=""
                  aria-hidden="true"
                  className="player-avatar-thing-overlay"
                  src={thingOverlay}
                />
              )}
              {!isSpectator && player.isKnownInfectedToMe && (
                <img
                  alt=""
                  aria-hidden="true"
                  className="player-avatar-infected-overlay"
                  src={infectedOverlay}
                />
              )}

              {/* Speech bubble visible to all */}
              <AnimatePresence>
                {shoutLabel && (
                  <motion.div
                    className="shout-bubble"
                    key={shoutLabel}
                    initial={{ opacity: 0, y: 6, scale: 0.85 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.85 }}
                    transition={{ duration: 0.2 }}
                  >
                    {shoutLabel}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="player-meta">
              <strong>{player.name}</strong>
              {isSpectator && player.role && (
                <span className={`spectator-role role-${player.role}`}>
                  {player.role === 'thing' ? (isRu ? 'Нечто' : 'Thing')
                    : player.role === 'infected' ? (isRu ? 'Заражён' : 'Infected')
                    : (isRu ? 'Человек' : 'Human')}
                </span>
              )}
            </div>
            {player.inQuarantine && (
              <div className="token quarantine">Q{player.quarantineTurnsLeft}</div>
            )}
            {!player.isAlive && (
              <motion.div
                className="token dead"
                initial={isDying ? { scale: 3, opacity: 0, rotate: -45 } : false}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              >
                ✗
              </motion.div>
            )}

          </motion.div>
        );
      })}

      {game.doors.map((door, index) => {
        const first = game.players.find((p) => p.position === door.between[0]);
        const second = game.players.find((p) => p.position === door.between[1]);
        if (!first || !second || !hasDoorBetween(game as unknown as import('../../types.ts').GameState, first.position, second.position)) return null;

        const a1 = (first.position / total) * 360 - 90;
        const a2 = (second.position / total) * 360 - 90;
        // Use shortest arc midpoint so the marker sits between adjacent players
        let diff = a2 - a1;
        // Normalize diff to [-180, 180]
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const mid = a1 + diff / 2;
        const midRadians = (mid * Math.PI) / 180;
        const x = orbitCenterX + orbitRadiusX * Math.cos(midRadians);
        const y = orbitCenterY + orbitRadiusY * Math.sin(midRadians);

        return (
          <div
            className="door-marker"
            key={`${door.between.join('-')}-${index}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className="door-marker-card" aria-hidden="true">
              <CardView card={LOCKED_DOOR_MARKER_CARD} faceUp />
            </div>
          </div>
        );
      })}

      <div className="circle-core" style={{ left: `${orbitCenterX}%`, top: `${orbitCenterY}%` }}>
        <strong>{game.direction === 1 ? '↻' : '↺'}</strong>
        <span>{t('panel.direction')}</span>
      </div>

      <TableDecks game={game} orbitCenterX={orbitCenterX} orbitCenterY={orbitCenterY} />

      <TableAnimationBoundary game={game} />
      {animOverlay}

      {/* Shout menu — always portal into document.body to escape all transform ancestors.
          Mobile: centred at bottom. Desktop: anchored next to the avatar via fixed coords. */}
      {shoutMenuOpen && shoutMenuAnchor && createPortal(
        <>
          {/* Backdrop — closes menu on outside click */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setShoutMenuOpen(false)}
          />
          <AnimatePresence>
            <div
              className="shout-menu-portal"
              style={window.innerWidth > 768 ? {
                // Desktop: align top of menu to top of avatar, beside it left/right
                top: `${shoutMenuAnchor.top}px`,
                bottom: 'auto',
                transform: 'none',
                ...(shoutMenuAnchor.onRight
                  ? { right: `${window.innerWidth - shoutMenuAnchor.left + 8}px`, left: 'auto' }
                  : { left: `${shoutMenuAnchor.right + 8}px`, right: 'auto' }),
              } : undefined}
              onClick={e => e.stopPropagation()}
            >
              <motion.div
                className="shout-menu"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.13 }}
              >
                {SHOUT_PHRASES.map((p) => (
                  <button
                    key={p.ru}
                    className="shout-menu-item"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShoutMenuOpen(false);
                      onShout?.(p.ru, p.en);
                    }}
                  >
                    {isRu ? p.ru : p.en}
                  </button>
                ))}
              </motion.div>
            </div>
          </AnimatePresence>
        </>,
        document.body,
      )}
    </div>
  );
}
