import type { RoomView } from './multiplayer.ts';
import type { Lang } from './appHelpers.ts';
import { text } from './appHelpers.ts';

export function ConnectScreen({
  copied,
  error,
  joinCode,
  lang,
  loading,
  name,
  onCreateRoom,
  onJoinRoom,
  onJoinCodeChange,
  onNameChange,
}: {
  copied: boolean;
  error: string | null;
  joinCode: string;
  lang: Lang;
  loading: boolean;
  name: string;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onJoinCodeChange: (value: string) => void;
  onNameChange: (value: string) => void;
}) {
  return (
    <main className="connect-screen">
      <section className="landing-stage">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">{text(lang, 'Полярная станция', 'Polar Station')}</p>
            <h1 className="hero-title">Stay Away!</h1>
            <p className="version-tag">v1.2</p>
            <p className="hero-subtitle">
              {text(
                lang,
                'Соберите игроков за одним виртуальным столом: роли скрыты, подозрения растут, а каждая карта выглядит как улика из ледяной изоляции.',
                'Gather everyone around one virtual table: roles stay hidden, suspicion grows, and every card feels like evidence from an icebound station.',
              )}
            </p>
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <span>{text(lang, 'Игроки', 'Players')}</span>
              <strong>4-12</strong>
            </div>
            <div className="hero-stat">
              <span>{text(lang, 'Режим', 'Mode')}</span>
              <strong>{text(lang, 'Онлайн-стол', 'Online table')}</strong>
            </div>
            <div className="hero-stat">
              <span>{text(lang, 'Тон', 'Tone')}</span>
              <strong>{text(lang, 'Паранойя', 'Paranoia')}</strong>
            </div>
          </div>

          <div className="hero-intel panel">
            <p className="eyebrow">{text(lang, 'Брифинг', 'Briefing')}</p>
            <div className="signal-list">
              <div className="signal-item">
                <strong>{text(lang, 'Один экран на игрока', 'One screen per player')}</strong>
                <span>{text(lang, 'Руки и роли остаются приватными.', 'Hands and roles remain private.')}</span>
              </div>
              <div className="signal-item">
                <strong>{text(lang, 'Общий темп партии', 'Shared match flow')}</strong>
                <span>{text(lang, 'Ходы, события и журнал синхронизированы для всех.', 'Turns, events, and the log stay synced for everyone.')}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="connect-card dossier-card">
          <div className="card-section">
            <p className="eyebrow">{text(lang, 'Идентификация', 'Identification')}</p>
            <label className="field-label">
              {text(lang, 'Ваше имя', 'Your name')}
              <input
                className="text-input"
                maxLength={20}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={text(lang, 'Например, Антон', 'For example, Alex')}
                type="text"
                value={name}
              />
            </label>
          </div>

          <div className="card-section">
            <button className="btn primary wide" disabled={loading} onClick={onCreateRoom} type="button">
              {text(lang, 'Создать комнату', 'Create room')}
            </button>
            <p className="helper-text">
              {text(
                lang,
                'Если вы хост, сначала создайте комнату и отправьте ссылку остальным.',
                'If you are hosting, create a room first and share the link with the others.',
              )}
            </p>
          </div>

          <div className="divider">
            <span>{text(lang, 'или войти по коду', 'or join with a code')}</span>
          </div>

          <div className="card-section">
            <label className="field-label">
              {text(lang, 'Код комнаты', 'Room code')}
              <input
                className="text-input code-input"
                maxLength={5}
                onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())}
                placeholder="AB12C"
                type="text"
                value={joinCode}
              />
            </label>

            <button className="btn secondary wide" disabled={loading} onClick={onJoinRoom} type="button">
              {text(lang, 'Присоединиться', 'Join room')}
            </button>
          </div>

          <p className="helper-text">
            {text(
              lang,
              'Хост открывает игру на своём компьютере, остальные переходят по ссылке или вводят код комнаты.',
              'The host opens the game on their computer, and everyone else joins with the room code or a shared link.',
            )}
          </p>

          {copied && <p className="success-text">{text(lang, 'Ссылка скопирована.', 'Link copied.')}</p>}
          {error && <p className="error-text">{error}</p>}
        </section>
      </section>

      <section className="evidence-strip" aria-label={text(lang, 'Карточки атмосферы', 'Atmosphere cards')}>
        <article className="evidence-card">
          <img alt="" src="/cards/the_thing.png" />
          <div className="evidence-copy">
            <span>{text(lang, 'Скрытая роль', 'Hidden role')}</span>
            <strong>{text(lang, 'Нечто среди вас', 'The Thing is among you')}</strong>
          </div>
        </article>
        <article className="evidence-card">
          <img alt="" src="/cards/flamethrower.png" />
          <div className="evidence-copy">
            <span>{text(lang, 'Последний довод', 'Last resort')}</span>
            <strong>{text(lang, 'Огнемёт решает спор', 'Flamethrower settles disputes')}</strong>
          </div>
        </article>
        <article className="evidence-card">
          <img alt="" src="/cards/quarantine.png" />
          <div className="evidence-copy">
            <span>{text(lang, 'Изоляция', 'Isolation')}</span>
            <strong>{text(lang, 'Никому нельзя верить', 'Trust no one')}</strong>
          </div>
        </article>
      </section>
    </main>
  );
}

