/**
 * Game sound effects — plays local MP3 files from /sounds/.
 * Falls back to silent no-op if a file is missing.
 */

// ---------------------------------------------------------------------------
// Master volume
// ---------------------------------------------------------------------------

let masterVolume = 0.5;

export function setMasterVolume(vol: number): void {
  masterVolume = Math.max(0, Math.min(1, vol));
}

// ---------------------------------------------------------------------------
// Audio cache & playback helper
// ---------------------------------------------------------------------------

const audioCache: Record<string, HTMLAudioElement> = {};

function playSfx(file: string, volume: number): void {
  const path = `/sounds/${file}`;
  const effectiveVolume = volume * masterVolume;

  // Clone from cache or create new element so overlapping plays work
  let audio: HTMLAudioElement;
  if (audioCache[path]) {
    audio = audioCache[path].cloneNode(true) as HTMLAudioElement;
  } else {
    audio = new Audio(path);
    audioCache[path] = audio;
    audio = audio.cloneNode(true) as HTMLAudioElement;
  }

  audio.volume = Math.max(0, Math.min(1, effectiveVolume));
  audio.play().catch(() => {});
}

// ---------------------------------------------------------------------------
// Sound effect functions (same API as before)
// ---------------------------------------------------------------------------

/** Card drawn from deck */
export function playCardDraw(volume = 0.5): void {
  playSfx('Взятие карты из колоды.mp3', volume);
}

/** Card placed / discarded */
export function playCardDrop(volume = 0.5): void {
  playSfx('Сброс карты.mp3', volume);
}

/** Card played aggressively (uses same as discard — no dedicated file) */
export function playCardPlay(volume = 0.5): void {
  playSfx('Сброс карты.mp3', volume);
}

/** Locked door card played */
export function playLockedDoor(volume = 0.5): void {
  playSfx('Заколоченная дверь.mp3', volume);
}

/** Quarantine card played */
export function playQuarantine(volume = 0.5): void {
  playSfx('карантин.mp3', volume);
}

/** Card exchange between players */
export function playCardSwap(volume = 0.5): void {
  playSfx('Обмен картами.mp3', volume);
}

/** Panic card drawn */
export function playPanicReveal(volume = 0.5): void {
  playSfx('Вытянул панику.mp3', volume);
}

/** Defense card blocks an attack */
export function playDefenseBlock(volume = 0.5): void {
  playSfx('Использование карты защиты.mp3', volume);
}

/** It is now your turn */
export function playYourTurn(volume = 0.5): void {
  playSfx('Начало твоего хода.mp3', volume);
}

/** Deck reshuffle */
export function playDeckShuffle(volume = 0.5): void {
  playSfx('Перемешивание колоды.mp3', volume);
}

/** Player eliminated */
export function playPlayerEliminated(volume = 0.5): void {
  playSfx('Игрок выбывает.mp3', volume);
}

/** Victory — humans win (no dedicated file, reuse turn chime) */
export function playVictoryHumans(volume = 0.5): void {
  playSfx('Начало твоего хода.mp3', volume);
}

/** Victory — the Thing wins (no dedicated file, reuse elimination) */
export function playVictoryThing(volume = 0.5): void {
  playSfx('Игрок выбывает.mp3', volume);
}

/** UI button click — silent, no dedicated file */
export function playButtonClick(_volume = 0.5): void {
  // No custom file provided — skip
}
