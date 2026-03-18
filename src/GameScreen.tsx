import { createContext, useContext, useState } from 'react';

const ShowCardTextCtx = createContext(false);
import { getCardDef, getCardName, getCardDescription, getCardImage } from './cards.ts';
import {
  canDiscardCard,
  canPlayCard,
  hasDoorBetween,
} from './gameLogic.ts';
import type { RoomView, ViewerGameState, ViewerPlayerState } from './multiplayer.ts';
import type { CardInstance, GameAction, PendingAction } from './types.ts';
import {
  actionReasonLabel,
  cardCategoryLabel,
  extractPendingOwner,
  getCurrentPlayer,
  localTradeCheck,
  pendingSummary,
  roleLabel,
  stepLabel,
  text,
  type Lang,
} from './appHelpers.ts';

export function GameScreen({
  error,
  game,
  lang,
  loading,
  me,
  room,
  onAction,
  onCopy,
  onLeave,
  onReset,
}: {
  error: string | null;
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  room: RoomView;
  onAction: (action: GameAction) => Promise<void>;
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onReset: () => Promise<void>;
}) {
  const [showCardText, setShowCardText] = useState(false);
  const current = getCurrentPlayer(game);
  const myTurn = current.id === me.id;
  const summary = pendingSummary(game.pendingAction, game, lang);
  const pendingOwnerId = extractPendingOwner(game.pendingAction);
  const pendingOwnerName = pendingOwnerId === null
    ? null
    : game.players.find((p) => p.id === pendingOwnerId)?.name ?? null;

  /* ── GAME OVER ─────────────────────────────────────────────── */
  if (game.phase === 'game_over') {
    return (
      <main className="game-screen">
        <TopBar lang={lang} room={room} onCopy={onCopy} onLeave={onLeave} />
        <div className="game-over-body">
          <div className="game-over-inner panel">
            <h2 className="hero-title small">{text(lang, 'Партия завершена', 'Match finished')}</h2>
            <p className={`winner-line ${game.winner === 'humans' ? 'human-win' : 'thing-win'}`}>
              {game.winner === 'humans'
                ? text(lang, '🧍 Люди победили', '🧍 Humans win')
                : game.winner === 'thing_solo'
                  ? text(lang, '☣ Нечто победило в одиночку', '☣ The Thing wins alone')
                  : text(lang, '☣ Нечто победило', '☣ The Thing wins')}
            </p>
            <div className="results-grid">
              {game.players.map((player) => (
                <div className={`result-card ${game.winnerPlayerIds.includes(player.id) ? 'winner' : ''}`} key={player.id}>
                  <strong>{player.name}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{roleLabel(player.role, lang)}</span>
                  <span style={{ fontSize: '.76rem', color: player.isAlive ? 'var(--accent-strong)' : 'var(--danger-strong)' }}>
                    {player.isAlive ? text(lang, '✓ Жив', '✓ Alive') : text(lang, '✗ Уничтожен', '✗ Eliminated')}
                  </span>
                </div>
              ))}
            </div>
            <div className="stack-actions">
              {room.me.isHost && (
                <button className="btn primary" disabled={loading} onClick={() => void onReset()} type="button">
                  {text(lang, 'Новая партия', 'New match')}
                </button>
              )}
              {!room.me.isHost && (
                <p className="helper-text">{text(lang, 'Хост может вернуть всех в лобби.', 'The host can return everyone to lobby.')}</p>
              )}
              {error && <p className="error-text">{error}</p>}
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ── IN GAME ───────────────────────────────────────────────── */
  return (
    <ShowCardTextCtx.Provider value={showCardText}>
    <main className="game-screen">
      {/* ── Top bar ── */}
      <TopBar lang={lang} room={room} onCopy={onCopy} onLeave={onLeave} showCardText={showCardText} onToggleText={() => setShowCardText(v => !v)} />

      {/* ── Panic announcement ── */}
      {game.panicAnnouncement && (
        <div className="panic-banner">
          <div className="panic-banner-icon">⚠</div>
          <div className="panic-banner-content">
            <strong>{text(lang, 'Паника!', 'Panic!')}</strong>
            <span className="panic-banner-name">{getCardName(game.panicAnnouncement, lang)}</span>
            <p className="panic-banner-desc">{getCardDescription(game.panicAnnouncement, lang)}</p>
          </div>
        </div>
      )}

      {/* ── Main body: table center, cards below ── */}
      <div className="game-body">

        {/* ─ TOP ROW: status + table + info ─ */}
        <div className="game-top-row">
          {/* Left sidebar: status + deck */}
          <div className="game-sidebar-left">
            <div className="status-strip">
              <div className="status-card">
                <span>{text(lang, 'Вы', 'You')}</span>
                <strong>{me.name}</strong>
                <small>{roleLabel(me.role, lang)}</small>
              </div>
              <div className="status-card">
                <span>{text(lang, 'Этап', 'Step')}</span>
                <strong>{stepLabel(game.step, lang)}</strong>
                <small>
                  {game.direction === 1
                    ? text(lang, '↻ По часовой', '↻ Clockwise')
                    : text(lang, '↺ Против', '↺ Counter-CW')}
                </small>
              </div>
              <div className={`status-card ${myTurn ? 'active' : ''}`}>
                <span>{text(lang, 'Состояние', 'Status')}</span>
                <strong>{myTurn ? text(lang, 'Ваш ход', 'Your turn') : text(lang, 'Ожидание', 'Waiting')}</strong>
                <small>
                  {myTurn
                    ? text(lang, 'Вы можете действовать.', 'You can act.')
                    : summary ?? text(lang, `Ход: ${current.name}`, `Turn: ${current.name}`)}
                </small>
              </div>
            </div>

            <div className="deck-row">
              <div className={`deck-stack ${myTurn && game.step === 'draw' && !game.pendingAction ? 'highlight' : ''}`}>
                <span>{text(lang, 'Колода', 'Deck')}</span>
                <strong>{game.deck.length}</strong>
              </div>
              <div className="deck-stack discard">
                <span>{text(lang, 'Сброс', 'Discard')}</span>
                <strong>{game.discard.length}</strong>
              </div>
            </div>

            <div className="action-row">
              {myTurn && game.step === 'draw' && !game.pendingAction && (
                <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'DRAW_CARD' })} type="button">
                  {text(lang, '🃏 Взять карту', '🃏 Draw card')}
                </button>
              )}
              {myTurn && me.role === 'thing' && game.step !== 'draw' && (
                <button className="btn danger" disabled={loading} onClick={() => void onAction({ type: 'DECLARE_VICTORY' })} type="button">
                  {text(lang, '☣ Объявить победу', '☣ Declare victory')}
                </button>
              )}
              {myTurn && game.step === 'end_turn' && (
                <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'END_TURN' })} type="button">
                  {text(lang, '→ Завершить ход', '→ End turn')}
                </button>
              )}
            </div>

            {(summary || pendingOwnerName) && (
              <div className="notice-box">
                <strong>{text(lang, 'На столе', 'Table state')}</strong>
                <p>
                  {summary ?? text(
                    lang,
                    `Ожидается: ${pendingOwnerName}`,
                    `Waiting for: ${pendingOwnerName}`,
                  )}
                </p>
              </div>
            )}

            {error && <p className="error-text" style={{ fontSize: '.76rem', margin: 0 }}>{error}</p>}
          </div>

          {/* Center: player circle (table) */}
          <div className="game-table-center">
            <PlayerCircle game={game} lang={lang} me={me} />
          </div>

          {/* Right sidebar: pending actions only */}
          <div className="game-sidebar-right">
            <div className="pending-panel">
              <PendingActionPanel game={game} lang={lang} loading={loading} me={me} onAction={onAction} />
            </div>
          </div>
        </div>

        {/* ─ BOTTOM ROW: hand + log side by side ─ */}
        <BottomPanel game={game} lang={lang} loading={loading} me={me} onAction={onAction} />

      </div>
    </main>
    </ShowCardTextCtx.Provider>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   BOTTOM PANEL (hand + log, both collapsible)
