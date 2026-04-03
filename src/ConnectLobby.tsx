import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './appHelpers.ts';
import type { AuthUser, RoomView } from './multiplayer.ts';

function AuthPanel({ onAuth, onClose, isRu }: {
  onAuth: (token: string, user: AuthUser) => void;
  onClose: () => void;
  isRu: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setAuthError(null);
    try {
      const data = await api<{ token: string; userId: number; username: string; elo: number }>(
        `/api/auth/${mode}`,
        { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) },
      );
      onAuth(data.token, { userId: data.userId, username: data.username, elo: data.elo });
      onClose();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-panel">
      <div className="auth-tabs">
        <button className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => setMode('login')} type="button">
          {isRu ? 'Войти' : 'Login'}
        </button>
        <button className={`auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => setMode('register')} type="button">
          {isRu ? 'Регистрация' : 'Register'}
        </button>
      </div>
      <input className="ui-input" placeholder={isRu ? 'Логин' : 'Username'} value={username}
        onChange={e => setUsername(e.target.value)} maxLength={24} autoComplete="username" />
      <input className="ui-input" placeholder={isRu ? 'Пароль' : 'Password'} type="password" value={password}
        onChange={e => setPassword(e.target.value)} maxLength={64} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        onKeyDown={e => { if (e.key === 'Enter') void submit(); }} />
      {authError && <p className="error-text">{authError}</p>}
      <button className="ui-button" disabled={loading} onClick={() => void submit()} type="button">
        {mode === 'login' ? (isRu ? 'Войти' : 'Login') : (isRu ? 'Зарегистрироваться' : 'Register')}
      </button>
      <button className="ui-button ui-button-secondary" onClick={onClose} type="button">
        {isRu ? 'Отмена' : 'Cancel'}
      </button>
    </div>
  );
}

export function ConnectScreen({
  copied,
  error,
  joinCode,
  loading,
  name,
  authUser,
  onAuth,
  onLogout,
  onOpenProfile,
  onCreateRoom,
  onJoinRoom,
  onWatchRoom,
  onJoinCodeChange,
  onNameChange,
}: {
  copied: boolean;
  error: string | null;
  joinCode: string;
  loading: boolean;
  name: string;
  authUser: AuthUser | null;
  onAuth: (token: string, user: AuthUser) => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onWatchRoom: () => void;
  onJoinCodeChange: (value: string) => void;
  onNameChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const isRu = i18n.language !== 'en';
  const [showAuth, setShowAuth] = useState(false);
  return (
    <main className="connect-screen abyss-screen">
      <section className="menu-wrap">
        <div className="logo-wrap" aria-label="Нечто из глубокой бездны">
          <svg className="game-logo" viewBox="0 0 920 420" role="img" aria-hidden="true">
            <defs>
              <linearGradient id="logoGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#eee8d7" />
                <stop offset="16%" stopColor="#d7cfb8" />
                <stop offset="34%" stopColor="#a59d81" />
                <stop offset="54%" stopColor="#716c57" />
                <stop offset="72%" stopColor="#c9c0a8" />
                <stop offset="100%" stopColor="#575241" />
              </linearGradient>

              <linearGradient id="ornamentGold" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(0,0,0,0)" />
                <stop offset="28%" stopColor="#675f46" />
                <stop offset="50%" stopColor="#a79a6b" />
                <stop offset="72%" stopColor="#675f46" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </linearGradient>

              <filter id="logoShadow" x="-20%" y="-20%" width="140%" height="160%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.5" />
                <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#000000" floodOpacity="0.35" />
              </filter>

              <filter id="logoTexture" x="-10%" y="-10%" width="120%" height="120%">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="8" result="noise" />
                <feColorMatrix in="noise" type="saturate" values="0" result="monoNoise" />
                <feComponentTransfer in="monoNoise" result="fadedNoise">
                  <feFuncA type="table" tableValues="0 0.035" />
                </feComponentTransfer>
              </filter>

              <mask id="textMask">
                <rect width="100%" height="100%" fill="black" />
                <text x="460" y="132" textAnchor="middle" className="svg-title svg-title-main">Нечто</text>
                <text x="460" y="232" textAnchor="middle" className="svg-title svg-title-sub">из глубокой</text>
                <text x="460" y="332" textAnchor="middle" className="svg-title svg-title-sub">бездны</text>
              </mask>
            </defs>

            <g opacity="0.72">
              <line x1="275" y1="34" x2="645" y2="34" stroke="url(#ornamentGold)" strokeWidth="1.5" />
              <path d="M445 34h-18m48 0h-18" stroke="#857a57" strokeWidth="1.4" fill="none" />
              <path d="M454 24l6 6-6 6-6-6 6-6Z" fill="none" stroke="#8f8460" strokeWidth="1.2" />
              <path d="M438 34c8-2 12-8 16-10m12 10c-8-2-12-8-16-10" fill="none" stroke="#7d7354" strokeWidth="1" />
            </g>

            <g filter="url(#logoShadow)">
              <text x="460" y="132" textAnchor="middle" className="svg-title svg-title-main outline">Нечто</text>
              <text x="460" y="232" textAnchor="middle" className="svg-title svg-title-sub outline">из глубокой</text>
              <text x="460" y="332" textAnchor="middle" className="svg-title svg-title-sub outline">бездны</text>

              <text x="460" y="132" textAnchor="middle" className="svg-title svg-title-main fill">Нечто</text>
              <text x="460" y="232" textAnchor="middle" className="svg-title svg-title-sub fill">из глубокой</text>
              <text x="460" y="332" textAnchor="middle" className="svg-title svg-title-sub fill">бездны</text>

              <rect width="100%" height="100%" fill="url(#logoGold)" mask="url(#textMask)" opacity="0.2" filter="url(#logoTexture)" />
            </g>

            <g opacity="0.72">
              <line x1="275" y1="368" x2="645" y2="368" stroke="url(#ornamentGold)" strokeWidth="1.5" />
              <path d="M445 368h-18m48 0h-18" stroke="#857a57" strokeWidth="1.4" fill="none" />
              <path d="M454 358l6 6-6 6-6-6 6-6Z" fill="none" stroke="#8f8460" strokeWidth="1.2" />
              <path d="M438 368c8-2 12-8 16-10m12 10c-8-2-12-8-16-10" fill="none" stroke="#7d7354" strokeWidth="1" />
            </g>
          </svg>
        </div>

        <form className="lobby-form" onSubmit={(event) => event.preventDefault()}>
          <label className="ui-label" htmlFor="nickname">{t('connect.yourName')}</label>
          <input
            className="ui-input"
            id="nickname"
            name="nickname"
            type="text"
            placeholder={t('connect.nameExample')}
            autoComplete="nickname"
            maxLength={20}
            onChange={(event) => onNameChange(event.target.value)}
            value={name}
          />

          <label className="ui-label" htmlFor="lobbyCode">{t('connect.roomCode')}</label>
          <input
            className="ui-input"
            id="lobbyCode"
            name="lobbyCode"
            type="text"
            placeholder={t('connect.joinHint').includes('код') ? 'Введите код лобби...' : 'Enter lobby code...'}
            autoComplete="off"
            maxLength={5}
            onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())}
            value={joinCode}
          />

          <button className="ui-button" disabled={loading} onClick={onJoinRoom} type="button">{t('connect.joinRoom')}</button>
          <button className="ui-button ui-button-secondary" disabled={loading} onClick={onCreateRoom} type="button">{t('connect.createRoom')}</button>
          {copied && <p className="success-text menu-feedback">{t('connect.linkCopied')}</p>}
          {error && <p className="error-text menu-feedback">{error}</p>}
          {error?.includes('already started') && (
            <button className="ui-button ui-button-secondary" disabled={loading} onClick={onWatchRoom} type="button">
              👁 {isRu ? 'Наблюдать за игрой' : 'Watch the game'}
            </button>
          )}
        </form>

        {/* Auth block */}
        <div className="auth-block">
          {showAuth ? (
            <AuthPanel onAuth={onAuth} onClose={() => setShowAuth(false)} isRu={isRu} />
          ) : authUser ? (
            <div className="auth-user-row">
              <button className="auth-username-btn" onClick={onOpenProfile} type="button">
                👤 {authUser.username} <span className="auth-elo">ELO {authUser.elo}</span>
              </button>
              <button className="auth-logout-btn" onClick={onLogout} type="button">
                {isRu ? 'Выйти' : 'Logout'}
              </button>
            </div>
          ) : (
            <button className="auth-login-btn" onClick={() => setShowAuth(true)} type="button">
              {isRu ? '👤 Войти / Создать аккаунт' : '👤 Login / Register'}
            </button>
          )}
        </div>

        <p className="flavor-text">
          «Временами просыпается Оно.
          <br />
          И тогда Нечто смотрит на нас из глубины...»
        </p>
      </section>
    </main>
  );
}

export function LobbyScreen({
  copied,
  error,
  loading,
  room,
  gameMode,
  onCopy,
  onLeave,
  onStart,
  onAddBot,
  onRemoveMember,
  onGameModeChange,
  onOpenProfile,
}: {
  copied: boolean;
  error: string | null;
  loading: boolean;
  room: RoomView;
  gameMode: 'standard' | 'thing_in_deck' | 'anomaly';
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onStart: () => Promise<void>;
  onAddBot: () => Promise<void>;
  onRemoveMember: (memberSessionId: string) => Promise<void>;
  onGameModeChange: (value: 'standard' | 'thing_in_deck' | 'anomaly') => void;
  onOpenProfile: (username: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const isRu = i18n.language !== 'en';
  const minPlayers = 4;
  const canStart = room.me.isHost && room.members.length >= minPlayers;
  const playersNeeded = Math.max(0, minPlayers - room.members.length);
  const isReady = playersNeeded === 0;
  const totalSlots = Math.max(room.members.length, minPlayers);

  return (
    <main className="lobby-screen abyss-screen">
      <h2 className="lp-code lp-code-floating">{room.code}</h2>
      <div className="lp-frame">
        <div className="lp-inner">
          <section className="lp-body">
            <div className="lp-section-head">
              <p className="lp-section-label">{t('connect.players')}</p>
              <span className={`lp-pill ${isReady ? 'ready' : 'waiting'}`}>
                {isReady ? t('connect.readyToStart') : t('connect.awaitingPlayers')}
              </span>
              <p className="lp-subtitle">
                {t('connect.roomStatus', { count: room.members.length, needed: playersNeeded })}
              </p>
            </div>
            <div className="lp-roster-shell">
              <div className="lp-roster">
                {Array.from({ length: totalSlots }, (_, i) => {
                  const member = room.members[i];
                  return (
                    <div className={`lp-row${member ? (member.connected ? '' : ' offline') : ' empty'}`} key={member?.sessionId ?? `empty-${i}`}>
                      <span className="lp-row-n">{i + 1}</span>
                      <span className={`lp-row-dot${member?.connected ? ' on' : ''}`} />
                      <div className="lp-row-body">
                        {member ? (
                          <>
                            <strong className="lp-row-name">
                              {member.name}
                              {member.sessionId === room.me.sessionId && ` ${t('connect.you')}`}
                            </strong>
                            <div className="lp-row-tags">
                              {member.isHost && <span className="lp-tag">{t('connect.host')}</span>}
                              {member.isBot && <span className="lp-tag bot">BOT</span>}
                              {member.stats && (
                                <button
                                  className="lp-tag lp-tag-stats"
                                  title={isRu ? 'Профиль' : 'Profile'}
                                  onClick={() => onOpenProfile(member.name)}
                                  type="button"
                                >
                                  ELO {member.stats.elo} · {Math.round(member.stats.winRate * 100)}% · {member.stats.gamesPlayed}g
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="lp-row-empty-mark">··</span>
                        )}
                      </div>
                      <span className="lp-row-sep">— —</span>
                      {member && room.me.isHost && !member.isHost ? (
                        <button
                          className="lp-rm-bot"
                          onClick={() => void onRemoveMember(member.sessionId)}
                          type="button"
                          title={member.isBot
                            ? t('connect.removeBot')
                            : t('connect.kickPlayer')}
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lp-bottom">
              {room.me.isHost ? (
                <>
                  <div className="lp-controls-row">
                    <label className="lp-mode-wrap">
                      <span className="lp-mode-lbl">{t('connect.gameMode')}</span>
                      <select
                        className="lp-mode-sel"
                        value={gameMode}
                        onChange={(event) => onGameModeChange(event.target.value as 'standard' | 'thing_in_deck' | 'anomaly')}
                      >
                        <option value="standard">{t('connect.modeStandard')}</option>
                        <option value="thing_in_deck">{t('connect.modeThingInDeck')}</option>
                        <option value="anomaly">{t('connect.modeAnomaly')}</option>
                      </select>
                    </label>
                    {room.members.length < 12 && (
                      <button className="lp-btn-bot" disabled={loading} onClick={() => void onAddBot()} type="button">
                        {t('connect.addBot', 'Добавить бота')}
                      </button>
                    )}
                  </div>

                  <button className="lp-btn-start" disabled={!canStart || loading} onClick={() => void onStart()} type="button">
                    {t('connect.startMatch')}
                  </button>
                </>
              ) : (
                <p className="lp-waiting-msg">{t('connect.onlyHostStart')}</p>
              )}

              <div className="lp-footer">
                <button className="lp-btn-ghost" onClick={() => void onCopy()} type="button">
                  {t('connect.copyLink')}
                </button>
                <button className="lp-btn-ghost lp-btn-leave" onClick={onLeave} type="button">
                  {t('connect.leave')}
                </button>
              </div>

              {copied && <p className="lp-feedback success">{t('connect.linkCopied')}</p>}
              {error && <p className="lp-feedback error">{error}</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
