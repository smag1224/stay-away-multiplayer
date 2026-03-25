/**
 * Bot AI configuration — all tunable weights, thresholds, and role biases.
 */

// ── Timing ──────────────────────────────────────────────────────────────────

export const BOT_DELAY_MIN = 1800;
export const BOT_DELAY_MAX = 3500;
export const BOT_DELAY_IMPORTANT = 1200;

// ── Suspicion Model ─────────────────────────────────────────────────────────

export const SUSPICION_INITIAL = 0;

export const SUSPICION_DELTAS = {
  refusedTrade: 0.08,
  usedFlamethrower: -0.05,
  revealedInfected: 0.6,
  revealedClean: -0.4,
  analyzedSomeone: -0.03,
  quarantinedSomeone: -0.02,
  freedFromQuarantine: 0.15,
  placedDoorDefensively: -0.05,
  swappedTowardSuspect: 0.05,
  survivedFlamethrower: 0.04,
  publicRevealClean: -0.5,
  publicRevealInfected: 0.7,
  declinedReveal: 0.12,
  acceptedRevealClean: -0.15,
  exchangePartner: 0.02,
  decayPerTurn: -0.01,
  /** New: blocking analysis is highly suspicious */
  blockedAnalysis: 0.2,
  /** New: infection chain — partner of confirmed infected */
  infectionChainPartner: 0.25,
  /** New: multiple confirmed-infected exchange partners */
  multipleInfectedPartners: 0.35,
  /** New: consistent protection pattern */
  consistentProtection: 0.06,
  /** New: excessive trade refusals without exchanges */
  excessiveRefusals: 0.1,
  /** New: uses board control (quarantine/doors) without ever attacking */
  controlWithoutAggression: 0.08,
} as const;

export const SUSPICION_MIN = -1;
export const SUSPICION_MAX = 1;
export const SUSPICION_THRESHOLD_HIGH = 0.35;
export const SUSPICION_THRESHOLD_TRUSTED = -0.2;

// ── Game Stage Thresholds ───────────────────────────────────────────────────

/** Progress [0-1] boundaries for early/mid/late game */
export const STAGE = {
  earlyEnd: 0.25,   // First ~25% of the game
  midEnd: 0.6,      // Mid-game up to 60%
  // Late game: > 60%
} as const;

// ── Thing: Infection Timing ─────────────────────────────────────────────────

/** Minimum global turns before Thing should try to infect (stay hidden early) */
export const THING_SAFE_TURNS = 3;
/** After this many turns, Thing becomes more aggressive */
export const THING_AGGRESSIVE_TURNS = 8;
/** How many humans left before Thing should consider declaring victory */
export const THING_DECLARE_THRESHOLD = 1;

// ── Action Weights (Human Bot) ──────────────────────────────────────────────

export const HUMAN_WEIGHTS = {
  playAnalysis: 9,
  playSuspicion: 6,
  playFlamethrower: 10,
  playFlamethrowerLowEvidence: 3,
  playQuarantine: 5,
  playLockedDoor: 4,
  playAxe: 3,
  playSwapPlaces: 3,
  playYouBetterRun: 3,
  playWatchYourBack: 2,
  playWhisky: 1.5,
  playPersistence: 5,
  playTemptation: 4,
  playLovecraft: 8,
  playNecronomicon: 10,

  discardInfection: 0.5,
  discardAction: 2,
  discardDefense: 0.3,
  discardObstacle: 1.5,

  defendNoBarbecue: 10,
  defendAntiAnalysis: 2,
  defendImFineHere: 4,
  defendFear: 3,
  defendNoThanks: 2.5,
  defendMiss: 2,

  tradeKeepDefense: 3,
  tradeKeepStrong: 2,
  tradeGiveWeak: 1,

  targetSuspiciousMult: 2.0,
  targetTrustedMult: 0.3,
  targetAdjacentBonus: 1.5,
} as const;

// ── Action Weights (Thing Bot) ──────────────────────────────────────────────

