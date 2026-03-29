import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { bgMusic } from '../../sounds/backgroundMusic.ts';

const MAX_VOLUME = 0.1;

// useSyncExternalStore guarantees icon always matches actual bgMusic state
function useBgMusic() {
  const playing = useSyncExternalStore(
    bgMusic.subscribe.bind(bgMusic),
    () => bgMusic.playing,
    () => false,
  );
  const volume = useSyncExternalStore(
    bgMusic.subscribe.bind(bgMusic),
    () => bgMusic.volume,
    () => 0,
  );
  return { playing, volume };
}

export function MusicVolumeSlider({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const { playing, volume } = useBgMusic();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const vol = parseFloat(e.target.value);
    bgMusic.setVolume(vol);
    if (!bgMusic.playing && vol > 0) bgMusic.start();
  }, [disabled]);

  const togglePlay = useCallback(() => {
    if (disabled) return;
    if (bgMusic.playing) bgMusic.stop();
    else bgMusic.start();
  }, [disabled]);

  useEffect(() => {
    if (disabled) {
      bgMusic.stop();
    }
  }, [disabled]);

  const title = disabled
    ? t('topbar.musicDisabledByPerformance')
    : playing
      ? t('topbar.musicOff')
      : t('topbar.musicOn');

  return (
    <div className={`music-volume-slider${disabled ? ' is-disabled' : ''}`}>
      <button
        className="music-toggle-btn"
        onClick={togglePlay}
        title={title}
        aria-label={title}
        disabled={disabled}
        type="button"
      >
        {playing ? '🎵' : '🔇'}
      </button>
      <input
        type="range"
        min={0}
        max={MAX_VOLUME}
        step={0.005}
        value={volume}
        onChange={handleChange}
        className="music-slider"
        title={disabled ? t('topbar.musicDisabledByPerformance') : t('topbar.musicVolume')}
        aria-label={disabled ? t('topbar.musicDisabledByPerformance') : t('topbar.musicVolume')}
        disabled={disabled}
      />
    </div>
  );
}
