import { useEffect, useRef, useState } from 'react';
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
import { ShowCardTextCtx } from './components/panels/ShowCardTextCtx.ts';
import { TopBar } from './components/panels/TopBar.tsx';
import { PlayerCircle } from './components/panels/PlayerCircle.tsx';
import { PendingActionPanel } from './components/panels/PendingActionPanel.tsx';
import { PersistenceTablePicker } from './components/panels/PersistenceTablePicker.tsx';
import { RevealPanel } from './components/panels/RevealPanel.tsx';
import { SuspicionPickPanel } from './components/panels/SuspicionPickPanel.tsx';
import { hasRenderablePendingActionPanel } from './components/panels/pendingActionVisibility.ts';
import { PlayerHand } from './components/panels/PlayerHand.tsx';
import { CardPlayAnimationOverlay } from './components/panels/CardPlayAnimationOverlay.tsx';
import type { CardAnimTrigger } from './components/panels/CardPlayAnimationOverlay.tsx';
import { bgMusic } from './sounds/backgroundMusic.ts';

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
  onShout,
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
  onShout: (phrase: string, phraseEn: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ru';
  const [showCardText, setShowCardText] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [showSecondDeckAlert, setShowSecondDeckAlert] = useState(false);
  const [cardAnim, setCardAnim] = useState<CardAnimTrigger | null>(null);
  const lastReshuffleCountRef = useRef(game.reshuffleCount);
  const prevLogLenRef = useRef(game.log.length);
  // Hook must be called unconditionally (before any early return)
  const currentSafe = getCurrentPlayer(game);
  const pendingOwnerId = extractPendingOwner(game.pendingAction);
  const pendingOwnerName = pendingOwnerId === null
    ? null
    : game.players.find((p) => p.id === pendingOwnerId)?.name ?? null;
  const thingPlayerName = game.players.find((player) =>
    player.role === 'thing' || (me.role === 'infected' && player.canReceiveInfectedCardFromMe),
  )?.name ?? me.name;
  const showPendingPanel = hasRenderablePendingActionPanel(game.pendingAction, me.id);
  const suspicionPending =
    game.pendingAction?.type === 'suspicion_pick' && game.pendingAction.viewerPlayerId === me.id
      ? game.pendingAction
      : null;
  const revealPending =
    (game.pendingAction?.type === 'view_hand' ||
      game.pendingAction?.type === 'view_card' ||
      game.pendingAction?.type === 'whisky_reveal') &&
      (game.pendingAction.viewerPlayerId === me.id ||
        (game.pendingAction.type === 'whisky_reveal' && game.pendingAction.public === true))
      ? game.pendingAction
      : null;
  const urgentTradePrompt = (
    game.pendingAction?.type === 'trade_defense' && game.pendingAction.defenderId === me.id
  ) || (
      game.pendingAction?.type === 'temptation_response' && game.pendingAction.toId === me.id
    ) || (
      game.pendingAction?.type === 'panic_trade_response' && game.pendingAction.toId === me.id
    );
  const isSecondDeck = game.reshuffleCount > 0;
  const myTurnSafe = (currentSafe?.id ?? -1) === me.id && game.phase === 'playing';
  const viewerNeedsResponse = (() => {
    const pending = game.pendingAction;
    if (!pending || myTurnSafe) return false;

    switch (pending.type) {
      case 'trade_defense':
        return pending.defenderId === me.id;
      case 'temptation_response':
      case 'panic_trade_response':
        return pending.toId === me.id;
      case 'view_hand':
      case 'view_card':
      case 'whisky_reveal':
      case 'suspicion_pick':
        return pending.viewerPlayerId === me.id;
      case 'show_hand_confirm':
        return pending.playerId === me.id;
      case 'party_pass':
        return pending.pendingPlayerIds.includes(me.id) && !pending.chosen.some((choice) => choice.playerId === me.id);
      case 'just_between_us_pick':
        return pending.playerA === me.id || pending.playerB === me.id;
      case 'revelations_round':
        return pending.revealOrder[pending.currentRevealerIdx] === me.id;
      case 'choose_card_to_give':
      case 'choose_card_to_discard':
      case 'persistence_pick':
      case 'just_between_us':
      case 'panic_choose_target':
      case 'blind_date_swap':
      case 'forgetful_discard':
      case 'panic_trade':
        return (currentSafe?.id ?? -1) === me.id;
      default:
        return false;
    }
  })();

  useEffect(() => {
    if (game.reshuffleCount > lastReshuffleCountRef.current) {
      lastReshuffleCountRef.current = game.reshuffleCount;

      const showTimeoutId = window.setTimeout(() => {
        setShowSecondDeckAlert(true);
      }, 0);
      const hideTimeoutId = window.setTimeout(() => {
        setShowSecondDeckAlert(false);
      }, 5000);

      return () => {
        window.clearTimeout(showTimeoutId);
        window.clearTimeout(hideTimeoutId);
      };
    }

    lastReshuffleCountRef.current = game.reshuffleCount;
    return undefined;
  }, [game.reshuffleCount]);

  // Start background music when game begins (requires user interaction first)
  useEffect(() => {
    if (!bgMusic.playing) {
      bgMusic.start();
    }
    return () => {
      bgMusic.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect newly played targeted cards and trigger animation.
  // Works two ways: (1) if server provides fromPlayerId/targetPlayerId on the log
  // entry, use those directly; (2) otherwise fall back to parsing the log text
  // which has the format "PlayerA played Card on PlayerB." / "PlayerA сыграл(а) Карту на PlayerB."
  useEffect(() => {
    const prevLen = prevLogLenRef.current;
    prevLogLenRef.current = game.log.length;

    console.log('[CardAnim] useEffect fired. prevLen:', prevLen, 'current:', game.log.length);

    if (game.log.length <= prevLen) {
      console.log('[CardAnim] No new entries, skipping');
      return;
    }

    const newCount = game.log.length - prevLen;
    console.log('[CardAnim] New entries:', newCount);

    for (let i = 0; i < newCount; i++) {
      const entry = game.log[i];
      console.log('[CardAnim] Entry', i, ':', {
        id: entry.id,
        text: entry.text,
        cardDefId: entry.cardDefId,
        fromPlayerId: entry.fromPlayerId,
        targetPlayerId: entry.targetPlayerId,
      });

      if (!entry.cardDefId) {
        console.log('[CardAnim] No cardDefId, skipping entry');
        continue;
      }

      // Method 1: explicit IDs from server (available after server restart)
      if (entry.fromPlayerId !== undefined && entry.targetPlayerId !== undefined) {
        console.log('[CardAnim] TRIGGER via method 1 (explicit IDs)');
        setCardAnim({
          key: entry.id,
          cardDefId: entry.cardDefId,
          fromPlayerId: entry.fromPlayerId,
          toPlayerId: entry.targetPlayerId,
        });
        break;
      }

      // Method 2: parse log text to find player names
      const fromPlayer = game.players.find((p) => entry.text.startsWith(p.name + ' played '));
      const toPlayer = game.players.find((p) => entry.text.endsWith(` on ${p.name}.`));
      console.log('[CardAnim] Method 2 parse:', { fromPlayer: fromPlayer?.name, toPlayer: toPlayer?.name });

      if (fromPlayer && toPlayer) {
        console.log('[CardAnim] TRIGGER via method 2 (text parse)');
        setCardAnim({
          key: entry.id,
          cardDefId: entry.cardDefId,
          fromPlayerId: fromPlayer.id,
          toPlayerId: toPlayer.id,
        });
        break;
      }

      console.log('[CardAnim] Entry did not match any method');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.log.length]);

  /* ── GAME OVER ─────────────────────────────────────────────── */
  if (game.phase === 'game_over') {
    return (
      <main className="game-screen game-over-screen">
        <TopBar lang={lang} room={room} onCopy={onCopy} onLeave={onLeave} onToggleLang={onToggleLang} />
        <div className="game-over-body">
          <div className={`game-over-inner panel ${game.winner === 'humans' ? 'human-win' : 'thing-win'}`}>
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
  const visibleLog = game.log.slice(0, logOpen ? 16 : 6);
  const persistencePending = game.pendingAction?.type === 'persistence_pick'
    ? game.pendingAction
    : null;
  const turnBannerText = urgentTradePrompt
    ? t('game.tradeIncoming')
    : myTurn
      ? t('game.turnBannerYou')
      : t('game.turnBannerPlayer', { name: current?.name ?? '…' });
  const screenStateClass = viewerNeedsResponse
    ? 'screen-alert'
    : myTurn
      ? 'screen-turn'
      : isSecondDeck
        ? 'screen-second-deck'
        : '';
  const tableStateClass = viewerNeedsResponse
    ? 'alert'
    : myTurn
      ? 'turn'
      : isSecondDeck
        ? 'second-deck'
        : '';

  return (
    <ShowCardTextCtx.Provider value={showCardText}>
      <main className={`game-screen ${screenStateClass}`}>
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
          noticeContent={
            <>
              <AnimatePresence>
                {game.panicAnnouncement && (
                  <motion.div className="panic-banner top-bar-notice"
                    initial={{ opacity: 0, y: -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}>
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
                    className="infected-alert top-bar-notice"
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}>
                    <strong>{t('game.infectedAlertTitle')}</strong>
                    <span>{t('game.infectedAlertBody', { name: thingPlayerName })}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          }
        />

        <div className="game-notice-stack">
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
                <span>{t('game.infectedAlertBody', { name: thingPlayerName })}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="game-body">
          <div className="game-top-row">
            {/* Desktop sidebar */}
            <div className="game-sidebar-left">
              <div className="sidebar-eyebrow">{t('game.commandDeck')}</div>
              <div className="status-strip">
                <div className="status-card role-card">
                  <span>{t('game.you')}</span>
                  <strong>{me.name}</strong>
                  <small>{roleLabel(me.role, lang)}</small>
                </div>
                <div className="status-card step-card">
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
                <div className={`deck-stack ${myTurn && game.step === 'draw' && !game.pendingAction ? 'highlight' : ''} ${isSecondDeck ? 'second-pass' : ''}`}>
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
              {isSecondDeck && (
                <div className="notice-box deck-notice">
                  <strong>{t('game.secondDeckActive')}</strong>
                  <p>{t('game.secondDeckWarning')}</p>
                </div>
              )}

              {error && <p className="error-text" style={{ fontSize: '.76rem', margin: 0 }}>{error}</p>}
            </div>

            <div className="game-table-center">
              <div className={`table-spotlight ${tableStateClass}`} />
              <div className="table-hud">
                <div className={`table-pill active ${urgentTradePrompt ? 'alert' : ''}`}>
                  <span>{urgentTradePrompt ? t('game.respondNow') : t('game.activePlayer')}</span>
                  <strong>{turnBannerText}</strong>
                </div>
                <div className={`table-pill subtle ${isSecondDeck ? 'danger' : ''}`}>
                  <span>{t('game.deckCycle')}</span>
                  <strong>{isSecondDeck ? t('game.secondDeckActive') : t('game.firstDeckActive')}</strong>
                </div>
              </div>
              {isSecondDeck && showSecondDeckAlert && (
                <div className="deck-phase-alert">
                  <strong>{t('game.secondDeckActive')}</strong>
                  <span>{t('game.secondDeckWarning')}</span>
                </div>
              )}
              {persistencePending && (
                <PersistenceTablePicker
                  loading={loading}
                  pending={persistencePending}
                  onAction={onAction}
                />
              )}
              {suspicionPending?.previewCardUid ? (
                <div className="table-suspicion-confirm">
                  <button
                    className="btn primary"
                    disabled={loading}
                    onClick={() => void onAction({ type: 'SUSPICION_CONFIRM_CARD', cardUid: suspicionPending.previewCardUid! })}
                    type="button"
                  >
                    {t('suspicion.confirm')}
                  </button>
                </div>
              ) : null}
              <PlayerCircle
                game={game}
                loading={loading}
                me={me}
                members={room.members}
                onAction={onAction}
                shouts={room.shouts ?? []}
                onShout={onShout}
                animOverlay={
                  <CardPlayAnimationOverlay
                    trigger={cardAnim}
                    game={game}
                    onDone={() => setCardAnim(null)}
                  />
                }
              />
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

          <AnimatePresence>
            {showPendingPanel && (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`game-prompt-overlay ${game.pendingAction?.type === 'revelations_round' ? 'is-revelations-overlay' : ''}`}
                exit={{ opacity: 0, y: 18, scale: 0.98 }}
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}>
                <div className={`game-prompt-card panel ${game.pendingAction?.type === 'revelations_round' ? 'revelations-card' : ''}`}>
                  <PendingActionPanel game={game} loading={loading} me={me} onAction={onAction} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {revealPending && (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="screen-reveal-overlay"
                exit={{ opacity: 0, y: 18, scale: 0.98 }}
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}>
                <RevealPanel
                  game={game}
                  loading={loading}
                  me={me}
                  pending={revealPending}
                  onAction={onAction}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Cards at bottom ── */}
          <div className="game-hand-strip">
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
            {suspicionPending && (
              <div className="inline-action-wrapper suspicion-inline-wrapper">
                <SuspicionPickPanel
                  loading={loading}
                  pending={suspicionPending}
                  onAction={onAction}
                />
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
