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
      <div className="connect-center">
        <h1 className="hero-title">Stay Away!</h1>
        <p className="version-tag">v1.2</p>

        <div className="connect-card">
          <label className="field-label">
            {text(lang, 'Ваше имя', 'Your name')}
            <input
              className="text-input"
              maxLength={20}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={text(lang, 'Например, Антон', 'e.g. Alex')}
              type="text"
              value={name}
            />
          </label>

          <button className="btn primary wide" disabled={loading} onClick={onCreateRoom} type="button">
            {text(lang, 'Создать комнату', 'Create room')}
          </button>

          <div className="divider">
            <span>{text(lang, 'или войти по коду', 'or join by code')}</span>
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

          <button className="btn secondary wide" disabled={loading} onClick={onJoinRoom} type="button">
            {text(lang, 'Присоединиться', 'Join room')}
          </button>

          {copied && <p className="success-text">{text(lang, 'Ссылка скопирована.', 'Link copied.')}</p>}
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
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
          <h2 className="room-code">{room.code}</h2>
          <p className="helper-text">
            {text(lang, `${room.members.length} в комнате · ${Math.max(0, 4 - room.members.length)} до старта`, `${room.members.length} in room · ${Math.max(0, 4 - room.members.length)} to start`)}
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
          <div className="panel-header">
            <h3>{text(lang, 'Игроки', 'Players')}</h3>
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

        <div className="panel">
          <div className="panel-header">
            <h3>{text(lang, 'Настройки', 'Settings')}</h3>
          </div>

          <div className="share-box">
            <span className="share-url">{shareUrl}</span>
          </div>

          {room.me.isHost ? (
            <div className="stack-actions" style={{ marginTop: '14px' }}>
              <label className="toggle-row">
                <input
                  checked={thingInDeck}
                  type="checkbox"
                  onChange={(e) => onThingInDeckChange(e.target.checked)}
                />
                <span>
                  {text(lang, 'Замешать «Нечто» в колоду', 'Shuffle "The Thing" into deck')}
                </span>
              </label>
              <button className="btn primary wide" disabled={!canStart || loading} onClick={() => void onStart()} type="button">
                {text(lang, 'Начать партию', 'Start match')}
              </button>
              <button className="btn ghost" disabled={loading} onClick={() => void onReset()} type="button">
                {text(lang, 'Сбросить комнату', 'Reset room')}
              </button>
            </div>
          ) : (
            <p className="helper-text" style={{ marginTop: '14px' }}>{text(lang, 'Только хост может начать партию.', 'Only the host can start the match.')}</p>
          )}

          {copied && <p className="success-text">{text(lang, 'Ссылка скопирована.', 'Link copied.')}</p>}
          {error && <p className="error-text">{error}</p>}
        </div>
      </section>
    </main>
  );
}
