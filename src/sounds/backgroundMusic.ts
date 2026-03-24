/**
 * Background music player with shuffled playlist.
 * Each game session gets a different random order.
 */

const TRACKS = [
  '01. Hellfire Peninsula.mp3',
  '08. Kel\'Thuzad.mp3',
  '12. Darkmoon Faire.mp3',
  '13. Darkmoon Races.mp3',
  '15. Turn of the Wheel.mp3',
  '16. The Barrens.mp3',
  '18. Razorfern Kraul.mp3',
  '20. Stormwind.mp3',
  '22. Stockades.mp3',
  '29. Frostwolf.mp3',
  '30. Gryphon Sky.mp3',
  '31. Retribution.mp3',
  '32. The Sunken City.mp3',
  '33. Leviathan.mp3',
  '34. Nazjatar.mp3',
  '38. Murloc.mp3',
  '40. Death Knights.mp3',
  '47. The Formation Grounds.mp3',
  '49. Showdown.mp3',
  '53. Dr. Boom\'s Basement.mp3',
  '54. Whizbang\'s Workshop.mp3',
  '55. Pirates In Paradise.mp3',
  '56. Buccaneer Beach.mp3',
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class BackgroundMusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private playlist: string[] = [];
  private currentIndex = 0;
  private _volume = 0.05;
  private _playing = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.playlist = shuffle(TRACKS);
  }

  get volume() { return this._volume; }
  get playing() { return this._playing; }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  private loadTrack(index: number) {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
    const track = this.playlist[index];
    this.audio = new Audio(`/music/${encodeURIComponent(track)}`);
    this.audio.volume = this._volume;
    this.audio.addEventListener('ended', () => this.nextTrack());
    this.audio.addEventListener('error', () => this.nextTrack());
  }

  private nextTrack() {
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    // Re-shuffle when we've played all tracks
    if (this.currentIndex === 0) {
      this.playlist = shuffle(TRACKS);
    }
    this.loadTrack(this.currentIndex);
    if (this._playing) {
      void this.audio?.play().catch(() => {});
    }
  }

  start() {
    if (this._playing) return;
    this._playing = true;

    const doPlay = () => {
      void this.audio?.play().catch(() => {
        this._playing = false;
        this.notify();
      });
    };

    if (this.audio && this.audio.src && !this.audio.ended) {
      // Resume the paused track
      doPlay();
    } else {
      // First start or track ended — shuffle and begin fresh
      this.playlist = shuffle(TRACKS);
      this.currentIndex = 0;
      this.loadTrack(0);
      doPlay();
    }
    this.notify();
  }

  stop() {
    this._playing = false;
    this.audio?.pause();
    // Don't reset currentTime — resume from same position when re-enabled
    this.notify();
  }

  setVolume(vol: number) {
    this._volume = Math.max(0, Math.min(0.1, vol));
    if (this.audio) this.audio.volume = this._volume;
    this.notify();
  }
}

// Singleton — one player for the whole app
export const bgMusic = new BackgroundMusicPlayer();
