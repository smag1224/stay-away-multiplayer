import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { hasDoorBetween } from '../../gameLogic.ts';
import { getCurrentPlayer } from '../../appHelpers.ts';
import type { RoomMemberView, ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction } from '../../types.ts';
import { getPlayerAvatarPresentation, getPlayerAvatarSrc } from '../../playerAvatarImages.ts';
import { PLAYER_AVATAR_IDS } from '../../avatarCatalog.ts';
import { TableAnimationBoundary } from './TableAnimationBoundary.tsx';

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
      handOffset: 61,
      nodeLift: '-25%',
    };
  }

  if (total <= 8) {
    return {
      orbitCenterX: 50,
      orbitCenterY: 52,
      orbitRadiusX: 51,
      orbitRadiusY: 38,
      handOffset: 62,
      nodeLift: '-26%',
    };
  }

  return {
    orbitCenterX: 50,
    orbitCenterY: 51,
    orbitRadiusX: 52,
    orbitRadiusY: 39,
    handOffset: 64,
    nodeLift: '-27%',
  };
}

export function PlayerCircle({
  game,
  loading,
  me,
  members,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  members?: RoomMemberView[];
  onAction: (action: GameAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const total = game.players.length;
  const current = getCurrentPlayer(game);
  const { orbitCenterX, orbitCenterY, orbitRadiusX, orbitRadiusY, handOffset, nodeLift } = getOrbitLayout(total);
  const targetPending = game.pendingAction?.type === 'choose_target' || game.pendingAction?.type === 'panic_choose_target'
    ? game.pendingAction
    : null;
  const suspicionPending = game.pendingAction?.type === 'suspicion_pick'
    ? game.pendingAction
    : null;
  const canSelectSuspicionCard = suspicionPending?.viewerPlayerId === me.id;

  return (
    <div className="player-circle">
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
        const opponentHandStyle = {
          '--hand-rotation': `${angle + 270}deg`,
          '--hand-offset-x': `${-Math.cos(radians) * handOffset}px`,
          '--hand-offset-y': `${-Math.sin(radians) * handOffset}px`,
          '--fan-width': `${72 + previewCount * 16}px`,
        } as CSSProperties;
        const selectTarget = () => {
          if (!isTargetable || loading || !targetPending) return;
          void onAction(
            targetPending.type === 'panic_choose_target'
              ? { type: 'PANIC_SELECT_TARGET', targetPlayerId: player.id }
              : { type: 'SELECT_TARGET', targetPlayerId: player.id },
          );
        };

        return (
          <motion.div
            className={`player-node ${isCurrent ? 'active' : ''} ${isSelf ? 'self' : ''} ${player.isAlive ? '' : 'dead'} ${isDisconnected ? 'disconnected' : ''} ${isTargetable ? 'is-targetable' : ''} ${isUpperSeat ? 'is-upper-seat' : ''} ${isLowerSeat ? 'is-lower-seat' : ''} ${isLeftSeat ? 'is-left-seat' : ''} ${isRightSeat ? 'is-right-seat' : ''}`}
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
              <div className={`player-opponent-hand ${canPickFromFan ? 'is-suspicion-selectable' : ''}`} style={opponentHandStyle}>
                <div className="opponent-hand-fan" aria-hidden={canPickFromFan ? undefined : true}>
                  {publicCardKeys.slice(0, previewCount).map((cardKey, idx) => (
                    <div
                      className={`opponent-card-slot ${suspicionPending?.targetPlayerId === player.id && suspicionPending.previewCardUid === cardKey ? 'previewed' : ''}`}
                      key={`${player.id}-card-back-${cardKey}`}
                      style={{
                        '--card-shift': `${(idx - fanMid) * 10}px`,
                        '--card-tilt': `${(idx - fanMid) * 7}deg`,
                        '--card-depth': `${Math.abs(idx - fanMid) * 1.5}px`,
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
            <div className="player-avatar">
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
            </div>
            <div className="player-meta">
              <strong>{player.name}</strong>
            </div>
            {player.inQuarantine && (
              <div className="token quarantine">Q{player.quarantineTurnsLeft}</div>
            )}
            {!player.isAlive && <div className="token dead">✗</div>}
          </motion.div>
        );
      })}

      {game.doors.map((door, index) => {
        const first = game.players.find((p) => p.position === door.between[0]);
        const second = game.players.find((p) => p.position === door.between[1]);
        if (!first || !second || !hasDoorBetween(game as unknown as import('../../types.ts').GameState, first.position, second.position)) return null;

        const a1 = (first.position / total) * 360 - 90;
        const a2 = (second.position / total) * 360 - 90;
        const mid = (a1 + a2) / 2;
        const midRadians = (mid * Math.PI) / 180;
        const x = orbitCenterX + orbitRadiusX * Math.cos(midRadians);
        const y = orbitCenterY + orbitRadiusY * Math.sin(midRadians);

        return (
          <div
            className="door-marker"
            key={`${door.between.join('-')}-${index}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            {'🚪'}
          </div>
        );
      })}

      <div className="circle-core" style={{ left: `${orbitCenterX}%`, top: `${orbitCenterY}%` }}>
        <strong>{game.direction === 1 ? '↻' : '↺'}</strong>
        <span>{t('panel.direction')}</span>
      </div>

      <TableAnimationBoundary game={game} />
    </div>
  );
}
