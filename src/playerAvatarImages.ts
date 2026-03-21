import explorer from './assets/player-icons/01_explorer.webp';
import scientist from './assets/player-icons/02_scientist.webp';
import medic from './assets/player-icons/03_medic.webp';
import pilot from './assets/player-icons/04_pilot.webp';
import mechanic from './assets/player-icons/05_mechanic.webp';
import soldier from './assets/player-icons/06_soldier.webp';
import journalist from './assets/player-icons/07_journalist.webp';
import archaeologist from './assets/player-icons/08_archaeologist.webp';
import engineer from './assets/player-icons/09_engineer.webp';
import logistics from './assets/player-icons/10_logistics.webp';
import shaman from './assets/player-icons/11_shaman.webp';
import zhak from './assets/player-icons/12_zhak.webp';

import type { PlayerAvatarId } from './avatarCatalog.ts';

const AVATAR_IMAGES: Record<PlayerAvatarId, string> = {
  '01_explorer': explorer,
  '02_scientist': scientist,
  '03_medic': medic,
  '04_pilot': pilot,
  '05_mechanic': mechanic,
  '06_soldier': soldier,
  '07_journalist': journalist,
  '08_archaeologist': archaeologist,
  '09_engineer': engineer,
  '10_logistics': logistics,
  '11_shaman': shaman,
  '12_zhak': zhak,
};

export function getPlayerAvatarSrc(avatarId: string): string | null {
  return AVATAR_IMAGES[avatarId as PlayerAvatarId] ?? null;
}

export function getPlayerAvatarPresentation(avatarId: string): { scale: number; position: string } {
  void avatarId;
  return { scale: 1.18, position: 'center' };
}
