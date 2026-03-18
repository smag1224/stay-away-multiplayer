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
      <section className="hero-panel">
        <p className="eyebrow">{text(lang, 'Мультиплеерная версия', 'Multiplayer Edition')}</p>
        <h1 className="hero-title">Stay Away!</h1>
        <p className="version-tag">v1.2b</p>
        <p className="hero-subtitle">
          {text(
            lang,
            'Каждый игрок подключается со своего телефона или ноутбука. Ход общий, карты приватные, комната живая для всех.',
            'Each player joins from their own phone or laptop. Turns stay shared, cards stay private, and the room stays synced for everyone.',
          )}
        </p>
      </section>

      <section className="connect-card">
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

        <div className="connect-actions">
          <button className="btn primary" disabled={loading} onClick={onCreateRoom} type="button">
            {text(lang, 'Создать комнату', 'Create room')}
          </button>
        </div>

        <div className="divider">
          <span>{text(lang, 'или войти по коду', 'or join with a code')}</span>
        </div>

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

        <button className="btn secondary" disabled={loading} onClick={onJoinRoom} type="button">
          {text(lang, 'Присоединиться', 'Join room')}
        </button>

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
        <div>
          <p className="eyebrow">{text(lang, 'Код комнаты', 'Room code')}</p>
          <h2 className="room-code">{room.code}</h2>
          <p className="helper-text">
            {text(
              lang,
              'Откройте эту же ссылку на других устройствах в одной сети.',
              'Open the same link on other devices in the same network.',
            )}
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
        <div className="panel">
          <h3>{text(lang, 'Игроки в комнате', 'Players in room')}</h3>
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

        <div className="panel">
          <h3>{text(lang, 'Перед стартом', 'Before starting')}</h3>
          <ul className="plain-list">
            <li>{text(lang, 'Минимум 4 игрока, максимум 12.', 'Minimum 4 players, maximum 12.')}</li>
            <li>{text(lang, 'После старта роли и руки будут видны только владельцу устройства.', 'Once the game starts, roles and hands are visible only on the owner’s device.')}</li>
            <li>{text(lang, 'Исходная hot-seat версия не изменялась: вы играете в отдельной копии проекта.', 'The original hot-seat version was left untouched: you are playing from a separate project copy.')}</li>
          </ul>

          <div className="share-box">
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
