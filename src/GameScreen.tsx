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
import type { LogEntry } from './types.ts';

/** Classify a log entry for icon & color styling */
function getLogMeta(entry: LogEntry): { icon: string; cls: string } {
  const t = entry.text.toLowerCase();
  if (t.includes('eliminated') || t.includes('died') || t.includes('killed'))
    return { icon: '💀', cls: 'log-eliminate' };
  if (t.includes('wins') || t.includes('victory') || t.includes('game over'))
    return { icon: '🏆', cls: 'log-gameover' };
  if (t.includes('panic'))
    return { icon: '😱', cls: 'log-panic' };
  if (t.includes('no_barbecue') || t.includes('no_thanks') || t.includes('miss') || t.includes('im_fine_here') || t.includes('defended') || t.includes('blocked'))
    return { icon: '🛡', cls: 'log-defense' };
  if (t.includes('played'))
    return { icon: '🃏', cls: 'log-play' };
  if (t.includes('traded') || t.includes('exchanged') || t.includes('swap'))
    return { icon: '🔄', cls: 'log-trade' };
  if (t.includes('drew') || t.includes('draw'))
    return { icon: '📥', cls: 'log-draw' };
  if (t.includes('discard'))
    return { icon: '📤', cls: 'log-draw' };
  return { icon: '📋', cls: '' };
}

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Generate a contextual hint for the current game state */
function getHint(
  game: ViewerGameState,
  me: ViewerPlayerState,
  myTurn: boolean,
  isRu: boolean,
): string | null {
  if (game.phase === 'role_reveal') {
    return isRu
      ? '👁 Запомни свою роль! Никому не показывай.'
      : '👁 Remember your role! Don\'t show anyone.';
  }
  if (!me.isAlive) {
    return isRu ? '💀 Ты выбыл из игры. Наблюдай за остальными.' : '💀 You\'re eliminated. Watch the others.';
  }
  if (game.pendingAction) {
    const pa = game.pendingAction;
    if (pa.type === 'choose_target' || pa.type === 'panic_choose_target') {
      return isRu ? '🎯 Выбери игрока-цель, нажав на его аватарку.' : '🎯 Choose a target by clicking their avatar.';
    }
    if (pa.type === 'trade_offer') {
      return isRu ? '🔄 Выбери карту из руки для обмена.' : '🔄 Pick a card from your hand to trade.';
    }
    if (pa.type === 'trade_response') {
      return isRu ? '🔄 Тебе предлагают обмен! Выбери карту в ответ.' : '🔄 Someone wants to trade! Pick a card in response.';
    }
    if (pa.type === 'suspicion_pick') {
      return isRu ? '🔍 Выбери карту из веера подозреваемого.' : '🔍 Pick a card from the suspect\'s fan.';
    }
    if (pa.type === 'trade_defense') {
      return isRu ? '🛡 Можешь защититься картой или пропустить.' : '🛡 You can play a defense card or skip.';
    }
    if (pa.type === 'persistence_pick') {
      return isRu ? '🔥 Выбери карту, которую хочешь забрать.' : '🔥 Choose the card you want to take.';
    }
  }
  if (!myTurn) {
    return isRu ? '⏳ Сейчас ход другого игрока. Жди свою очередь.' : '⏳ Another player\'s turn. Wait for yours.';
  }
  if (game.step === 'draw') {
    return isRu ? '📥 Тяни карту из колоды! Нажми кнопку "Тянуть".' : '📥 Draw a card from the deck!';
  }
  if (game.step === 'play_or_discard') {
    return isRu ? '🃏 Сыграй карту на игрока или сбрось ненужную.' : '🃏 Play a card on someone or discard one.';
  }
  if (game.step === 'trade') {
    return isRu ? '🔄 Выбери карту для обмена с соседом.' : '🔄 Pick a card to trade with your neighbor.';
  }
  if (game.step === 'end_turn') {
    return isRu ? '✅ Нажми "Завершить ход".' : '✅ Click "End Turn".';
  }
  return null;
}
import { bgMusic } from './sounds/backgroundMusic.ts';
import {
  playCardDraw,
  playCardDrop,
  playCardPlay,
  playCardSwap,
  playPanicReveal,
  playDefenseBlock,
  playYourTurn,
  playDeckShuffle,
  playPlayerEliminated,
  playVictoryHumans,
  playVictoryThing,
  playButtonClick,
  playLockedDoor,
  playQuarantine,
} from './sounds/gameSfx.ts';

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
  const [hintsEnabled, setHintsEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('stay-away-hints');
      return saved === null ? true : saved === '1';
    } catch { return true; }
  });
  const lastReshuffleCountRef = useRef(game.reshuffleCount);
  const prevLogLenRef = useRef(game.log.length);
  // Refs for sound effect triggers
  const prevDeckLenSfx = useRef(game.deck.length);
  const prevDiscardLenSfx = useRef(game.discard.length);
  const prevStepSfx = useRef(game.step);
  const prevCurrentPlayerSfx = useRef(game.currentPlayerIndex);
  const prevPhaseSfx = useRef(game.phase);
  const prevAliveCountSfx = useRef(game.players.filter(p => p.isAlive).length);
  const prevReshuffleSfx = useRef(game.reshuffleCount);
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

  // Global button click sound — captures all button clicks in the game screen
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, .btn, [role="button"]')) {
        playButtonClick();
      }
    };
    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, []);

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


    if (game.log.length <= prevLen) return;

    const newCount = game.log.length - prevLen;

    for (let i = 0; i < newCount; i++) {
      const entry = game.log[i];

      // Defense card played — play block sound
      const DEFENSE_CARDS = ['no_barbecue', 'no_thanks', 'miss', 'im_fine_here'];
      if (entry.cardDefId && DEFENSE_CARDS.includes(entry.cardDefId)) {
        playDefenseBlock();
      }

      // Trade completed — detect from log text
      if (entry.text.includes('traded') || entry.text.includes('offered') ||
          entry.textRu?.includes('обмен') || entry.textRu?.includes('передал')) {
        playCardSwap();
      }

      if (!entry.cardDefId) {
        continue;
      }

      // Method 1: explicit IDs from server (available after server restart)
      if (entry.fromPlayerId !== undefined && entry.targetPlayerId !== undefined) {

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

      if (fromPlayer && toPlayer) {

        setCardAnim({
          key: entry.id,
          cardDefId: entry.cardDefId,
          fromPlayerId: fromPlayer.id,
          toPlayerId: toPlayer.id,
        });
        break;
      }


    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.log.length]);

  // ── Sound effects based on game state changes ──────────────────
  useEffect(() => {
    const dDeck = game.deck.length - prevDeckLenSfx.current;
    const dDiscard = game.discard.length - prevDiscardLenSfx.current;
    const stepChanged = game.step !== prevStepSfx.current;
    const currentPlayerChanged = game.currentPlayerIndex !== prevCurrentPlayerSfx.current;
    const phaseChanged = game.phase !== prevPhaseSfx.current;
    const aliveCount = game.players.filter(p => p.isAlive).length;
    const aliveDecreased = aliveCount < prevAliveCountSfx.current;
    const reshuffled = game.reshuffleCount > prevReshuffleSfx.current;

    prevDeckLenSfx.current = game.deck.length;
    prevDiscardLenSfx.current = game.discard.length;
    prevStepSfx.current = game.step;
    prevCurrentPlayerSfx.current = game.currentPlayerIndex;
    prevPhaseSfx.current = game.phase;
    prevAliveCountSfx.current = aliveCount;
    prevReshuffleSfx.current = game.reshuffleCount;

    // Deck reshuffle
    if (reshuffled) {
      playDeckShuffle();
      return; // don't stack other sounds on reshuffle
    }

    // Card drawn from deck
    if (dDeck < 0) {
      // Check if it was a panic card (deck shrank AND discard grew simultaneously)
      const isPanic = dDiscard > 0 && dDeck === -1;
      if (isPanic) {
        // Slight delay so draw sound plays first, then panic reveal
        playCardDraw(0.3);
        setTimeout(() => playPanicReveal(), 200);
      } else {
        playCardDraw();
      }
    }

    // Card played/discarded to discard pile (but NOT during panic-draw combo)
    if (dDiscard > 0 && dDeck >= 0) {
      // Check recent log for "played" vs "discarded"
      const latestLog = game.log[0];
      const wasPlayed = latestLog?.cardDefId && (
        latestLog.text.includes(' played ') || latestLog.textRu.includes(' сыграл')
      );
      if (wasPlayed) {
        if (latestLog.cardDefId === 'locked_door') {
          playLockedDoor();
        } else if (latestLog.cardDefId === 'quarantine') {
          playQuarantine();
        } else {
          playCardPlay();
        }
      } else {
        playCardDrop();
      }
    }

    // Trade completed (step changed to end_turn from trade_response)
    if (stepChanged && game.step === 'end_turn' && prevStepSfx.current === 'trade_response') {
      // This was already set to end_turn — but check prev
    }

    // Your turn notification
    if (currentPlayerChanged && game.players[game.currentPlayerIndex]?.id === me.id && game.phase === 'playing') {
      playYourTurn();
    }

    // Player eliminated
    if (aliveDecreased && game.phase === 'playing') {
      playPlayerEliminated();
    }

    // Game over
    if (phaseChanged && game.phase === 'game_over') {
      if (game.winner === 'humans') {
        playVictoryHumans();
      } else {
        playVictoryThing();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.deck.length, game.discard.length, game.step, game.currentPlayerIndex, game.phase, game.reshuffleCount]);

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
              <button className="btn primary" disabled={loading || !room.me.isHost} onClick={() => void onReset()} type="button">
                {room.me.isHost ? t('game.newMatch') : t('game.newMatch')}
              </button>
              {!room.me.isHost && (
                <p className="helper-text" style={{ marginTop: '0.4rem' }}>{t('game.hostReturnLobby')}</p>
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
          hintsEnabled={hintsEnabled}
          onToggleHints={() => {
            setHintsEnabled(v => {
              const next = !v;
              localStorage.setItem('stay-away-hints', next ? '1' : '0');
              return next;
            });
          }}
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

        {/* ── Newbie hint (top of screen) ── */}
        <AnimatePresence>
          {hintsEnabled && (() => {
            const hint = getHint(game, me, myTurn, lang === 'ru');
            return hint ? (
              <motion.div
                className="hint-bar"
                key={hint}
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
              >
                <span className="hint-icon">💡</span>
                <span className="hint-text">{hint}</span>
                <button
                  className="hint-dismiss"
                  type="button"
                  onClick={() => {
                    setHintsEnabled(false);
                    localStorage.setItem('stay-away-hints', '0');
                  }}
                  title={lang === 'ru' ? 'Отключить подсказки' : 'Disable hints'}
                >✕</button>
              </motion.div>
            ) : null;
          })()}
        </AnimatePresence>

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
            {me.role === 'infected' && me.isAlive && (
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

          <AnimatePresence>
            {!me.isAlive && game.phase === 'playing' && (
              <motion.div
                className="spectator-banner"
                initial={{ opacity: 0, y: -22 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -22 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}>
                <span className="spectator-banner-icon">👁</span>
                <span>{lang === 'ru' ? 'Режим наблюдателя — ты видишь карты и роли всех игроков' : 'Spectator mode — you can see all cards and roles'}</span>
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
                  {visibleLog.map((entry) => {
                    const meta = getLogMeta(entry);
                    return (
                      <div className={`log-entry intel-log-entry ${meta.cls}`} key={entry.id}>
                        <span className="log-entry-icon">{meta.icon}</span>
                        <span className="log-entry-text">{lang === 'ru' ? entry.textRu : entry.text}</span>
                        {entry.timestamp > 0 && <span className="log-entry-time">{formatLogTime(entry.timestamp)}</span>}
                      </div>
                    );
                  })}
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

          {/* hint moved to top of screen */}

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
                  {game.log.slice(0, 30).map((entry) => {
                    const meta = getLogMeta(entry);
                    return (
                      <div className={`log-entry ${meta.cls}`} key={entry.id}>
                        <span className="log-entry-icon">{meta.icon}</span>
                        <span className="log-entry-text">{lang === 'ru' ? entry.textRu : entry.text}</span>
                        {entry.timestamp > 0 && <span className="log-entry-time">{formatLogTime(entry.timestamp)}</span>}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </ShowCardTextCtx.Provider>
  );
}
