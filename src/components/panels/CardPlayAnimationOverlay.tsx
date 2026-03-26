import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ViewerGameState } from '../../multiplayer.ts';
import { playFlamethrowerSound } from '../../sounds/flamethrower.ts';
import { playAnalysisSound } from '../../sounds/analysis.ts';

export interface CardAnimTrigger {
  key: number;
  cardDefId: string;
  fromPlayerId: number;
  toPlayerId: number;
}

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
  const radians = (angle * Math.PI) / 180;
  const topSeatOffset = Math.sin(radians) < -0.96 ? -4 : 0;
  // The player node has a Framer Motion y: nodeLift (~-24% of node height) transform,
  // which shifts the visual avatar center DOWN relative to the CSS top position.
  // +1 compensates so animations target the actual avatar center.
  return {
    x: cx + rx * Math.cos(radians),
    y: cy + ry * Math.sin(radians) + topSeatOffset + 1,
  };
}

/* ------------------------------------------------------------------ */
/*  Flamethrower – video effect rotated toward target                  */
/* ------------------------------------------------------------------ */

function FlamethrowerAnimation({
  from, to, triggerKey, onDone,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  triggerKey: number;
  onDone: () => void;
}) {
  const TOTAL = 4;

  // Container uses a real pixel size for correct aspect ratio.
  // The video is horizontal (wider than tall), so width = distance between players,
  // anchored at `from`, rotated to face `to`.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Angle in degrees: video points right by default → rotate to face target
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  // Width as % of container to roughly span from→to (plus a bit of overshoot)
  const dist = Math.sqrt(dx * dx + dy * dy);
  const widthPct = dist * 1.5; // 150% of distance so flame overshoots target

  // Play sound
  useEffect(() => {
    const stop = playFlamethrowerSound(TOTAL);
    return stop;
  }, [triggerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Video rotated from `from` toward `to` */}
      <motion.div
        key={triggerKey}
        style={{
          position: 'absolute',
          left: `${from.x}%`,
          top: `${from.y}%`,
          width: `${widthPct}%`,
          aspectRatio: '16 / 9',
          // Anchor left-center so flame origin is at player position
          transform: `translate(0%, -50%) rotate(${angleDeg}deg)`,
          transformOrigin: '0% 50%',
          pointerEvents: 'none',
          zIndex: 25,
          mixBlendMode: 'screen',
        }}
        initial={{ opacity: 0, scaleX: 0.2 }}
        animate={{ opacity: [0, 1, 1, 0.7, 0], scaleX: [0.2, 1.05, 1, 1, 0.9] }}
        transition={{ duration: TOTAL, times: [0, 0.06, 0.3, 0.8, 1] }}
        onAnimationComplete={onDone}
      >
        <video
          src="/effects/flamethrower.mp4"
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        />
      </motion.div>

      {/* Burn glow on target */}
      <motion.div
        style={{
          position: 'absolute',
          left: `${to.x}%`,
          top: `${to.y}%`,
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,120,0,0.5), rgba(255,50,0,0.15) 50%, transparent 70%)',
          marginLeft: -40,
          marginTop: -40,
          pointerEvents: 'none',
          zIndex: 24,
        }}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: [0, 0.9, 1, 0.8, 0], scale: [0.4, 1.3, 1.1, 1.4, 0.5] }}
        transition={{ duration: TOTAL, times: [0, 0.15, 0.5, 0.85, 1] }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Analysis – 5-second green scan beam sweeping the target icon       */
/* ------------------------------------------------------------------ */

function AnalysisScanAnimation({
  from, to, triggerKey, onDone,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  triggerKey: number;
  onDone: () => void;
}) {
  const TOTAL = 5;
  const SWEEP_DURATION = 1.6;  // one bottom→top sweep
  const SWEEPS = 3;
  const SCAN_HALF = 6;         // ±6% vertical range around target (fits avatar circle)
  const SCAN_WIDTH = 17;       // % horizontal width of scan line (covers full avatar)
  const DATA_PARTICLE_COUNT = 20;

  // Play scanner sound
  useEffect(() => {
    const stop = playAnalysisSound(TOTAL);
    return stop;
  }, [triggerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterId = `scan-glow-${triggerKey}`;
  const pathD = `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;

  // Small "data" particles that appear around the target during scanning
  const dataParticles = useMemo(() =>
    Array.from({ length: DATA_PARTICLE_COUNT }).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 3;
      return {
        cx: to.x + Math.cos(angle) * r,
        cy: to.y + Math.sin(angle) * r,
        driftY: -(1 + Math.random() * 2),
        startDelay: 0.8 + Math.random() * 3.5,
        size: 3 + Math.random() * 5,
        duration: 0.6 + Math.random() * 0.5,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [triggerKey],
  );

  return (
    <>
      {/* SVG: quick green beam from attacker → target */}
      <svg
        className="card-play-anim-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id={filterId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <motion.path
          d={pathD}
          stroke="rgba(0,220,80,0.6)"
          strokeWidth={0.8}
          fill="none"
          vectorEffect="non-scaling-stroke"
          filter={`url(#${filterId})`}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0, 0.9, 0.9, 0] }}
          transition={{ duration: 0.6, times: [0, 0.1, 0.7, 1] }}
        />
      </svg>

      {/* Green glow overlay on target — pulses for entire duration */}
      <motion.div
        style={{
          position: 'absolute',
          left: `${to.x}%`,
          top: `${to.y}%`,
          width: 70,
          height: 70,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,220,80,0.2), rgba(0,180,60,0.08) 50%, transparent 70%)',
          marginLeft: -35,
          marginTop: -35,
          pointerEvents: 'none',
          zIndex: 20,
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0.7, 0.8, 0.7, 0], scale: [0.6, 1, 1.05, 1, 0.6] }}
        transition={{ duration: TOTAL, times: [0, 0.12, 0.5, 0.85, 1] }}
      />

      {/* Scan line — sweeps bottom→top, repeats */}
      <motion.div
        style={{
          position: 'absolute',
          left: `${to.x - SCAN_WIDTH / 2}%`,
          width: `${SCAN_WIDTH}%`,
          height: 4,
          borderRadius: 3,
          background: 'linear-gradient(90deg, transparent, rgba(0,255,100,0.9) 20%, rgba(0,255,100,1) 50%, rgba(0,255,100,0.9) 80%, transparent)',
          boxShadow: '0 0 12px 4px rgba(0,220,80,0.5), 0 0 30px 8px rgba(0,200,60,0.2)',
          pointerEvents: 'none',
          zIndex: 22,
        }}
        initial={{ top: `${to.y + SCAN_HALF}%`, opacity: 0 }}
        animate={{
          top: [`${to.y + SCAN_HALF}%`, `${to.y - SCAN_HALF}%`],
          opacity: [0, 1, 1, 0.8],
        }}
        transition={{
          duration: SWEEP_DURATION,
          delay: 0.5,
          repeat: SWEEPS - 1,
          repeatType: 'loop',
          repeatDelay: 0.15,
          ease: 'linear',
          opacity: { times: [0, 0.05, 0.85, 1] },
        }}
      />

      {/* Scan edge lines (left/right brackets) */}
      {[-1, 1].map((side) => (
        <motion.div
          key={`edge-${side}`}
          style={{
            position: 'absolute',
            left: `${to.x + (side * SCAN_WIDTH) / 2}%`,
            width: 2,
            pointerEvents: 'none',
            zIndex: 22,
            background: 'rgba(0,255,100,0.35)',
            boxShadow: '0 0 6px 2px rgba(0,220,80,0.3)',
            marginLeft: side === -1 ? -1 : 0,
          }}
          initial={{ top: `${to.y - SCAN_HALF}%`, height: 0, opacity: 0 }}
          animate={{
            height: `${SCAN_HALF * 2}%`,
            opacity: [0, 0.6, 0.6, 0],
          }}
          transition={{
            duration: TOTAL,
            times: [0, 0.12, 0.85, 1],
            height: { duration: 0.4, delay: 0.4 },
          }}
        />
      ))}

      {/* Data particles floating up from target */}
      {dataParticles.map((p, i) => (
        <motion.div
          key={`d-${triggerKey}-${i}`}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.size,
            borderRadius: 1,
            background: '#00ff66',
            boxShadow: '0 0 4px 1px rgba(0,255,100,0.4)',
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            pointerEvents: 'none',
            zIndex: 21,
          }}
          initial={{ left: `${p.cx}%`, top: `${p.cy}%`, opacity: 0 }}
          animate={{
            top: `${p.cy + p.driftY}%`,
            opacity: [0, 0.8, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.startDelay,
            ease: 'easeOut',
            opacity: { times: [0, 0.3, 1] },
          }}
        />
      ))}

      {/* Timer element that fires onDone at the end — values must differ so FM animates */}
      <motion.div
        style={{ position: 'absolute', pointerEvents: 'none', width: 0, height: 0 }}
        initial={{ x: 0 }}
        animate={{ x: 1 }}
        transition={{ duration: TOTAL }}
        onAnimationComplete={onDone}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Generic beam animation (suspicion, swap_places, etc.)              */
/* ------------------------------------------------------------------ */

interface AnimConfig {
  beamColor: string;
  beamWidth: number;
  particleColor: string;
  glowColor: string;
  burstColor: string;
  particleCount: number;
  duration: number;
}

function getAnimConfig(cardDefId: string): AnimConfig {
  switch (cardDefId) {
    case 'suspicion':
      return {
        beamColor: 'rgba(255, 215, 0, 0.55)',
        beamWidth: 0.6,
        particleColor: '#ffd700',
        glowColor: '#cc8800',
        burstColor: 'rgba(255, 200, 0, 0.8)',
        particleCount: 4,
        duration: 0.58,
      };
    case 'swap_places':
    case 'you_better_run':
      return {
        beamColor: 'rgba(140, 100, 255, 0.65)',
        beamWidth: 0.7,
        particleColor: '#aa88ff',
        glowColor: '#6644cc',
        burstColor: 'rgba(130, 100, 255, 0.8)',
        particleCount: 5,
        duration: 0.60,
      };
    default:
      return {
        beamColor: 'rgba(180, 180, 255, 0.55)',
        beamWidth: 0.6,
        particleColor: '#aaaaff',
        glowColor: '#6666cc',
        burstColor: 'rgba(160, 160, 255, 0.75)',
        particleCount: 5,
        duration: 0.60,
      };
  }
}

function GenericBeamAnimation({
  from, to, triggerKey, cardDefId, onDone,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  triggerKey: number;
  cardDefId: string;
  onDone: () => void;
}) {
  const cfg = getAnimConfig(cardDefId);
  const pathD = `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  const filterId = `cpa-glow-${triggerKey}`;

  return (
    <>
      <svg
        className="card-play-anim-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id={filterId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <motion.path
          d={pathD}
          stroke={cfg.beamColor}
          strokeWidth={cfg.beamWidth}
          fill="none"
          vectorEffect="non-scaling-stroke"
          filter={`url(#${filterId})`}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0, 1, 1, 0] }}
          transition={{ duration: cfg.duration, times: [0, 0.06, 0.78, 1] }}
        />
      </svg>

      {Array.from({ length: cfg.particleCount }).map((_, i) => {
        const delay = i * (cfg.duration * 0.08);
        const wobbleX = Math.sin(i * 2.4) * 1.2;
        const wobbleY = Math.cos(i * 2.4) * 1.2;
        return (
          <motion.div
            key={`p-${triggerKey}-${i}`}
            style={{
              position: 'absolute',
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: cfg.particleColor,
              boxShadow: `0 0 10px 3px ${cfg.glowColor}`,
              marginLeft: -6,
              marginTop: -6,
              pointerEvents: 'none',
              zIndex: 21,
            }}
            initial={{ left: `${from.x}%`, top: `${from.y}%`, opacity: 1, scale: 1 }}
            animate={{
              left: `${to.x + wobbleX}%`,
              top: `${to.y + wobbleY}%`,
              opacity: [1, 1, 0],
              scale: [1, 0.85, 0.1],
            }}
            transition={{
              duration: cfg.duration * 0.88,
              delay,
              ease: [0.3, 0, 0.75, 1],
              opacity: { times: [0, 0.55, 1] },
              scale: { times: [0, 0.55, 1] },
            }}
          />
        );
      })}

      <motion.div
        style={{
          position: 'absolute',
          left: `${to.x}%`,
          top: `${to.y}%`,
          borderRadius: '50%',
          border: `2px solid ${cfg.burstColor}`,
          boxShadow: `0 0 12px 4px ${cfg.glowColor}`,
          marginLeft: -6,
          marginTop: -6,
          pointerEvents: 'none',
          zIndex: 21,
        }}
        initial={{ width: 12, height: 12, opacity: 1 }}
        animate={{ width: 80, height: 80, opacity: 0, marginLeft: -40, marginTop: -40 }}
        transition={{ duration: 0.45, delay: cfg.duration * 0.78, ease: 'easeOut' }}
        onAnimationComplete={onDone}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Whiskey – video effect poured over target avatar                   */
/* ------------------------------------------------------------------ */

function WhiskeyAnimation({
  to, triggerKey, onDone,
}: {
  to: { x: number; y: number };
  triggerKey: number;
  onDone: () => void;
}) {
  const SIZE = 38; // % of container — covers avatar nicely

  return (
    <motion.div
      key={triggerKey}
      style={{
        position: 'absolute',
        left: `${to.x}%`,
        top: `${to.y}%`,
        width: `${SIZE}%`,
        aspectRatio: '1 / 1',
        transform: 'translate(-50%, -58%)',
        pointerEvents: 'none',
        zIndex: 25,
        mixBlendMode: 'screen', // black bg becomes transparent
        borderRadius: '50%',
        overflow: 'hidden',
      }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: [0, 1, 1, 0.6, 0], scale: [0.7, 1.1, 1.05, 1, 0.9] }}
      transition={{ duration: 3.5, times: [0, 0.08, 0.6, 0.85, 1] }}
      onAnimationComplete={onDone}
    >
      <video
        src="/effects/whiskey.mp4"
        autoPlay
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main overlay – routes to the right animation                       */
/* ------------------------------------------------------------------ */

export function CardPlayAnimationOverlay({
  trigger,
  game,
  onDone,
}: {
  trigger: CardAnimTrigger | null;
  game: ViewerGameState;
  onDone: () => void;
}) {
  if (!trigger) return null;

  const total = game.players.length;
  const fromPlayer = game.players.find((p) => p.id === trigger.fromPlayerId);
  const toPlayer = game.players.find((p) => p.id === trigger.toPlayerId);
  if (!fromPlayer || !toPlayer) return null;

  const from = getPlayerPos(fromPlayer.position, total);
  const to = getPlayerPos(toPlayer.position, total);

  // No animation for infected
  if (trigger.cardDefId === 'infected') {
    onDone();
    return null;
  }

  if (trigger.cardDefId === 'flamethrower') {
    return (
      <FlamethrowerAnimation
        from={from}
        to={to}
        triggerKey={trigger.key}
        onDone={onDone}
      />
    );
  }

  if (trigger.cardDefId === 'analysis') {
    return (
      <AnalysisScanAnimation
        from={from}
        to={to}
        triggerKey={trigger.key}
        onDone={onDone}
      />
    );
  }

  if (trigger.cardDefId === 'whisky') {
    return (
      <WhiskeyAnimation
        to={to}
        triggerKey={trigger.key}
        onDone={onDone}
      />
    );
  }

  return (
    <GenericBeamAnimation
      from={from}
      to={to}
      triggerKey={trigger.key}
      cardDefId={trigger.cardDefId}
      onDone={onDone}
    />
  );
}
