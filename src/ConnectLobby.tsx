import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomView } from './multiplayer.ts';

export function ConnectScreen({
  copied,
  error,
  joinCode,
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
  loading: boolean;
  name: string;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onJoinCodeChange: (value: string) => void;
  onNameChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [briefingExpanded, setBriefingExpanded] = useState(false);

  return (
    <main className="connect-screen">
      <div className="connect-layout">
        <section className={`connect-briefing ${briefingExpanded ? 'is-expanded' : 'is-collapsed'}`}>
          <div className="signal-pill">{t('connect.briefingLabel')}</div>
          <h1 className="hero-title">Stay Away!</h1>
          <p className="version-tag">v1.3 multiplayer</p>
          <p className="hero-subtitle">{t('connect.tagline')}</p>

          <div className="connect-chip-row">
            <span className="connect-chip">{t('connect.playersRange')}</span>
            <span className="connect-chip danger">{t('connect.hiddenRoles')}</span>
            <span className="connect-chip">{t('connect.mobileReady')}</span>
          </div>

          <button
            aria-expanded={briefingExpanded}
            className="connect-briefing-toggle btn ghost small"
            onClick={() => setBriefingExpanded((value) => !value)}
            type="button"
          >
            {briefingExpanded ? t('connect.hideBriefing') : t('connect.showBriefing')}
          </button>

          <div className="connect-briefing-body">
            <p className="connect-summary">{t('connect.summary')}</p>

            <div className="briefing-grid">
              <article className="briefing-card">
                <span className="briefing-index">01</span>
                <strong>{t('connect.briefingRolesTitle')}</strong>
                <p>{t('connect.briefingRolesBody')}</p>
              </article>
              <article className="briefing-card">
                <span className="briefing-index">02</span>
                <strong>{t('connect.briefingTradeTitle')}</strong>
                <p>{t('connect.briefingTradeBody')}</p>
              </article>
              <article className="briefing-card">
                <span className="briefing-index">03</span>
                <strong>{t('connect.briefingBurnTitle')}</strong>
                <p>{t('connect.briefingBurnBody')}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="connect-terminal">
          <div className="connect-card">
            <div className="terminal-head">
              <span className="terminal-kicker">{t('connect.accessTerminal')}</span>
              <strong>{t('connect.accessTitle')}</strong>
              <p>{t('connect.createHint')}</p>
            </div>

            <label className="field-label">
              {t('connect.yourName')}
              <input
                className="text-input"
                maxLength={20}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={t('connect.nameExample')}
                type="text"
                value={name}
              />
            </label>

            <button className="btn primary wide" disabled={loading} onClick={onCreateRoom} type="button">
              {t('connect.createRoom')}
            </button>

            <div className="divider">
              <span>{t('connect.orJoinByCode')}</span>
            </div>

            <label className="field-label">
              {t('connect.roomCode')}
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
              {t('connect.joinRoom')}
            </button>

            <p className="helper-text terminal-footnote">{t('connect.joinHint')}</p>
            {copied && <p className="success-text">{t('connect.linkCopied')}</p>}
            {error && <p className="error-text">{error}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

export function LobbyScreen({
  copied,
  error,
  loading,
  room,
  shareUrl,
  gameMode,
  onCopy,
  onLeave,
  onReset,
  onStart,
  onAddBot,
  onRemoveBot,
  onGameModeChange,
}: {
  copied: boolean;
  error: string | null;
  loading: boolean;
  room: RoomView;
  shareUrl: string;
  gameMode: 'standard' | 'thing_in_deck' | 'anomaly';
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onReset: () => Promise<void>;
  onStart: () => Promise<void>;
  onAddBot: () => Promise<void>;
  onRemoveBot: (botSessionId: string) => Promise<void>;
  onGameModeChange: (value: 'standard' | 'thing_in_deck' | 'anomaly') => void;
}) {
  const { t } = useTranslation();
  const minPlayers = 4;
  const canStart = room.me.isHost && room.members.length >= minPlayers;
  const playersNeeded = Math.max(0, minPlayers - room.members.length);
  const isReady = playersNeeded === 0;

  return (
    <main className="lobby-screen">
      <section className="room-banner">
        <div className="room-banner-copy">
          <p className="eyebrow">{t('connect.roomCode')}</p>
          <div className="room-code-row">
            <h2 className="room-code">{room.code}</h2>
            <span className={`room-state-pill ${isReady ? 'ready' : 'waiting'}`}>
              {isReady ? t('connect.readyToStart') : t('connect.awaitingPlayers')}
            </span>
          </div>
          <p className="helper-text room-status-line">
            {t('connect.roomStatus', { count: room.members.length, needed: Math.max(0, minPlayers - room.members.length) })}
          </p>
        </div>
        <div className="room-banner-stats">
          <div className="room-stat-card">
            <span>{t('connect.playersStat')}</span>
            <strong>{room.members.length}/12</strong>
          </div>
          <div className="room-stat-card">
            <span>{t('connect.hostStat')}</span>
            <strong>{room.members.find((member) => member.isHost)?.name ?? '—'}</strong>
          </div>
          <div className="room-stat-card">
            <span>{t('connect.startStat')}</span>
            <strong>{isReady ? t('connect.startStatReady') : t('connect.startStatWaiting', { count: playersNeeded })}</strong>
          </div>
        </div>
        <div className="room-banner-actions">
          <button className="btn secondary" onClick={() => void onCopy()} type="button">
            {t('connect.copyLink')}
          </button>
          <button className="btn ghost" onClick={onLeave} type="button">
            {t('connect.leave')}
          </button>
        </div>
      </section>

      <section className="lobby-grid">
        <div className="panel lobby-panel">
          <div className="panel-header">
            <h3>{t('connect.players')}</h3>
            <span className="panel-kicker">{t('connect.playerRoster')}</span>
          </div>
          <div className="member-grid">
            {room.members.map((member, index) => (
              <div className={`member-card ${member.connected ? '' : 'offline'}`} key={member.sessionId}>
                <div className="member-card-head">
                  <span className="member-index">{index + 1}</span>
                  <span className={`member-status-dot ${member.connected ? 'online' : 'offline'}`} />
                </div>
                <div className="member-card-body">
                  <strong className="member-name">
                    {member.name}
                    {member.sessionId === room.me.sessionId && ` ${t('connect.you')}`}
                  </strong>
                  <span className="member-role-line">
                    {member.connected ? t('connect.online') : t('connect.offline')}
                  </span>
                </div>
                <div className="member-badges">
                  {member.isHost && <span className="badge host">{t('connect.host')}</span>}
                  {member.isBot && <span className="badge bot">BOT</span>}
                  {!member.connected && !member.isBot && <span className="badge dim">{t('connect.offline')}</span>}
                  {member.isBot && room.me.isHost && (
                    <button
                      className="btn ghost small bot-remove-btn"
                      onClick={() => void onRemoveBot(member.sessionId)}
                      type="button"
                      title={t('connect.removeBot', 'Убрать бота')}
                    >✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel lobby-panel">
          <div className="panel-header">
            <h3>{t('connect.settings')}</h3>
            <span className="panel-kicker">
              {room.me.isHost ? t('connect.hostControls') : t('connect.waitingForHost')}
            </span>
          </div>

          <div className="share-box">
            <span className="share-box-label">{t('connect.shareLinkLabel')}</span>
            <span className="share-url">{shareUrl}</span>
            <p className="helper-text share-box-note">{t('connect.shareHint')}</p>
          </div>

          {room.me.isHost ? (
            <div className="stack-actions" style={{ marginTop: '14px' }}>
              <div className={`readiness-banner ${isReady ? 'ready' : 'waiting'}`}>
                {isReady ? t('connect.startReady') : t('connect.startNeedPlayers', { count: playersNeeded })}
              </div>
              <label className="field-row">
                <span className="field-label">{t('connect.gameMode')}</span>
                <select
                  className="mode-select"
                  value={gameMode}
                  onChange={(e) => onGameModeChange(e.target.value as 'standard' | 'thing_in_deck' | 'anomaly')}
                >
                  <option value="standard">{t('connect.modeStandard')}</option>
                  <option value="thing_in_deck">{t('connect.modeThingInDeck')}</option>
                  <option value="anomaly">{t('connect.modeAnomaly')}</option>
                </select>
              </label>
              <p className="helper-text mode-hint">{t(`connect.modeHint_${gameMode}`)}</p>
              {room.members.length < 12 && (
                <button className="btn secondary wide" disabled={loading} onClick={() => void onAddBot()} type="button">
                  🤖 {t('connect.addBot', 'Добавить бота')}
                </button>
              )}
              <button className="btn primary wide" disabled={!canStart || loading} onClick={() => void onStart()} type="button">
                {t('connect.startMatch')}
              </button>
              <button className="btn ghost" disabled={loading} onClick={() => void onReset()} type="button">
                {t('connect.resetRoom')}
              </button>
            </div>
          ) : (
            <p className="helper-text" style={{ marginTop: '14px' }}>{t('connect.onlyHostStart')}</p>
          )}

          {copied && <p className="success-text">{t('connect.linkCopied')}</p>}
          {error && <p className="error-text">{error}</p>}
        </div>
      </section>
    </main>
  );
}
