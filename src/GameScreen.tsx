import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { getCardName, getCardDescription } from './cards.ts';
import type { RoomView, ViewerGameState, ViewerPlayerState } from './multiplayer.ts';
import type { GameAction } from './types.ts';
import {
  extractPendingOwner,
  getCurrentPlayer,
  pendingSummary,
  roleLabel,
  stepLabel,
} from './appHelpers.ts';
import type { Lang } from './appHelpers.ts';
import { useTurnSound } from './useTurnSound.ts';
import { ShowCardTextCtx } from './components/panels/ShowCardTextCtx.ts';
import { TopBar } from './components/panels/TopBar.tsx';
import { PlayerCircle } from './components/panels/PlayerCircle.tsx';
import { PendingActionPanel } from './components/panels/PendingActionPanel.tsx';
import { hasRenderablePendingActionPanel } from './components/panels/pendingActionVisibility.ts';
import { PlayerHand } from './components/panels/PlayerHand.tsx';

export function GameScreen({
  error,
  game,
  loading,
  me,
  onToggleLang,
  room,
  onAction,
  onCopy,
  onLeave,
  onReset,
}: {
  error: string | null;
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  onToggleLang: () => void;
  room: RoomView;
  onAction: (action: GameAction) => Promise<void>;
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onReset: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ru';
  const [showCardText, setShowCardText] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // Hook must be called unconditionally (before any early return)
  const currentSafe = getCurrentPlayer(game);
  useTurnSound((currentSafe?.id ?? -1) === me.id && game.phase === 'playing');

  /* ── GAME OVER ─────────────────────────────────────────────── */
  if (game.phase === 'game_over') {
    return (
      <main className="game-screen">
        <TopBar lang={lang} room={room} onCopy={onCopy} onLeave={onLeave} onToggleLang={onToggleLang} />
        <div className="game-over-body">
          <div className="game-over-inner panel">
            <h2 className="hero-title small">{t('game.matchFinished')}</h2>
            <p className={`winner-line ${game.winner === 'humans' ? 'human-win' : 'thing-win'}`}>
              {game.winner === 'humans'
                ? t('game.humansWin')
                : game.winner === 'thing_solo'
                  ? t('game.thingWinsAlone')
                  : t('game.thingWins')}
            </p>
            <div className="results-grid">
              {game.players.map((player, i) => (
                <motion.div
                  className={`result-card ${game.winnerPlayerIds.includes(player.id) ? 'winner' : ''}`}
                  key={player.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.4 }}>
                  <strong>{player.name}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{roleLabel(player.role, lang)}</span>
                  <span style={{ fontSize: '.76rem', color: player.isAlive ? 'var(--accent-strong)' : 'var(--danger-strong)' }}>
                    {player.isAlive ? t('game.alive') : t('game.eliminated')}
                  </span>
                </motion.div>
              ))}
            </div>
            <div className="stack-actions">
              {room.me.isHost && (
                <button className="btn primary" disabled={loading} onClick={() => void onReset()} type="button">
                  {t('game.newMatch')}
                </button>
              )}
              {!room.me.isHost && (
                <p className="helper-text">{t('game.hostReturnLobby')}</p>
              )}
              {error && <p className="error-text">{error}</p>}
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ── IN GAME ───────────────────────────────────────────────── */
  const current = getCurrentPlayer(game);
  const myTurn = (current?.id ?? -1) === me.id;
  const summary = pendingSummary(game.pendingAction, game, lang);
  const pendingOwnerId = extractPendingOwner(game.pendingAction);
  const pendingOwnerName = pendingOwnerId === null
    ? null
    : game.players.find((p) => p.id === pendingOwnerId)?.name ?? null;
  const showPendingPanel = hasRenderablePendingActionPanel(game.pendingAction, me.id);
  const visibleLog = game.log.slice(0, logOpen ? 16 : 6);

  return (
    <ShowCardTextCtx.Provider value={showCardText}>
    <main className="game-screen">
      <TopBar
        lang={lang}
        onCopy={onCopy}
        deckCount={game.deck.length}
        onLeave={onLeave}
        mobileQuickActionLabel={myTurn && me.role === 'thing' && game.step !== 'draw' ? t('game.declareVictory') : undefined}
        onMobileQuickAction={myTurn && me.role === 'thing' && game.step !== 'draw'
          ? () => { void onAction({ type: 'DECLARE_VICTORY' }); }
          : undefined}
        onToggleLang={onToggleLang}
        onToggleText={() => setShowCardText(v => !v)}
        room={room}
        showCardText={showCardText}
      />

      <AnimatePresence>
      {game.panicAnnouncement && (
        <motion.div className="panic-banner"
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
          <div className="panic-banner-icon">⚠</div>
          <div className="panic-banner-content">
            <strong>{t('game.panic')}</strong>
            <span className="panic-banner-name">{getCardName(game.panicAnnouncement, lang)}</span>
            <p className="panic-banner-desc">{getCardDescription(game.panicAnnouncement, lang)}</p>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {me.role === 'infected' && (
        <motion.div
          className="infected-alert"
          initial={{ opacity: 0, y: -22 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -22 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}>
          <strong>{t('game.infectedAlertTitle')}</strong>
          <span>{t('game.infectedAlertBody')}</span>
        </motion.div>
      )}
      </AnimatePresence>

      <div className="game-body">
        <div className="game-top-row">
          {/* Desktop sidebar */}
          <div className="game-sidebar-left">
            <div className="sidebar-eyebrow">{t('game.commandDeck')}</div>
            <div className="status-strip">
              <div className="status-card">
                <span>{t('game.you')}</span>
                <strong>{me.name}</strong>
                <small>{roleLabel(me.role, lang)}</small>
              </div>
              <div className="status-card">
                <span>{t('game.step')}</span>
                <strong>{stepLabel(game.step, lang)}</strong>
                <small>
                  {game.direction === 1
                    ? t('game.clockwise')
                    : t('game.counterCW')}
                </small>
              </div>
              <div className={`status-card ${myTurn ? 'active' : ''}`}>
                <span>{t('game.status')}</span>
                <strong>{myTurn ? t('game.yourTurn') : t('game.waiting')}</strong>
                <small>
                  {myTurn
                    ? t('game.youCanAct')
                    : summary ?? t('game.turnOf', { name: current?.name ?? '…' })}
                </small>
              </div>
            </div>

            <div className="deck-row">
              <div className={`deck-stack ${myTurn && game.step === 'draw' && !game.pendingAction ? 'highlight' : ''}`}>
                <span>{t('game.deck')}</span>
                <strong>{game.deck.length}</strong>
              </div>
              <div className="deck-stack discard">
                <span>{t('game.discard')}</span>
                <strong>{game.discard.length}</strong>
              </div>
            </div>

            <div className="action-row">
              {myTurn && game.step === 'draw' && !game.pendingAction && (
                <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'DRAW_CARD' })} type="button">
                  {t('game.drawCard')}
                </button>
              )}
              {myTurn && me.role === 'thing' && game.step !== 'draw' && (
                <button className="btn danger" disabled={loading} onClick={() => void onAction({ type: 'DECLARE_VICTORY' })} type="button">
                  {t('game.declareVictory')}
                </button>
              )}
              {myTurn && game.step === 'end_turn' && (
                <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'END_TURN' })} type="button">
                  {t('game.endTurn')}
                </button>
              )}
            </div>

            {(summary || pendingOwnerName) && (
              <div className="notice-box">
                <strong>{t('game.tableState')}</strong>
                <p>
                  {summary ?? t('game.waitingFor', { name: pendingOwnerName })}
                </p>
              </div>
            )}

            {error && <p className="error-text" style={{ fontSize: '.76rem', margin: 0 }}>{error}</p>}
          </div>

          <div className="game-table-center">
            <div className="table-spotlight" />
            <PlayerCircle game={game} loading={loading} me={me} members={room.members} onAction={onAction} />
          </div>

          <div className="game-sidebar-right">
            <div className="intel-panel log-panel">
              <div className="panel-header compact">
                <h3>{t('game.latestEvents')}</h3>
                <button className="btn small ghost" onClick={() => setLogOpen((value) => !value)} type="button">
                  {game.log.length}
                </button>
              </div>
              <div className="intel-log-list">
                {visibleLog.map((entry) => (
                  <div className="log-entry intel-log-entry" key={entry.id}>
                    {lang === 'ru' ? entry.textRu : entry.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Mobile action button (hidden on desktop) ── */}
        <div className="mobile-action-bar">
          {myTurn && game.step === 'draw' && !game.pendingAction && (
            <button className="btn accent wide mobile-draw-btn" disabled={loading} onClick={() => void onAction({ type: 'DRAW_CARD' })} type="button">
              {t('game.drawCard')}
            </button>
          )}
          {myTurn && game.step === 'end_turn' && (
            <button className="btn accent wide" disabled={loading} onClick={() => void onAction({ type: 'END_TURN' })} type="button">
              {t('game.endTurn')}
            </button>
          )}
          {error && <p className="error-text" style={{ fontSize: '.76rem', margin: 0 }}>{error}</p>}
        </div>

        {/* ── Cards at bottom (no wrapper, centered) ── */}
        <div className="game-hand-strip">
          {showPendingPanel && (
            <div className="inline-action-wrapper">
              <PendingActionPanel game={game} loading={loading} me={me} onAction={onAction} />
            </div>
          )}
          <PlayerHand game={game} loading={loading} me={me} onAction={onAction} />
        </div>
      </div>

      {/* ── Floating log panel (top-right corner) ── */}
      <div className={`floating-log ${logOpen ? 'open' : ''}`}>
        <button className="floating-log-toggle" onClick={() => setLogOpen(v => !v)} type="button">
          <span className="floating-log-icon">📜</span>
          <span className="floating-log-badge">{game.log.length}</span>
        </button>
        <AnimatePresence>
        {logOpen && (
          <motion.div className="floating-log-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}>
            <div className="floating-log-scroll">
              {game.log.slice(0, 30).map((entry) => (
                <div className="log-entry" key={entry.id}>
                  {lang === 'ru' ? entry.textRu : entry.text}
                </div>
              ))}
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </main>
    </ShowCardTextCtx.Provider>
  );
}
