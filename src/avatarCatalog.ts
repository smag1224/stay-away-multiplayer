export const PLAYER_AVATAR_IDS = [
  '01_explorer',
  '02_scientist',
  '03_medic',
  '04_pilot',
  '05_mechanic',
  '06_soldier',
  '07_journalist',
  '08_archaeologist',
  '09_engineer',
  '10_logistics',
  '11_shaman',
  '12_zhak',
] as const;

export type PlayerAvatarId = (typeof PLAYER_AVATAR_IDS)[number];
