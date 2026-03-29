import gameTable from './assets/game_table.webp';
import gameTableMobile from './assets/game_table_mobile.webp';
import gameTableMobileBottom from './assets/game_table_mobile_bottom.webp';
import infectedOverlay from './assets/infected_overlay.webp';
import quarantineOverlay from './assets/quarantine_overlay.webp';
import thingOverlay from './assets/thing_overlay.webp';
import { getPlayerAvatarSrc } from './playerAvatarImages.ts';
import type { ViewerPlayerState } from './multiplayer.ts';

const preloadedImages = new Set<string>();

function canPreloadImages(): boolean {
  return typeof Image !== 'undefined';
}

function preloadImage(src: string | null | undefined): void {
  if (!src || preloadedImages.has(src) || !canPreloadImages()) return;

  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = src;
  preloadedImages.add(src);
}

export function preloadCoreGameImages(): void {
  [
    gameTable,
    gameTableMobile,
    gameTableMobileBottom,
    infectedOverlay,
    quarantineOverlay,
    thingOverlay,
  ].forEach(preloadImage);
}

export function preloadPlayerAvatars(players: ViewerPlayerState[]): void {
  const seenAvatarIds = new Set<string>();

  for (const player of players) {
    if (!player.avatarId || seenAvatarIds.has(player.avatarId)) continue;
    seenAvatarIds.add(player.avatarId);
    preloadImage(getPlayerAvatarSrc(player.avatarId));
  }
}
