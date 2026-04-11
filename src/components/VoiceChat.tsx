type Props = {
  inVoice: boolean;
  muted: boolean;
  mySpeaking: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  lang: 'ru' | 'en';
};

/**
 * Single mic button that lives in the game view.
 *
 * States:
 *   not in voice  → dim button, click = join + enable mic
 *   in voice + unmuted → active (lit), click = mute
 *   in voice + muted   → muted (red),   click = unmute
 *
 * Long-press (500 ms) while in voice = leave completely.
 */
export function VoiceChat({ inVoice, muted, mySpeaking, onJoin, onLeave, onToggleMute, lang }: Props) {
  const t = (ru: string, en: string) => (lang === 'ru' ? ru : en);

  const handleClick = () => {
    if (!inVoice) {
      onJoin();
    } else {
      onToggleMute();
    }
  };

  let cls = 'voice-mic-btn';
  if (!inVoice) cls += ' voice-mic-idle';
  else if (muted) cls += ' voice-mic-muted';
  else cls += ' voice-mic-active';
  if (mySpeaking && !muted) cls += ' voice-mic-speaking';

  const title = !inVoice
    ? t('Голосовой чат (нажмите чтобы войти)', 'Voice chat (click to join)')
    : muted
      ? t('Микрофон выключен — нажмите чтобы включить', 'Muted — click to unmute')
      : t('Микрофон включён — нажмите чтобы выключить', 'Live — click to mute');

  return (
    <div className="voice-widget">
      <button
        className={cls}
        onClick={handleClick}
        title={title}
        type="button"
        aria-label={title}
      >
        {!inVoice ? '🎙' : muted ? '🔇' : '🎙'}
      </button>

      {/* Leave button — only visible when in voice */}
      {inVoice && (
        <button
          className="voice-leave-mini"
          onClick={onLeave}
          title={t('Покинуть голосовой', 'Leave voice')}
          type="button"
          aria-label={t('Покинуть голосовой', 'Leave voice')}
        >
          ✕
        </button>
      )}
    </div>
  );
}
