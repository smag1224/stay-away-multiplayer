/**
 * Plays local voice-line mp3 files for shout phrases.
 */

const SHOUT_AUDIO_FILES: Record<string, string> = {
  'Чистейший!': 'Чистейший!.mp3',
  'На руках!': 'На руках!.mp3',
  'В колоде': 'В колоде.mp3',
  'Заюзаешь': 'Заюзаешь.mp3',
  'Грязнющий!': 'Грязнющий!.mp3',
  'Я свой': 'Я свой.mp3',
  'Посидит': 'Посидит.mp3',
  'Передашь': 'Передашь.mp3',
  'Даю годнотишку': 'Даю годнотишку.mp3',
};

let activeShoutAudio: HTMLAudioElement | null = null;

export function getShoutAudioPath(phrase: string): string | null {
  const fileName = SHOUT_AUDIO_FILES[phrase];
  return fileName ? `/shouts/${fileName}` : null;
}

export function speakShout(
  phrase: string,
  _phraseEn: string,
  _isRu: boolean,
  _playerId: number,
  volume = 0.8,
): void {
  const audioPath = getShoutAudioPath(phrase);
  if (!audioPath) return;

  if (activeShoutAudio) {
    activeShoutAudio.pause();
    activeShoutAudio.currentTime = 0;
  }

  const audio = new Audio(audioPath);
  audio.preload = 'auto';
  audio.volume = volume;
  activeShoutAudio = audio;
  audio.addEventListener('ended', () => {
    if (activeShoutAudio === audio) {
      activeShoutAudio = null;
    }
  });
  void audio.play().catch(() => {
    if (activeShoutAudio === audio) {
      activeShoutAudio = null;
    }
  });
}