export function LobbyScreen({
  copied,
  error,
  lang,
  loading,
  room,
  shareUrl,
  thingInDeck,
  onCopy,
  onLeave,
  onReset,
  onStart,
  onThingInDeckChange,
}: {
  copied: boolean;
  error: string | null;
  lang: Lang;
  loading: boolean;
  room: RoomView;
  shareUrl: string;
  thingInDeck: boolean;
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onReset: () => Promise<void>;
  onStart: () => Promise<void>;
  onThingInDeckChange: (value: boolean) => void;
}) {
  const canStart = room.me.isHost && room.members.length >= 4;

  return (
    <main className="lobby-screen">
      <section className="room-banner">
        <div className="room-banner-copy">
          <p className="eyebrow">{text(lang, 'Код комнаты', 'Room code')}</p>
          <div className="room-banner-main">
            <div>
              <h2 className="room-code">{room.code}</h2>
              <p className="helper-text">
                {text(
                  lang,
                  'Откройте эту же ссылку на других устройствах в одной сети.',
                  'Open the same link on other devices in the same network.',
                )}
              </p>
            </div>
            <div className="status-pills">
              <span className="status-pill">{room.members.length} {text(lang, 'в комнате', 'in room')}</span>
              <span className="status-pill">{Math.max(0, 4 - room.members.length)} {text(lang, 'до старта', 'to start')}</span>
              <span className="status-pill">{room.me.isHost ? text(lang, 'Вы хост', 'You are host') : text(lang, 'Гость', 'Guest')}</span>
            </div>
          </div>
          <p className="helper-text">
            {text(lang, 'Ссылка и код уже готовы для приглашения остальных.', 'The link and code are ready to invite everyone else.')}
          </p>
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

      <section className="lobby-grid">
        <div className="panel roster-panel">
          <div className="panel-header">
            <h3>{text(lang, 'Игроки в комнате', 'Players in room')}</h3>
            <span className="panel-caption">{text(lang, 'Живой список подключения', 'Live connection roster')}</span>
          </div>
          <div className="member-list">
            {room.members.map((member, index) => (
              <div className="member-row" key={member.sessionId}>
                <span className="member-index">{index + 1}</span>
                <span className="member-name">
                  {member.name}
                  {member.sessionId === room.me.sessionId && ` ${text(lang, '(вы)', '(you)')}`}
                </span>
                <span className="member-badges">
                  {member.isHost && <span className="badge host">{text(lang, 'хост', 'host')}</span>}
                  {!member.connected && <span className="badge dim">{text(lang, 'офлайн', 'offline')}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel briefing-panel">
          <div className="panel-header">
            <h3>{text(lang, 'Перед стартом', 'Before starting')}</h3>
            <span className="panel-caption">{text(lang, 'Командный брифинг', 'Team briefing')}</span>
          </div>
          <ul className="plain-list">
            <li>{text(lang, 'Минимум 4 игрока, максимум 12.', 'Minimum 4 players, maximum 12.')}</li>
            <li>{text(lang, 'После старта роли и руки будут видны только владельцу устройства.', 'Once the game starts, roles and hands are visible only on the owner’s device.')}</li>
            <li>{text(lang, 'Исходная hot-seat версия не изменялась: вы играете в отдельной копии проекта.', 'The original hot-seat version was left untouched: you are playing from a separate project copy.')}</li>
          </ul>

          <div className="share-box">
            <span className="share-label">{text(lang, 'Ссылка приглашения', 'Invite link')}</span>
            <span className="share-url">{shareUrl}</span>
          </div>

          {room.me.isHost ? (
            <div className="stack-actions">
              <label className="toggle-row">
                <input
                  checked={thingInDeck}
                  type="checkbox"
                  onChange={(e) => onThingInDeckChange(e.target.checked)}
                />
                <span>
                  {text(
                    lang,
                    'Замешать «Нечто» в колоду (вариант)',
                    'Shuffle "The Thing" into deck (variant)',
                  )}
                </span>
              </label>
              <p className="helper-text">
                {thingInDeck
                  ? text(lang, 'Карта «Нечто» замешана в колоду — игрок, вытащивший её, становится Нечто.', 'The Thing card is in the deck — whoever draws it becomes The Thing.')
                  : text(lang, 'Карта «Нечто» выдаётся случайному игроку в начале (стандарт).', '"The Thing" card is dealt to a random player at the start (standard).')}
              </p>
              <button className="btn primary" disabled={!canStart || loading} onClick={() => void onStart()} type="button">
                {text(lang, 'Начать партию', 'Start match')}
              </button>
              <button className="btn ghost" disabled={loading} onClick={() => void onReset()} type="button">
                {text(lang, 'Сбросить комнату', 'Reset room')}
              </button>
            </div>
          ) : (
            <p className="helper-text">{text(lang, 'Только хост может начать партию.', 'Only the host can start the match.')}</p>
          )}

          {copied && <p className="success-text">{text(lang, 'Ссылка скопирована.', 'Link copied.')}</p>}
          {error && <p className="error-text">{error}</p>}
        </div>
      </section>
    </main>
  );
}
