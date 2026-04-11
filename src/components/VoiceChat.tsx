import type { VoiceParticipant } from '../hooks/useVoiceChat.ts';

type Props = {
  inVoice: boolean;
  muted: boolean;
  mySpeaking: boolean;
  myName: string;
  participants: VoiceParticipant[];
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  lang: 'ru' | 'en';
};

export function VoiceChat({
  inVoice,
  muted,
  mySpeaking,
  myName,
  participants,
  onJoin,
  onLeave,
  onToggleMute,
  lang,
}: Props) {
  const t = (ru: string, en: string) => (lang === 'ru' ? ru : en);

  if (!inVoice) {
    return (
      <button
        className="voice-join-btn"
        onClick={onJoin}
        title={t('Войти в голосовой чат', 'Join voice chat')}
        type="button"
      >
        🎙 {t('Войти', 'Join')}
      </button>
    );
  }

  return (
    <div className="voice-panel">
      <div className="voice-panel-participants">
        {/* Me */}
        <div className={`voice-participant${mySpeaking && !muted ? ' speaking' : ''}`}>
          <span className="voice-avatar">{muted ? '🔇' : '🎙'}</span>
          <span className="voice-name">{myName}</span>
          {mySpeaking && !muted && <span className="voice-speaking-dot" />}
        </div>

        {/* Others */}
        {participants.map(p => (
          <div key={p.sessionId} className={`voice-participant${p.speaking ? ' speaking' : ''}`}>
            <span className="voice-avatar">🎙</span>
            <span className="voice-name">{p.name}</span>
            {p.speaking && <span className="voice-speaking-dot" />}
          </div>
        ))}
      </div>

      <div className="voice-panel-controls">
        <button
          className={`voice-btn${muted ? ' muted' : ''}`}
          onClick={onToggleMute}
          title={muted ? t('Включить микрофон', 'Unmute') : t('Выключить микрофон', 'Mute')}
          type="button"
        >
          {muted ? '🔇' : '🎙'}
        </button>
        <button
          className="voice-btn voice-leave-btn"
          onClick={onLeave}
          title={t('Покинуть голосовой', 'Leave voice')}
          type="button"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