export const THING_WEIGHTS = {
  playAnalysis: 3,
  playSuspicion: 4,
  playFlamethrower: 7,
  playFlamethrowerLowEvidence: 5,
  playQuarantine: 6,
  playLockedDoor: 5,
  playAxe: 4,
  playSwapPlaces: 5,
  playYouBetterRun: 5,
  playWatchYourBack: 4,
  playWhisky: 0.5,
  playPersistence: 5,
  playTemptation: 7,
  playLovecraft: 4,
  playNecronomicon: 8,

  discardInfection: 0.1,
  discardAction: 2,
  discardDefense: 1,
  discardObstacle: 1.5,

  defendNoBarbecue: 10,
  defendAntiAnalysis: 9,
  defendImFineHere: 5,
  defendFear: 5,
  defendNoThanks: 4,
  defendMiss: 3,

  tradeInfect: 10,
  tradeKeepDefense: 4,
  tradeKeepStrong: 2,
  tradeGiveWeak: 1,

  targetHumanMult: 2.5,
  targetInfectedMult: 0.2,
  targetAdjacentBonus: 1.5,

  /** Bluff weights */
  bluffAnalyzeInfected: 3,     // Play analysis on own infected ally to look human
  bluffFlamethrowerInfected: 4, // Burn own burned-out infected to look innocent
  bluffQuarantineAlly: 2,      // Quarantine own ally to deflect suspicion
} as const;

// ── Action Weights (Infected Bot) ───────────────────────────────────────────

export const INFECTED_WEIGHTS = {
  playAnalysis: 4,
  playSuspicion: 5,
  playFlamethrower: 6,
  playFlamethrowerLowEvidence: 2,
  playQuarantine: 5,
  playLockedDoor: 4,
  playAxe: 4,
  playSwapPlaces: 4,
  playYouBetterRun: 4,
  playWatchYourBack: 3,
  playWhisky: 0.5,
  playPersistence: 5,
  playTemptation: 5,
  playLovecraft: 5,
  playNecronomicon: 7,

  discardInfection: 0.1,
  discardAction: 2,
  discardDefense: 1,
  discardObstacle: 1.5,

  defendNoBarbecue: 10,
  defendAntiAnalysis: 8,
  defendImFineHere: 4,
  defendFear: 4,
  defendNoThanks: 3,
  defendMiss: 3,

  tradeKeepDefense: 3,
  tradeKeepStrong: 2,
  tradeGiveWeak: 1,

  targetHumanMult: 1.8,
  targetThingMult: 0.1,
  targetAdjacentBonus: 1.5,

  /** Redirect suspicion onto humans */
  redirectSuspicionBonus: 2,
} as const;

// ── Randomness ──────────────────────────────────────────────────────────────

export const NOISE_AMPLITUDE = 0.8;
export const BEST_ACTION_PROB = 0.75;

// ── Card Values ─────────────────────────────────────────────────────────────

export const CARD_VALUES: Record<string, number> = {
  the_thing: 100,
  infected: 0.5,
  flamethrower: 9,
  analysis: 8,
  suspicion: 5,
  persistence: 6,
  temptation: 5,
  watch_your_back: 3,
  whisky: 2,
  swap_places: 4,
  you_better_run: 4,
  quarantine: 5,
  locked_door: 4,
  axe: 3,
  no_barbecue: 7,
  anti_analysis: 4,
  im_fine_here: 3,
  fear: 4,
  no_thanks: 3,
  miss: 3,
  lovecraft: 7,
  necronomicon: 9,
};

// ── Dynamic card values per game stage ──────────────────────────────────────

/** Card value multipliers by stage: [early, mid, late] */
export const STAGE_VALUE_MULTS: Record<string, [number, number, number]> = {
  flamethrower: [0.6, 1.0, 1.5],    // More valuable late
  analysis: [1.3, 1.0, 0.7],         // More valuable early
  suspicion: [1.2, 1.0, 0.6],        // More valuable early
  no_barbecue: [0.8, 1.0, 1.3],      // More valuable late (threats increase)
  persistence: [1.1, 1.0, 0.8],
  quarantine: [0.7, 1.2, 1.0],       // Most valuable mid-game
  temptation: [0.8, 1.2, 1.0],
  whisky: [0.5, 1.0, 1.5],           // More valuable late (proves innocence)
};

// ── Player count adjustments ────────────────────────────────────────────────

/** Multiplier for information card value based on player count */
export function infoCardMultiplier(playerCount: number): number {
  if (playerCount <= 5) return 1.3;  // Small game: info is critical
  if (playerCount <= 8) return 1.0;
  return 0.8;                         // Large game: harder to use info effectively
}

/** Multiplier for aggressive cards based on player count */
export function aggressionMultiplier(playerCount: number): number {
  if (playerCount <= 5) return 0.7;  // Small game: be cautious, fewer suspects
  if (playerCount <= 8) return 1.0;
  return 1.2;                         // Large game: more targets, less risk per attack
}
