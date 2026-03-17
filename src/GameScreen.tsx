import { getCardDef, getCardName, getCardDescription } from './cards.ts';
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
  const current = getCurrentPlayer(game);
  const myTurn = current.id === me.id;
  const summary = pendingSummary(game.pendingAction, game, lang);
  const pendingOwnerId = extractPendingOwner(game.pendingAction);
  const pendingOwnerName = pendingOwnerId === null
    ? null
    : game.players.find((player) => player.id === pendingOwnerId)?.name ?? null;

  if (game.phase === 'game_over') {
    return (
      <main className="game-screen">
        <TopBar lang={lang} room={room} onCopy={onCopy} onLeave={onLeave} />
        <section className="panel game-over-panel">
          <h1 className="hero-title small">{text(lang, 'Партия завершена', 'Match finished')}</h1>
          <p className={`winner-line ${game.winner === 'humans' ? 'human-win' : 'thing-win'}`}>
            {game.winner === 'humans'
              ? text(lang, 'Люди победили', 'Humans win')
              : game.winner === 'thing_solo'
                ? text(lang, 'Нечто победило в одиночку', 'The Thing wins alone')
                : text(lang, 'Нечто победило', 'The Thing wins')}
          </p>

          <div className="results-grid">
            {game.players.map((player) => (
              <div className={`result-card ${game.winnerPlayerIds.includes(player.id) ? 'winner' : ''}`} key={player.id}>
                <strong>{player.name}</strong>
                <span>{roleLabel(player.role, lang)}</span>
                <span>{player.isAlive ? text(lang, 'Жив', 'Alive') : text(lang, 'Уничтожен', 'Eliminated')}</span>
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
              <p className="helper-text">{text(lang, 'Хост может вернуть всех в лобби для новой партии.', 'The host can return everyone to the lobby for a new match.')}</p>
            )}
            {error && <p className="error-text">{error}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="game-screen">
      <TopBar lang={lang} room={room} onCopy={onCopy} onLeave={onLeave} />

      <section className="status-strip">
        <div className="status-card">
          <span>{text(lang, 'Вы', 'You')}</span>
          <strong>{me.name}</strong>
          <small>{roleLabel(me.role, lang)}</small>
        </div>
        <div className="status-card">
          <span>{text(lang, 'Этап', 'Step')}</span>
          <strong>{stepLabel(game.step, lang)}</strong>
          <small>{game.direction === 1 ? text(lang, 'По часовой', 'Clockwise') : text(lang, 'Против часовой', 'Counter-clockwise')}</small>
        </div>
        <div className={`status-card ${myTurn ? 'active' : ''}`}>
          <span>{text(lang, 'Состояние', 'Status')}</span>
          <strong>{myTurn ? text(lang, 'Ваш ход', 'Your turn') : text(lang, 'Ожидание', 'Waiting')}</strong>
          <small>
            {myTurn
              ? text(lang, 'Вы можете действовать.', 'You can act now.')
              : summary ?? text(lang, 'Следите за столом и журналом событий.', 'Watch the table and the event log.')}
          </small>
        </div>
      </section>

      {/* Panic announcement banner — visible to ALL players */}
      {game.panicAnnouncement && (
        <section className="panic-banner">
          <div className="panic-banner-icon">⚠</div>
          <div className="panic-banner-content">
            <strong>{text(lang, 'Паника!', 'Panic!')}</strong>
            <span className="panic-banner-name">{getCardName(game.panicAnnouncement, lang)}</span>
            <p className="panic-banner-desc">{getCardDescription(game.panicAnnouncement, lang)}</p>
          </div>
        </section>
      )}

      <section className="table-layout">
        <div className="table-main">
          <div className="panel board-panel">
            <div className="panel-header">
              <h3>{text(lang, 'Стол', 'Table')}</h3>
              <span className="helper-text">{text(lang, `Ходит ${current.name}`, `${current.name}'s turn`)}</span>
            </div>

            <PlayerCircle game={game} lang={lang} me={me} />

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
                  {text(lang, 'Взять карту', 'Draw card')}
                </button>
              )}

              {myTurn && me.role === 'thing' && game.step !== 'draw' && (
                <button className="btn danger" disabled={loading} onClick={() => void onAction({ type: 'DECLARE_VICTORY' })} type="button">
                  {text(lang, 'Объявить победу', 'Declare victory')}
                </button>
              )}

              {myTurn && game.step === 'end_turn' && (
                <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'END_TURN' })} type="button">
                  {text(lang, 'Завершить ход', 'End turn')}
                </button>
              )}
            </div>

            {(summary || pendingOwnerName) && (
              <div className="notice-box">
                <strong>{text(lang, 'Сейчас на столе', 'Current table state')}</strong>
                <p>{summary}</p>
                {!summary && pendingOwnerName && (
                  <p>{text(lang, `Ожидается действие игрока ${pendingOwnerName}.`, `Waiting for ${pendingOwnerName}.`)}</p>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>{text(lang, 'Ваша рука', 'Your hand')}</h3>
              <span className="helper-text">{me.hand.length} {text(lang, 'карт', 'cards')}</span>
            </div>
            <PlayerHand game={game} lang={lang} loading={loading} me={me} onAction={onAction} />
          </div>
        </div>

        <div className="table-side">
          <PendingActionPanel game={game} lang={lang} loading={loading} me={me} onAction={onAction} />
          <EventLog game={game} lang={lang} />
          {error && <div className="panel"><p className="error-text">{error}</p></div>}
        </div>
      </section>
    </main>
  );
}

function TopBar({
  lang,
  room,
  onCopy,
  onLeave,
}: {
  lang: Lang;
  room: RoomView;
  onCopy: () => Promise<void>;
  onLeave: () => void;
}) {
  return (
    <section className="top-bar">
      <div>
        <p className="eyebrow">{text(lang, 'Комната', 'Room')}</p>
        <h2 className="room-inline">{room.code}</h2>
      </div>
      <div className="room-banner-actions">
        <button className="btn secondary" onClick={() => void onCopy()} type="button">
          {text(lang, 'Скопировать ссылку', 'Copy link')}
        </button>
        <button className="btn ghost" onClick={onLeave} type="button">
          {text(lang, 'Выйти', 'Leave')}
        </button>
      </div>
    </section>
  );
}

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
        const radius = 42;
        const x = 50 + radius * Math.cos((angle * Math.PI) / 180);
        const y = 50 + radius * Math.sin((angle * Math.PI) / 180);
        const currentPlayer = player.id === current.id;
        const self = player.id === me.id;

        return (
          <div className={`player-node ${currentPlayer ? 'active' : ''} ${self ? 'self' : ''} ${player.isAlive ? '' : 'dead'}`} key={player.id} style={{ left: `${x}%`, top: `${y}%` }}>
            <div className="player-avatar">{player.name.charAt(0).toUpperCase()}</div>
            <div className="player-meta">
              <strong>{player.name}</strong>
              <span>{self ? roleLabel(player.role, lang) : text(lang, `${player.handCount} карт`, `${player.handCount} cards`)}</span>
            </div>
            {player.inQuarantine && <div className="token quarantine">Q{player.quarantineTurnsLeft}</div>}
            {!player.isAlive && <div className="token dead">OUT</div>}
          </div>
        );
      })}

      {game.doors.map((door, index) => {
        const first = game.players.find((player) => player.position === door.between[0]);
        const second = game.players.find((player) => player.position === door.between[1]);
        if (!first || !second || !hasDoorBetween(game as never, first.position, second.position)) return null;

        const firstAngle = (first.position / total) * 360 - 90;
        const secondAngle = (second.position / total) * 360 - 90;
        const midAngle = (firstAngle + secondAngle) / 2;
        const x = 50 + 42 * Math.cos((midAngle * Math.PI) / 180);
        const y = 50 + 42 * Math.sin((midAngle * Math.PI) / 180);

        return (
          <div className="door-marker" key={`${door.between.join('-')}-${index}`} style={{ left: `${x}%`, top: `${y}%` }}>
            {text(lang, 'Дверь', 'Door')}
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
        const canPlay = getCurrentPlayer(game).id === me.id && game.step === 'play_or_discard' && canPlayCard(game as never, card.defId);
        const canDiscard = getCurrentPlayer(game).id === me.id && game.step === 'play_or_discard' && canDiscardCard(game as never, me as never, card.uid);
        const canTrade = getCurrentPlayer(game).id === me.id && game.step === 'trade' && localTradeCheck(me, card);

        return (
          <div className="hand-card" key={card.uid}>
            <CardView card={card} faceUp lang={lang} />
            <div className="hand-card-actions">
              {canPlay && <button className="btn small primary" disabled={loading} onClick={() => void onAction({ type: 'PLAY_CARD', cardUid: card.uid })} type="button">{text(lang, 'Сыграть', 'Play')}</button>}
              {canDiscard && <button className="btn small secondary" disabled={loading} onClick={() => void onAction({ type: 'DISCARD_CARD', cardUid: card.uid })} type="button">{text(lang, 'Сбросить', 'Discard')}</button>}
              {canTrade && <button className="btn small accent" disabled={loading} onClick={() => void onAction({ type: 'OFFER_TRADE', cardUid: card.uid })} type="button">{text(lang, 'Обменять', 'Offer')}</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
    return <InfoPanel title={text(lang, 'Активное действие', 'Active action')} body={text(lang, 'Сейчас у вас нет отдельного запроса на выбор или подтверждение.', 'There is no private prompt waiting for you right now.')} />;
  }

  if (pending.type === 'choose_target') {
    return <TargetPanel game={game} lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'choose_card_to_discard') {
    return <DiscardPanel game={game} lang={lang} loading={loading} me={me} onAction={onAction} />;
  }
  if (pending.type === 'persistence_pick') {
    return <PersistencePanel lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'choose_card_to_give') {
    return <TemptationPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'view_hand' || pending.type === 'view_card' || pending.type === 'whisky_reveal') {
    return <RevealPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'trade_defense') {
    return <TradeDefensePanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'just_between_us') {
    return <JustBetweenUsPanel game={game} lang={lang} loading={loading} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'just_between_us_pick') {
    return <JustBetweenUsPickPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'party_pass') {
    return <PartyPassPanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  }
  if (pending.type === 'temptation_response') {
    return <TemptationResponsePanel game={game} lang={lang} loading={loading} me={me} pending={pending} onAction={onAction} />;
  }

  return <InfoPanel title={text(lang, 'Активное действие', 'Active action')} body={text(lang, 'Это действие сейчас не требует ответа с вашего устройства.', 'This action does not require a response from your device right now.')} />;
}

function EventLog({ game, lang }: { game: ViewerGameState; lang: Lang }) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Журнал событий', 'Event log')}</h3></div>
      <div className="log-list">
        {game.log.slice(0, 24).map((entry) => (
          <div className="log-entry" key={entry.id}>{lang === 'ru' ? entry.textRu : entry.text}</div>
        ))}
      </div>
    </div>
  );
}

function CardView({ card, faceUp, lang }: { card: CardInstance; faceUp: boolean; lang: Lang }) {
  const def = getCardDef(card.defId);
  if (!faceUp) return <div className={`card card-back ${def.back === 'panic' ? 'panic-back' : 'event-back'}`}>{def.back === 'panic' ? text(lang, 'Паника', 'Panic') : text(lang, 'Событие', 'Event')}</div>;

  return (
    <div className={`card cat-${def.category}`}>
      <div className={`card-badge badge-${def.category}`}>{cardCategoryLabel(card, lang)}</div>
      <div className="card-name">{lang === 'ru' ? def.nameRu : def.name}</div>
      <div className="card-desc">{lang === 'ru' ? def.descriptionRu : def.description}</div>
    </div>
  );
}

function InfoPanel({ title, body }: { title: string; body: string }) {
  return <div className="panel"><div className="panel-header"><h3>{title}</h3></div><p className="helper-text">{body}</p></div>;
}

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
      <div className="panel-header"><h3>{text(lang, 'Выберите цель', 'Choose a target')}</h3></div>
      <p className="helper-text">{getCardName(pending.cardDefId, lang)}</p>
      <div className="stack-actions">
        {pending.targets.map((targetId) => (
          <button className="btn secondary" disabled={loading} key={targetId} onClick={() => void onAction({ type: 'SELECT_TARGET', targetPlayerId: targetId })} type="button">
            {game.players.find((player) => player.id === targetId)?.name ?? targetId}
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
      <div className="panel-header"><h3>{text(lang, 'Выберите сброс', 'Choose a discard')}</h3></div>
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
                discardUids: pending.drawnCards.filter((item) => item.uid !== card.uid).map((item) => item.uid),
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
  const target = game.players.find((player) => player.id === pending.targetPlayerId);

  // Filter cards: can't give The Thing, humans/infected can't give Infected (only Thing can infect)
  const canGiveCard = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true; // Thing can pass Infected
      if (me.role === 'infected') {
        // Infected can only give Infected back to Thing, must keep 1
        return me.hand.filter(c => c.defId === 'infected').length > 1;
      }
      return false; // Humans can't give Infected
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Соблазн', 'Temptation')}</h3></div>
      <p className="helper-text">
        {text(
          lang,
          `Выберите карту, которую хотите отдать игроку ${target?.name ?? pending.targetPlayerId}.`,
          `Choose the card you want to give to ${target?.name ?? pending.targetPlayerId}.`,
        )}
      </p>
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGiveCard(card);
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
  const ownerName = game.players.find((player) => player.id === ownerId)?.name ?? ownerId;
  const canConfirm = pending.viewerPlayerId === me.id;

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Просмотр карт', 'Card reveal')}</h3></div>
      <p className="helper-text">
        {pending.type === 'whisky_reveal'
          ? text(lang, `${ownerName} показывает свои карты всем.`, `${ownerName} is showing their cards to everyone.`)
          : text(lang, `Карты игрока ${ownerName}.`, `${ownerName}'s cards.`)}
      </p>
      <div className="hand-grid compact">
        {cards.map((card) => <CardView card={card} faceUp key={card.uid} lang={lang} />)}
      </div>
      {canConfirm ? (
        <button className="btn primary" disabled={loading} onClick={() => void onAction({ type: 'CONFIRM_VIEW' })} type="button">
          {text(lang, 'Подтвердить', 'Confirm')}
        </button>
      ) : (
        <p className="helper-text">{text(lang, 'Подтверждение ждёт другого игрока.', 'Another player needs to confirm this reveal.')}</p>
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
  const allowedDefenseIds = pending.reason === 'trade' ? ['fear', 'no_thanks', 'miss'] : pending.reason === 'flamethrower' ? ['no_barbecue'] : ['im_fine_here'];
  const defenseCards = me.hand.filter((card) => allowedDefenseIds.includes(card.defId));
  const tradeableCards = me.hand.filter((card) => localTradeCheck(me, card));
  const fromName = game.players.find((player) => player.id === pending.fromId)?.name ?? pending.fromId;

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Ответ на действие', 'Respond to action')}</h3></div>
      <p className="helper-text">
        {text(
          lang,
          `${fromName} инициировал ${actionReasonLabel(pending.reason, lang)} против вас.`,
          `${fromName} initiated a ${actionReasonLabel(pending.reason, lang)} against you.`,
        )}
      </p>
      {defenseCards.length > 0 && (
        <>
          <h4 className="subheading">{text(lang, 'Доступная защита', 'Available defense')}</h4>
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
          <h4 className="subheading">{text(lang, 'Или принять обмен', 'Or accept the trade')}</h4>
          <div className="hand-grid compact">
            {tradeableCards.map((card) => (
              <div className="hand-card" key={card.uid}>
                <CardView card={card} faceUp lang={lang} />
                <button className="btn small primary" disabled={loading} onClick={() => void onAction({ type: 'RESPOND_TRADE', cardUid: card.uid })} type="button">
                  {text(lang, 'Дать эту карту', 'Give this card')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {pending.reason !== 'trade' && (
        <div className="stack-actions" style={{ marginTop: '12px' }}>
          <button
            className="btn danger"
            disabled={loading}
            onClick={() => void onAction({ type: 'DECLINE_DEFENSE' })}
            type="button"
          >
            {pending.reason === 'flamethrower'
              ? text(lang, 'Не защищаться (принять уничтожение)', 'Don\'t defend (accept elimination)')
              : text(lang, 'Не защищаться (принять перемещение)', 'Don\'t defend (accept swap)')}
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
  const alreadyChosen = pending.chosen.find(c => c.playerId === me.id);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected' && me.role === 'infected') {
      return me.hand.filter(c => c.defId === 'infected').length > 1;
    }
    return true;
  };

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Вечеринка!', 'Party!')}</h3></div>
      {alreadyChosen ? (
        <p className="helper-text">{text(lang, 'Вы выбрали карту. Ожидание остальных игроков…', 'You chose a card. Waiting for other players…')}</p>
      ) : iMyTurn ? (
        <>
          <p className="helper-text">{text(lang, 'Выберите карту, которую хотите передать соседу.', 'Choose a card to pass to your neighbor.')}</p>
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
          {text(
            lang,
            `Ожидание других игроков (${pending.pendingPlayerIds.length} остал.)`,
            `Waiting for other players (${pending.pendingPlayerIds.length} remaining)`,
          )}
        </p>
      )}
      <div className="waiting-list">
        {game.players.filter(p => pending.pendingPlayerIds.includes(p.id)).map(p => (
          <span className="badge dim" key={p.id}>{p.name}…</span>
        ))}
        {game.players.filter(p => pending.chosen.some(c => c.playerId === p.id)).map(p => (
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
  const fromPlayer = game.players.find(p => p.id === pending.fromId);
  const offeredCard = fromPlayer?.hand?.find(c => c.uid === pending.offeredCardUid);

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected') {
      if (me.role === 'thing') return true;
      if (me.role === 'infected') return me.hand.filter(c => c.defId === 'infected').length > 1;
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
          `${game.players.find(p => p.id === pending.toId)?.name ?? '?'} выбирает карту для обмена…`,
          `${game.players.find(p => p.id === pending.toId)?.name ?? '?'} is choosing a card to give…`,
        )}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Соблазн — ваш ответ', 'Temptation — your reply')}</h3></div>
      <p className="helper-text">
        {text(
          lang,
          `${fromPlayer?.name ?? '?'} предлагает вам обмен. Выберите карту, которую хотите отдать.`,
          `${fromPlayer?.name ?? '?'} wants to trade with you. Choose a card to give back.`,
        )}
      </p>
      {offeredCard && (
        <div style={{ marginBottom: '0.5rem' }}>
          <p className="helper-text">{text(lang, 'Карта, которую вам предлагают:', 'Card being offered to you:')}</p>
          <CardView card={offeredCard} faceUp={false} lang={lang} />
        </div>
      )}
      <div className="hand-grid compact">
        {me.hand.map((card) => {
          const allowed = canGive(card);
          return (
            <div className="hand-card" key={card.uid}>
              <CardView card={card} faceUp lang={lang} />
              <button
                className="btn small accent"
                disabled={!allowed || loading}
                onClick={() => void onAction({ type: 'TEMPTATION_RESPOND', cardUid: card.uid })}
                type="button"
              >
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
  const partnerName = game.players.find(p => p.id === (isA ? pending.playerB : pending.playerA))?.name ?? '?';

  const canGive = (card: { defId: string }) => {
    if (card.defId === 'the_thing') return false;
    if (card.defId === 'infected' && me.role === 'infected') {
      return me.hand.filter(c => c.defId === 'infected').length > 1;
    }
    return true;
  };

  if (!isInvolved) {
    const aName = game.players.find(p => p.id === pending.playerA)?.name ?? '?';
    const bName = game.players.find(p => p.id === pending.playerB)?.name ?? '?';
    return (
      <InfoPanel
        title={text(lang, 'Только между нами', 'Just Between Us')}
        body={text(lang, `${aName} и ${bName} выбирают карты для обмена…`, `${aName} and ${bName} are choosing cards to trade…`)}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Только между нами', 'Just Between Us')}</h3></div>
      {alreadyChose ? (
        <p className="helper-text">
          {text(lang, `Вы выбрали карту. Ожидание ${partnerName}…`, `You chose a card. Waiting for ${partnerName}…`)}
        </p>
      ) : (
        <>
          <p className="helper-text">
            {text(
              lang,
              `Выберите карту для обмена с ${partnerName}.`,
              `Choose a card to trade with ${partnerName}.`,
            )}
          </p>
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
    .filter((player) => pending.targets.includes(player.id) && player.isAlive)
    .slice()
    .sort((left, right) => left.position - right.position);
  const seenPairs = new Set<string>();
  const pairs = alive
    .map((player, index) => {
      const next = alive[(index + 1) % alive.length];
      if (!next || next.id === player.id) return null;
      const key = [player.id, next.id].sort((left, right) => left - right).join('-');
      if (seenPairs.has(key)) return null;
      seenPairs.add(key);
      return [player, next] as const;
    })
    .filter((pair): pair is readonly [ViewerPlayerState, ViewerPlayerState] => Boolean(pair));

  return (
    <div className="panel">
      <div className="panel-header"><h3>{text(lang, 'Только между нами', 'Just Between Us')}</h3></div>
      <p className="helper-text">{text(lang, 'Выберите двух соседних игроков, которые обязаны обменяться картами.', 'Choose two adjacent players who must trade cards.')}</p>
      <div className="stack-actions">
        {pairs.map(([player1, player2]) => (
          <button
            className="btn secondary"
            disabled={loading}
            key={`${player1.id}-${player2.id}`}
            onClick={() => void onAction({ type: 'JUST_BETWEEN_US_SELECT', player1: player1.id, player2: player2.id })}
            type="button"
          >
            {player1.name} + {player2.name}
          </button>
        ))}
      </div>
    </div>
  );
}