══════════════════════════════════════════════════════════════════════ */
function BottomPanel({
  game,
  lang,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const [handOpen, setHandOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(false);

  return (
    <div className="game-bottom-row">
      {/* Hand section */}
      <div className={`bottom-section hand-section ${handOpen ? 'open' : 'collapsed'}`}>
        <button className="section-toggle" onClick={() => setHandOpen(v => !v)} type="button">
          <span>{text(lang, 'Ваша рука', 'Your hand')}</span>
          <span className="hand-count">{me.hand.length} {text(lang, 'карт', 'cards')}</span>
          <span className="toggle-arrow">{handOpen ? '▼' : '▲'}</span>
        </button>
        {handOpen && (
          <div className="section-body hand-scroll">
            <PlayerHand game={game} lang={lang} loading={loading} me={me} onAction={onAction} />
          </div>
        )}
      </div>

      {/* Log section */}
      <div className={`bottom-section log-section ${logOpen ? 'open' : 'collapsed'}`}>
        <button className="section-toggle" onClick={() => setLogOpen(v => !v)} type="button">
          <span>{text(lang, 'Журнал событий', 'Event log')}</span>
          <span className="toggle-arrow">{logOpen ? '▼' : '▲'}</span>
        </button>
        {logOpen && (
          <div className="section-body log-body">
            {game.log.slice(0, 30).map((entry) => (
              <div className="log-entry" key={entry.id}>
                {lang === 'ru' ? entry.textRu : entry.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   TOP BAR
══════════════════════════════════════════════════════════════════════ */
function TopBar({
  lang,
  room,
  onCopy,
  onLeave,
  showCardText,
  onToggleText,
}: {
  lang: Lang;
  room: RoomView;
  onCopy: () => Promise<void>;
  onLeave: () => void;
  showCardText?: boolean;
  onToggleText?: () => void;
}) {
  return (
    <div className="top-bar">
      <span className="top-bar-brand">STAY AWAY!</span>
      <span className="top-bar-sep">·</span>
      <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{text(lang, 'Комната', 'Room')}</span>
      <span className="top-bar-room">{room.code}</span>
      <div className="top-bar-actions">
        {onToggleText && (
          <button className={`btn small ${showCardText ? 'primary' : 'ghost'}`} onClick={onToggleText} type="button">
            {text(lang, showCardText ? 'Скрыть текст' : 'Текст карт', showCardText ? 'Hide text' : 'Card text')}
          </button>
        )}
        <button className="btn small secondary" onClick={() => void onCopy()} type="button">
          {text(lang, 'Ссылка', 'Copy link')}
        </button>
        <button className="btn small ghost" onClick={onLeave} type="button">
          {text(lang, 'Выйти', 'Leave')}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PLAYER CIRCLE
══════════════════════════════════════════════════════════════════════ */
function PlayerCircle({
  game,
  lang,
  me,
}: {
  game: ViewerGameState;
  lang: Lang;
  me: ViewerPlayerState;
}) {
  const total = game.players.length;
  const current = getCurrentPlayer(game);

  return (
    <div className="player-circle">
      {game.players.map((player) => {
        const angle = (player.position / total) * 360 - 90;
        const r = 42;
        const x = 50 + r * Math.cos((angle * Math.PI) / 180);
        const y = 50 + r * Math.sin((angle * Math.PI) / 180);
        const isCurrent = player.id === current.id;
        const isSelf = player.id === me.id;

        return (
          <div
            className={`player-node ${isCurrent ? 'active' : ''} ${isSelf ? 'self' : ''} ${player.isAlive ? '' : 'dead'}`}
            key={player.id}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className="player-avatar">{player.name.charAt(0).toUpperCase()}</div>
            <div className="player-meta">
              <strong>{player.name}</strong>
              <span>
                {isSelf
                  ? roleLabel(player.role, lang)
                  : text(lang, `${player.handCount}к`, `${player.handCount}c`)}
              </span>
            </div>
            {player.inQuarantine && (
              <div className="token quarantine">Q{player.quarantineTurnsLeft}</div>
            )}
            {!player.isAlive && <div className="token dead">✗</div>}
          </div>
        );
      })}

      {game.doors.map((door, index) => {
        const first = game.players.find((p) => p.position === door.between[0]);
        const second = game.players.find((p) => p.position === door.between[1]);
        if (!first || !second || !hasDoorBetween(game as never, first.position, second.position)) return null;

        const a1 = (first.position / total) * 360 - 90;
        const a2 = (second.position / total) * 360 - 90;
        const mid = (a1 + a2) / 2;
        const x = 50 + 42 * Math.cos((mid * Math.PI) / 180);
        const y = 50 + 42 * Math.sin((mid * Math.PI) / 180);

        return (
          <div
            className="door-marker"
            key={`${door.between.join('-')}-${index}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            {text(lang, '🚪', '🚪')}
          </div>
        );
      })}

      <div className="circle-core">
        <strong>{game.direction === 1 ? '↻' : '↺'}</strong>
        <span>{text(lang, 'направление', 'direction')}</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PLAYER HAND
══════════════════════════════════════════════════════════════════════ */
function PlayerHand({
  game,
  lang,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  return (
    <div className="hand-grid">
      {me.hand.map((card) => {
        const isMyTurn = getCurrentPlayer(game).id === me.id;
        const canPlay = isMyTurn && game.step === 'play_or_discard' && canPlayCard(game as never, card.defId);
        const canDiscard = isMyTurn && game.step === 'play_or_discard' && canDiscardCard(game as never, me as never, card.uid);
        const canTrade = isMyTurn && game.step === 'trade' && localTradeCheck(me, card);

        return (
          <div className="hand-card" key={card.uid}>
            <CardView card={card} faceUp lang={lang} />
            <div className="hand-card-actions">
              {canPlay && (
                <button className="btn small primary" disabled={loading} onClick={() => void onAction({ type: 'PLAY_CARD', cardUid: card.uid })} type="button">
                  {text(lang, 'Сыграть', 'Play')}
                </button>
              )}
              {canDiscard && (
                <button className="btn small secondary" disabled={loading} onClick={() => void onAction({ type: 'DISCARD_CARD', cardUid: card.uid })} type="button">
                  {text(lang, 'Сброс', 'Discard')}
                </button>
              )}
              {canTrade && (
                <button className="btn small accent" disabled={loading} onClick={() => void onAction({ type: 'OFFER_TRADE', cardUid: card.uid })} type="button">
                  {text(lang, 'Обмен', 'Offer')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PENDING ACTION DISPATCHER
══════════════════════════════════════════════════════════════════════ */
function PendingActionPanel({
  game,
  lang,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const pending = game.pendingAction;
  if (!pending) {
    return (
      <InfoPanel
        title={text(lang, 'Активное действие', 'Active action')}
        body={text(lang, 'Нет активных запросов.', 'No active prompts.')}
      />
    );
  }

  if (pending.type === 'choose_target')
    return <TargetPanel game={game} lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'choose_card_to_discard')
    return <DiscardPanel game={game} lang={lang} loading={loading} me={me} onAction={onAction} />;
  if (pending.type === 'persistence_pick')
    return <PersistencePanel lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'choose_card_to_give')
    return <TemptationPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'view_hand' || pending.type === 'view_card' || pending.type === 'whisky_reveal')
    return <RevealPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'trade_defense')
    return <TradeDefensePanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'just_between_us')
    return <JustBetweenUsPanel game={game} lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'just_between_us_pick')
    return <JustBetweenUsPickPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'party_pass')
    return <PartyPassPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'temptation_response')
    return <TemptationResponsePanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'panic_choose_target')
    return <PanicTargetPanel game={game} lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'blind_date_swap')
    return <BlindDatePanel game={game} lang={lang} loading={loading} me={me} onAction={onAction} />;
  if (pending.type === 'forgetful_discard')
    return <ForgetfulPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'panic_trade')
    return <PanicTradePanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'panic_trade_response')
    return <PanicTradeResponsePanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'revelations_round')
    return <RevelationsPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;

  return (
    <InfoPanel
      title={text(lang, 'Активное действие', 'Active action')}
      body={text(lang, 'Ответ не требуется.', 'No response needed from you.')}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   CARD VIEW
══════════════════════════════════════════════════════════════════════ */
function CardView({ card, faceUp, lang }: { card: CardInstance; faceUp: boolean; lang: Lang }) {
  const showText = useContext(ShowCardTextCtx);
  const def = getCardDef(card.defId);
  if (!faceUp) {
    return (
      <div className={`card card-back ${def.back === 'panic' ? 'panic-back' : 'event-back'}`}>
        {def.back === 'panic' ? text(lang, 'Паника', 'Panic') : text(lang, 'Событие', 'Event')}
      </div>
    );
  }

  const imgSrc = getCardImage(card.defId);

  return (
    <div className={`card cat-${def.category} ${imgSrc ? 'has-image' : ''} ${showText ? 'show-text' : ''}`}>
      {imgSrc && <img alt="" className="card-bg-img" src={imgSrc} />}
      <div className="card-overlay">
        <div className={`card-badge badge-${def.category}`}>{cardCategoryLabel(card, lang)}</div>
        {showText && (
          <>
            <div className="card-name">{lang === 'ru' ? def.nameRu : def.name}</div>
            <div className="card-desc">{lang === 'ru' ? def.descriptionRu : def.description}</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   INFO PANEL (no-action state)
══════════════════════════════════════════════════════════════════════ */
function InfoPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{title}</h3></div>
      <p className="helper-text">{body}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ACTION PANELS
══════════════════════════════════════════════════════════════════════ */
function TargetPanel({
  game,
  lang,
  loading,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  pending: Extract<PendingAction, { type: 'choose_target' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Выберите цель', 'Choose target')}</h3></div>
      <p className="helper-text">{getCardName(pending.cardDefId, lang)}</p>
      <div className="stack-actions" style={{ marginTop: '8px' }}>
        {pending.targets.map((tid) => (
          <button className="btn secondary" disabled={loading} key={tid} onClick={() => void onAction({ type: 'SELECT_TARGET', targetPlayerId: tid })} type="button">
            {game.players.find((p) => p.id === tid)?.name ?? tid}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiscardPanel({
  game,
  lang,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Выберите сброс', 'Choose discard')}</h3></div>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canDiscardCard(game as never, me as never, card.uid);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small secondary" disabled={!allowed || loading} onClick={() => void onAction({ type: 'DISCARD_CARD', cardUid: card.uid })} type="button">
                {text(lang, 'Сбросить', 'Discard')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersistencePanel({
  lang,
  loading,
  pending,
  onAction,
}: {
  lang: Lang;
  loading: boolean;
  pending: Extract<PendingAction, { type: 'persistence_pick' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Настойчивость', 'Persistence')}</h3></div>
      <div className="hand-grid compact">
        {pending.drawnCards.map((card) => (
          <div className="hand-card" key={card.uid}>
            <CardView card={card} faceUp lang={lang} />
            <button
              className="btn small primary"
              disabled={loading}
              onClick={() => void onAction({
                type: 'PERSISTENCE_PICK',
                keepUid: card.uid,
                discardUids: pending.drawnCards.filter((c) => c.uid !== card.uid).map((c) => c.uid),
              })}
              type="button"
            >
              {text(lang, 'Оставить', 'Keep')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemptationPanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'choose_card_to_give' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const target = game.players.find((p) => p.id === pending.targetPlayerId);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Соблазн', 'Temptation')}</h3></div>
      <p className="helper-text">
        {text(lang, `Отдать карту → ${target?.name ?? '?'}`, `Give card → ${target?.name ?? '?'}`)}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'TEMPTATION_SELECT', targetPlayerId: pending.targetPlayerId, cardUid: card.uid })} type="button">
                {text(lang, 'Отдать', 'Give')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevealPanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'view_hand' | 'view_card' | 'whisky_reveal' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const cards = pending.type === 'view_hand' ? pending.cards : pending.type === 'view_card' ? [pending.card] : pending.cards;
  const ownerId = pending.type === 'whisky_reveal' ? pending.playerId : pending.targetPlayerId;
  const ownerName = game.players.find((p) => p.id === ownerId)?.name ?? ownerId;
  const canConfirm = pending.viewerPlayerId === me.id;

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Просмотр карт', 'Card reveal')}</h3></div>
      <p className="helper-text">
        {pending.type === 'whisky_reveal'
          ? text(lang, `${ownerName} показывает карты всем.`, `${ownerName} shows cards to all.`)
          : text(lang, `Карты: ${ownerName}`, `${ownerName}'s cards`)}
      </p>
      <div className="hand-grid compact">
        {cards.map((card) => <CardView card={card} faceUp key={card.uid} lang={lang} />)}
      </div>
      {canConfirm ? (
        <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'CONFIRM_VIEW' })} style={{ marginTop: '8px' }} type="button">
          {text(lang, 'Подтвердить', 'Confirm')}
        </button>
      ) : (
        <p className="helper-text">{text(lang, 'Другой игрок должен подтвердить.', 'Another player must confirm.')}</p>
      )}
    </div>
  );
}

function TradeDefensePanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'trade_defense' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const allowedIds = pending.reason === 'trade'
    ? ['fear', 'no_thanks', 'miss']
    : pending.reason === 'flamethrower'
      ? ['no_barbecue']
      : pending.reason === 'analysis'
        ? ['anti_analysis']
        : ['im_fine_here'];

  const defenseCards = me.hand.filter((c) => allowedIds.includes(c.defId));
  const tradeableCards = me.hand.filter((c) => localTradeCheck(me, c));
  const fromName = game.players.find((p) => p.id === pending.fromId)?.name ?? pending.fromId;

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Ответ на действие', 'Respond')}</h3></div>
      <p className="helper-text">
        {text(lang, `${fromName} → ${actionReasonLabel(pending.reason, lang)}`, `${fromName} → ${actionReasonLabel(pending.reason, lang)}`)}
      </p>
      {defenseCards.length > 0 && (
        <>
          <h4 className="subheading">{text(lang, 'Защита', 'Defense')}</h4>
          <div className="hand-grid compact">
            {defenseCards.map((card) => (
              <div className="hand-card" key={card.uid}>
                <CardView card={card} faceUp lang={lang} />
                <button className="btn small danger" disabled={loading} onClick={() => void onAction({ type: 'PLAY_DEFENSE', cardUid: card.uid })} type="button">
                  {text(lang, 'Защититься', 'Defend')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {pending.reason === 'trade' && (
        <>
          <h4 className="subheading">{text(lang, 'Принять обмен', 'Accept trade')}</h4>
          <div className="hand-grid compact">
            {tradeableCards.map((card) => (
              <div className="hand-card" key={card.uid}>
                <CardView card={card} faceUp lang={lang} />
                <button className="btn small primary" disabled={loading} onClick={() => void onAction({ type: 'RESPOND_TRADE', cardUid: card.uid })} type="button">
                  {text(lang, 'Дать', 'Give')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {pending.reason !== 'trade' && (
        <div className="stack-actions" style={{ marginTop: '10px' }}>
          <button className="btn danger" disabled={loading} onClick={() => void onAction({ type: 'DECLINE_DEFENSE' })} type="button">
            {pending.reason === 'flamethrower'
              ? text(lang, 'Принять уничтожение', 'Accept elimination')
              : pending.reason === 'analysis'
                ? text(lang, 'Показать карты', 'Allow analysis')
                : text(lang, 'Принять перемещение', 'Accept swap')}
          </button>
        </div>
      )}
    </div>
  );
}

function PartyPassPanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'party_pass' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const iMyTurn = pending.pendingPlayerIds.includes(me.id);
  const alreadyChosen = pending.chosen.find((c) => c.playerId === me.id);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected' && me.role === 'infected') {
      return me.hand.filter((c) => c.defId === 'infected').length > 1;
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, '🎉 Вечеринка!', '🎉 Party!')}</h3></div>
      {alreadyChosen ? (
        <p className="helper-text">{text(lang, 'Выбрано. Ждём остальных…', 'Chosen. Waiting for others…')}</p>
      ) : iMyTurn ? (
        <>
          <p className="helper-text">{text(lang, 'Передайте карту соседу.', 'Pass a card to your neighbor.')}</p>
          <div className="hand-grid compact">
            {me.hand.map((card) => {
              const allowed = canGive(card);
              return (
                <div className="hand-card" key={card.uid}>
                  <CardView card={card} faceUp lang={lang} />
                  <button
                    className="btn small accent"
                    disabled={!allowed || loading}
                    onClick={() => void onAction({ type: 'PARTY_PASS_CARD', cardUid: card.uid, playerId: me.id })}
                    type="button"
                  >
                    {text(lang, 'Передать', 'Pass')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="helper-text">
          {text(lang, `Ждём (${pending.pendingPlayerIds.length} ост.)`, `Waiting (${pending.pendingPlayerIds.length} left)`)}
        </p>
      )}
      <div className="waiting-list">
        {game.players.filter((p) => pending.pendingPlayerIds.includes(p.id)).map((p) => (
          <span className="badge dim" key={p.id}>{p.name}…</span>
        ))}
        {game.players.filter((p) => pending.chosen.some((c) => c.playerId === p.id)).map((p) => (
          <span className="badge host" key={p.id}>✓ {p.name}</span>
        ))}
      </div>
    </div>
  );
}

function TemptationResponsePanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'temptation_response' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const isTarget = me.id === pending.toId;
  const fromPlayer = game.players.find((p) => p.id === pending.fromId);
  const offeredCard = fromPlayer?.hand?.find((c) => c.uid === pending.offeredCardUid);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  if (!isTarget) {
    return (
      <InfoPanel
        title={text(lang, 'Соблазн', 'Temptation')}
        body={text(
          lang,
          `${game.players.find((p) => p.id === pending.toId)?.name ?? '?'} выбирает карту…`,
          `${game.players.find((p) => p.id === pending.toId)?.name ?? '?'} is choosing…`,
        )}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Соблазн — ваш ход', 'Temptation — your turn')}</h3></div>
      <p className="helper-text">
        {text(lang, `${fromPlayer?.name ?? '?'} предлагает обмен.`, `${fromPlayer?.name ?? '?'} wants to trade.`)}
      </p>
      {offeredCard && (
        <div style={{ marginBottom: '6px' }}>
          <p className="helper-text" style={{ marginBottom: '4px' }}>{text(lang, 'Вам предлагают:', 'Offered to you:')}</p>
          <CardView card={offeredCard} faceUp={false} lang={lang} />
        </div>
      )}
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'TEMPTATION_RESPOND', cardUid: card.uid })} type="button">
                {text(lang, 'Отдать', 'Give')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JustBetweenUsPickPanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'just_between_us_pick' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const isA = me.id === pending.playerA;
  const isB = me.id === pending.playerB;
  const isInvolved = isA || isB;
  const myChoice = isA ? pending.cardUidA : pending.cardUidB;
  const alreadyChose = myChoice !== null;
  const partnerName = game.players.find((p) => p.id === (isA ? pending.playerB : pending.playerA))?.name ?? '?';

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected' && me.role === 'infected') {
      return me.hand.filter((c) => c.defId === 'infected').length > 1;
    }
    return true;
  };

  if (!isInvolved) {
    const aName = game.players.find((p) => p.id === pending.playerA)?.name ?? '?';
    const bName = game.players.find((p) => p.id === pending.playerB)?.name ?? '?';
    return (
      <InfoPanel
        title={text(lang, 'Только между нами', 'Just Between Us')}
        body={text(lang, `${aName} и ${bName} выбирают…`, `${aName} and ${bName} choosing…`)}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Только между нами', 'Just Between Us')}</h3></div>
      {alreadyChose ? (
        <p className="helper-text">{text(lang, `Выбрано. Ждём ${partnerName}…`, `Chosen. Waiting for ${partnerName}…`)}</p>
      ) : (
        <>
          <p className="helper-text">{text(lang, `Обмен с ${partnerName}.`, `Trade with ${partnerName}.`)}</p>
          <div className="hand-grid compact">
            {me.hand.map((card) => {
              const allowed = canGive(card);
              return (
                <div className="hand-card" key={card.uid}>
                  <CardView card={card} faceUp lang={lang} />
                  <button
                    className="btn small accent"
                    disabled={!allowed || loading}
                    onClick={() => void onAction({ type: 'JUST_BETWEEN_US_PICK', cardUid: card.uid, playerId: me.id })}
                    type="button"
                  >
                    {text(lang, 'Выбрать', 'Pick')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function JustBetweenUsPanel({
  game,
  lang,
  loading,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  pending: Extract<PendingAction, { type: 'just_between_us' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const alive = game.players
    .filter((p) => pending.targets.includes(p.id) && p.isAlive)
    .slice()
    .sort((a, b) => a.position - b.position);

  const seenPairs = new Set<string>();
  const pairs = alive
    .map((player, i) => {
      const next = alive[(i + 1) % alive.length];
      if (!next || next.id === player.id) return null;
      const key = [player.id, next.id].sort((a, b) => a - b).join('-');
      if (seenPairs.has(key)) return null;
      seenPairs.add(key);
      return [player, next] as const;
    })
    .filter((pair): pair is readonly [ViewerPlayerState, ViewerPlayerState] => Boolean(pair));

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Только между нами', 'Just Between Us')}</h3></div>
      <p className="helper-text">{text(lang, 'Выберите пару соседних игроков.', 'Pick two adjacent players.')}</p>
      <div className="stack-actions" style={{ marginTop: '8px' }}>
        {pairs.map(([p1, p2]) => (
          <button
            className="btn secondary"
            disabled={loading}
            key={`${p1.id}-${p2.id}`}
            onClick={() => void onAction({ type: 'JUST_BETWEEN_US_SELECT', player1: p1.id, player2: p2.id })}
            type="button"
          >
            {p1.name} ↔ {p2.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PANIC TARGET PANEL (for panic cards needing target selection)
══════════════════════════════════════════════════════════════════════ */
function PanicTargetPanel({
  game,
  lang,
  loading,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  pending: Extract<PendingAction, { type: 'panic_choose_target' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const cardName = getCardName(pending.panicDefId, lang);
  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Паника — выберите цель', 'Panic — choose target')}</h3></div>
      <p className="helper-text">{cardName}</p>
      <div className="stack-actions" style={{ marginTop: '8px' }}>
        {pending.targets.map((tid) => (
          <button className="btn secondary" disabled={loading} key={tid} onClick={() => void onAction({ type: 'PANIC_SELECT_TARGET', targetPlayerId: tid })} type="button">
            {game.players.find((p) => p.id === tid)?.name ?? tid}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   BLIND DATE PANEL (pick card to swap with deck)
══════════════════════════════════════════════════════════════════════ */
function BlindDatePanel({
  lang,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected' && me.role === 'infected') {
      return me.hand.filter((c) => c.defId === 'infected').length > 1;
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Свидание вслепую', 'Blind Date')}</h3></div>
      <p className="helper-text">{text(lang, 'Выберите карту для обмена с колодой.', 'Pick a card to swap with the deck.')}</p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'BLIND_DATE_PICK', cardUid: card.uid })} type="button">
                {text(lang, 'Обменять', 'Swap')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   FORGETFUL PANEL (discard cards)
══════════════════════════════════════════════════════════════════════ */
function ForgetfulPanel({
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'forgetful_discard' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Забывчивость', 'Forgetful')}</h3></div>
      <p className="helper-text">
        {text(lang, `Сбросьте ещё ${pending.remaining} карт(у).`, `Discard ${pending.remaining} more card(s).`)}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = card.defId !== 'the_thing' &&
            !(me.role === 'infected' && card.defId === 'infected' && me.hand.filter(c => c.defId === 'infected').length <= 1);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small secondary" disabled={!allowed || loading} onClick={() => void onAction({ type: 'FORGETFUL_DISCARD_PICK', cardUid: card.uid })} type="button">
                {text(lang, 'Сбросить', 'Discard')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PANIC TRADE PANEL (Can't We Be Friends? — pick card to give)
══════════════════════════════════════════════════════════════════════ */
function PanicTradePanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'panic_trade' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const target = game.players.find((p) => p.id === pending.targetPlayerId);
  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Давай дружить?', "Can't We Be Friends?")}</h3></div>
      <p className="helper-text">
        {text(lang, `Выберите карту для обмена с ${target?.name ?? '?'}`, `Pick card to trade with ${target?.name ?? '?'}`)}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'PANIC_TRADE_SELECT', targetPlayerId: pending.targetPlayerId, cardUid: card.uid })} type="button">
                {text(lang, 'Отдать', 'Give')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PANIC TRADE RESPONSE PANEL
══════════════════════════════════════════════════════════════════════ */
function PanicTradeResponsePanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'panic_trade_response' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const isTarget = me.id === pending.toId;
  const fromPlayer = game.players.find((p) => p.id === pending.fromId);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter((c) => c.defId === 'infected').length > 1;
      return false;
    }
    return true;
  };

  if (!isTarget) {
    return (
      <InfoPanel
        title={text(lang, 'Давай дружить?', "Can't We Be Friends?")}
        body={text(
          lang,
          `${game.players.find((p) => p.id === pending.toId)?.name ?? '?'} выбирает карту…`,
          `${game.players.find((p) => p.id === pending.toId)?.name ?? '?'} is choosing…`,
        )}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Давай дружить? — ваш ход', "Can't We Be Friends? — your turn")}</h3></div>
      <p className="helper-text">
        {text(lang, `${fromPlayer?.name ?? '?'} предлагает обмен.`, `${fromPlayer?.name ?? '?'} wants to trade.`)}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button className="btn small accent" disabled={!allowed || loading} onClick={() => void onAction({ type: 'PANIC_TRADE_RESPOND', cardUid: card.uid })} type="button">
                {text(lang, 'Отдать', 'Give')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   REVELATIONS PANEL
══════════════════════════════════════════════════════════════════════ */
function RevelationsPanel({
  game,
  lang,
  loading,
  me,
  pending,
  onAction,
}: {
  game: ViewerGameState;
  lang: Lang;
  loading: boolean;
  me: ViewerPlayerState;
  pending: Extract<PendingAction, { type: 'revelations_round' }>;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const revealerIdx = pending.revealOrder[pending.currentRevealerIdx];
  const revealer = game.players[revealerIdx];
  const isMyTurn = revealer?.id === me.id;

  if (!isMyTurn) {
    return (
      <InfoPanel
        title={text(lang, 'Время признаний', 'Revelations')}
        body={text(lang, `${revealer?.name ?? '?'} решает, показывать ли карты…`, `${revealer?.name ?? '?'} is deciding…`)}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Время признаний', 'Revelations')}</h3></div>
      <p className="helper-text">{text(lang, 'Показать свои карты всем?', 'Show your cards to everyone?')}</p>
      <div className="stack-actions" style={{ marginTop: '8px' }}>
        <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'REVELATIONS_RESPOND', show: true })} type="button">
          {text(lang, 'Показать', 'Show')}
        </button>
        <button className="btn secondary" disabled={loading} onClick={() => void onAction({ type: 'REVELATIONS_RESPOND', show: false })} type="button">
          {text(lang, 'Пропустить', 'Pass')}
        </button>
      </div>
    </div>
  );
}
