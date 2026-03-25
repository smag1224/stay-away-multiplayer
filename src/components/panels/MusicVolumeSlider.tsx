import React, { useSyncExternalStore, useCallback } from 'react';
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

export function MusicVolumeSlider() {
  const { playing, volume } = useBgMusic();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    bgMusic.setVolume(vol);
    if (!bgMusic.playing && vol > 0) bgMusic.start();
  }, []);

  const togglePlay = useCallback(() => {
    if (bgMusic.playing) bgMusic.stop();
    else bgMusic.start();
  }, []);

  return (
    <div className="music-volume-slider">
      <button
        className="music-toggle-btn"
        onClick={togglePlay}
        title={playing ? 'Выключить музыку' : 'Включить музыку'}
        aria-label={playing ? 'Выключить музыку' : 'Включить музыку'}
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
        title="Громкость музыки"
        aria-label="Громкость музыки"
      />
    </div>
  );
}
