/**
 * Bot Memory — tracks suspicion scores, exchange history, observations,
 * infection chain inference, interaction graph, and behavioral patterns.
 * Only stores information that a human player could legitimately know.
 */

import type { GameState, LogEntry } from '../../src/types.ts';
import {
  SUSPICION_INITIAL,
  SUSPICION_DELTAS,
  SUSPICION_MIN,
  SUSPICION_MAX,
} from './config.ts';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlayerObservation {
  seenCards: { uid?: string; defId: string; turn: number }[];
  confirmedClean: boolean;
  confirmedInfected: boolean;
  knownRole: 'human' | 'thing' | 'infected' | null;
  lastFullHandInfectionFreeTurn: number | null;
  lastHandChangeTurn: number | null;
  seenInfectionCardTurns: number[];
  exchangeCount: number;
  exchangePartners: number[];
  refusedTradeCount: number;
  publicReveals: { turn: number; hadInfection: boolean }[];
  flamethrowerTargets: number[];
  quarantineTargets: number[];
  freedTargets: number[];
  /** Players this player consistently protected (defended, freed, avoided attacking) */
  protectedPlayers: number[];
  /** Players this player attacked or targeted aggressively */
  attackedPlayers: number[];
  /** How many times this player moved position (swap/you_better_run) */
  positionChanges: number;
  /** Turn numbers when they declined to show hand */
  declinedRevealTurns: number[];
}

/** Directed edge in the interaction graph */
export interface InteractionEdge {
  from: number;
  to: number;
  type: 'exchange' | 'attack' | 'defend' | 'quarantine' | 'freed' | 'moved_toward' | 'moved_away';
  turn: number;
}

/** Intent for next turn — bot remembers what it planned to do */
export interface BotIntent {
  /** Card defId the bot wants to play next turn (e.g. 'axe' after drawing it) */
  playCardDefId?: string;
  /** Target player for the intended card */
  targetPlayerId?: number;
  /** Turn when the intent was created */
  createdOnTurn: number;
  /** Short reason for logging/debugging */
  reason: string;
}

export interface BotMemory {
  botPlayerId: number;
  suspicion: Map<number, number>;
  observations: Map<number, PlayerObservation>;
  /** Interaction graph — all visible player-to-player interactions */
  interactions: InteractionEdge[];
  /** Infection chain tracking: if A exchanged with B, and B later confirmed infected, A is suspect */
  infectionChains: Map<number, { partner: number; turn: number }[]>;
  processedLogCount: number;
  currentTurn: number;
  /** Global turn counter (increments every time any player starts a turn) */
  globalTurnCount: number;
  /** Total players at game start */
  totalPlayers: number;
  /** Intent for the next turn — what the bot plans to do */
  intent: BotIntent | null;
}

// ── Factory ─────────────────────────────────────────────────────────────────

function emptyObs(): PlayerObservation {
  return {
    seenCards: [],
    confirmedClean: false,
    confirmedInfected: false,
    knownRole: null,
    lastFullHandInfectionFreeTurn: null,
    lastHandChangeTurn: null,
    seenInfectionCardTurns: [],
    exchangeCount: 0,
    exchangePartners: [],
    refusedTradeCount: 0,
    publicReveals: [],
    flamethrowerTargets: [],
    quarantineTargets: [],
    freedTargets: [],
    protectedPlayers: [],
    attackedPlayers: [],
    positionChanges: 0,
    declinedRevealTurns: [],
  };
}

export function createBotMemory(botPlayerId: number, playerIds: number[]): BotMemory {
  const suspicion = new Map<number, number>();
  const observations = new Map<number, PlayerObservation>();

  for (const pid of playerIds) {
    if (pid !== botPlayerId) {
      suspicion.set(pid, SUSPICION_INITIAL);
    }
    observations.set(pid, emptyObs());
  }

  return {
    botPlayerId,
    suspicion,
    observations,
    interactions: [],
    infectionChains: new Map(playerIds.map(pid => [pid, []])),
    processedLogCount: 0,
    currentTurn: 0,
    globalTurnCount: 0,
    totalPlayers: playerIds.length,
    intent: null,
  };
}

// ── Suspicion Helpers ───────────────────────────────────────────────────────

function clampSuspicion(val: number): number {
  return Math.max(SUSPICION_MIN, Math.min(SUSPICION_MAX, val));
}

export function adjustSuspicion(memory: BotMemory, playerId: number, delta: number): void {
  if (playerId === memory.botPlayerId) return;
  const prev = memory.suspicion.get(playerId) ?? SUSPICION_INITIAL;
  memory.suspicion.set(playerId, clampSuspicion(prev + delta));
}

export function getSuspicion(memory: BotMemory, playerId: number): number {
  return memory.suspicion.get(playerId) ?? SUSPICION_INITIAL;
}

function getObs(memory: BotMemory, playerId: number): PlayerObservation {
  let obs = memory.observations.get(playerId);
  if (!obs) {
    obs = emptyObs();
    memory.observations.set(playerId, obs);
  }
  return obs;
}

function refreshCertainty(obs: PlayerObservation): void {
  obs.confirmedInfected = obs.knownRole === 'thing' || obs.knownRole === 'infected';

  const cleanKnowledgeIsFresh =
    obs.lastFullHandInfectionFreeTurn !== null &&
    (obs.lastHandChangeTurn === null || obs.lastFullHandInfectionFreeTurn > obs.lastHandChangeTurn);

  obs.confirmedClean = !obs.confirmedInfected && cleanKnowledgeIsFresh;
}

function markHandChanged(memory: BotMemory, playerId: number, turn: number): void {
  const obs = getObs(memory, playerId);
  obs.lastHandChangeTurn = turn;
  refreshCertainty(obs);
}

export function setKnownRole(
  memory: BotMemory,
  playerId: number,
  role: 'human' | 'thing' | 'infected',
): void {
  if (playerId === memory.botPlayerId) return;
  const obs = getObs(memory, playerId);
  obs.knownRole = role;
  refreshCertainty(obs);
}

function addInteraction(memory: BotMemory, edge: InteractionEdge): void {
  memory.interactions.push(edge);
  // Keep bounded (last 200 interactions)
  if (memory.interactions.length > 200) {
    memory.interactions = memory.interactions.slice(-150);
  }
}

// ── Infection Chain Inference ────────────────────────────────────────────────

/**
 * When player B is confirmed infected, trace back through exchange history
 * to find who could have infected them. Boost suspicion on those partners.
 */
function propagateInfectionChain(memory: BotMemory, infectedPlayerId: number): void {
  const chains = memory.infectionChains.get(infectedPlayerId) ?? [];
  for (const { partner, turn } of chains) {
    if (partner === memory.botPlayerId) continue;
    // The partner who exchanged with the now-confirmed-infected player is suspicious
    // More recent exchanges = more suspicious
    const recency = Math.max(0.3, 1 - (memory.globalTurnCount - turn) * 0.05);
    adjustSuspicion(memory, partner, SUSPICION_DELTAS.infectionChainPartner * recency);

    // Also check if that partner exchanged with other confirmed-infected
    const partnerChains = memory.infectionChains.get(partner) ?? [];
    const otherInfectedPartners = partnerChains.filter(c => {
      const obs = memory.observations.get(c.partner);
      return obs?.confirmedInfected;
    });
    if (otherInfectedPartners.length >= 2) {
      // Multiple infected exchange partners → very suspicious
      adjustSuspicion(memory, partner, SUSPICION_DELTAS.multipleInfectedPartners);
    }
  }
}

// ── Behavioral Pattern Detection ────────────────────────────────────────────

/**
 * Detect protection patterns: player A consistently defends/frees player B
 * → they might be Thing + Infected allies.
 */
function detectProtectionPatterns(memory: BotMemory): void {
  const protectionCount = new Map<string, number>();

  for (const edge of memory.interactions) {
    if (edge.type === 'defend' || edge.type === 'freed') {
      const key = `${edge.from}->${edge.to}`;
      protectionCount.set(key, (protectionCount.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of protectionCount) {
    if (count >= 2) {
      const [fromStr, toStr] = key.split('->');
      const from = parseInt(fromStr, 10);
      const to = parseInt(toStr, 10);
      // Consistent protection → both slightly more suspicious (might be allies)
      adjustSuspicion(memory, from, SUSPICION_DELTAS.consistentProtection * count);
      adjustSuspicion(memory, to, SUSPICION_DELTAS.consistentProtection * count * 0.5);

      const obsFrom = getObs(memory, from);
      if (!obsFrom.protectedPlayers.includes(to)) obsFrom.protectedPlayers.push(to);
    }
  }
}

/**
 * Detect avoidance patterns: player who always refuses trades or avoids
 * specific neighbors with doors/quarantine.
 */
function detectAvoidancePatterns(memory: BotMemory): void {
  for (const [pid, obs] of memory.observations) {
    if (pid === memory.botPlayerId) continue;

    // Excessive trade refusals → suspicious
    if (obs.refusedTradeCount >= 3 && obs.exchangeCount < 2) {
      adjustSuspicion(memory, pid, SUSPICION_DELTAS.excessiveRefusals);
    }

    // Never attacked anyone but frequently quarantines → possibly Thing controlling board
    if (obs.quarantineTargets.length >= 2 && obs.flamethrowerTargets.length === 0) {
      adjustSuspicion(memory, pid, SUSPICION_DELTAS.controlWithoutAggression);
    }
  }
}

// ── Process Log Updates ─────────────────────────────────────────────────────

export function updateMemoryFromLog(memory: BotMemory, game: GameState): void {
  const newEntries = game.log.slice(memory.processedLogCount);
  memory.processedLogCount = game.log.length;

  for (const entry of newEntries) {
    processLogEntry(memory, entry, game);
  }

  // Turn tracking
  const newTurn = game.currentPlayerIndex;
  if (newTurn !== memory.currentTurn) {
    memory.currentTurn = newTurn;
    memory.globalTurnCount++;

    // Decay all suspicion slightly each turn
    for (const [pid, val] of memory.suspicion) {
      memory.suspicion.set(pid, clampSuspicion(val + SUSPICION_DELTAS.decayPerTurn));
    }

    // Run pattern detection every 5 global turns
    if (memory.globalTurnCount % 5 === 0) {
      detectProtectionPatterns(memory);
      detectAvoidancePatterns(memory);
    }
  }
}

function processLogEntry(memory: BotMemory, entry: LogEntry, _game: GameState): void {
  const textEn = entry.text ?? '';
  const textRu = entry.textRu ?? '';
  const from = entry.fromPlayerId;
  const target = entry.targetPlayerId;
  const turn = memory.globalTurnCount;

  // --- Flamethrower ---
  if (textEn.includes('played Flamethrower') || textRu.includes('Огнемёт')) {
    if (from !== undefined) {
      const obs = getObs(memory, from);
      if (target !== undefined) {
        obs.flamethrowerTargets.push(target);
        obs.attackedPlayers.push(target);
        addInteraction(memory, { from, to: target, type: 'attack', turn });
      }
      adjustSuspicion(memory, from, SUSPICION_DELTAS.usedFlamethrower);
    }
  }

  // --- Necronomicon ---
  if (textEn.includes('Necronomicon') || textRu.includes('Некрономикон')) {
    if (from !== undefined && target !== undefined) {
      const obs = getObs(memory, from);
      obs.attackedPlayers.push(target);
      addInteraction(memory, { from, to: target, type: 'attack', turn });
      adjustSuspicion(memory, from, SUSPICION_DELTAS.usedFlamethrower);
    }
  }

  // --- Analysis ---
  if (textEn.includes('played Analysis') || textRu.includes('Анализ')) {
    if (from !== undefined) {
      adjustSuspicion(memory, from, SUSPICION_DELTAS.analyzedSomeone);
    }
  }

  // --- Suspicion card ---
  if (textEn.includes('played Suspicion') || textRu.includes('Подозрение')) {
    if (from !== undefined) {
      adjustSuspicion(memory, from, SUSPICION_DELTAS.analyzedSomeone * 0.5);
    }
  }

  // --- Quarantine ---
  if (textEn.includes('placed in quarantine') || textRu.includes('карантин')) {
    if (from !== undefined && target !== undefined) {
      const obs = getObs(memory, from);
      obs.quarantineTargets.push(target);
      addInteraction(memory, { from, to: target, type: 'quarantine', turn });
      adjustSuspicion(memory, from, SUSPICION_DELTAS.quarantinedSomeone);
    }
  }

  // --- Axe removing quarantine ---
  if ((textEn.includes('freed') && textEn.includes('quarantine')) ||
      (textRu.includes('освобожд') && textRu.includes('карантин'))) {
    if (from !== undefined && target !== undefined) {
      const obs = getObs(memory, from);
      obs.freedTargets.push(target);
      addInteraction(memory, { from, to: target, type: 'freed', turn });
      adjustSuspicion(memory, from, SUSPICION_DELTAS.freedFromQuarantine);
      adjustSuspicion(memory, target, SUSPICION_DELTAS.freedFromQuarantine * 0.5);
    }
  }

  // --- Locked door placed ---
  if (textEn.includes('locked door') || textRu.includes('Заколоченная дверь')) {
    if (from !== undefined) {
      adjustSuspicion(memory, from, SUSPICION_DELTAS.placedDoorDefensively);
    }
  }

  // --- Position swap ---
  if (textEn.includes('swapped places') || textRu.includes('меняется местами') || textRu.includes('поменялся')) {
    if (from !== undefined) {
      const obs = getObs(memory, from);
      obs.positionChanges++;
    }
    if (target !== undefined) {
      const obs = getObs(memory, target);
      obs.positionChanges++;
    }
  }

  // --- Direction reversal ---
  if (textEn.includes('Watch Your Back') || textRu.includes('Оглянись')) {
    // Reversing direction can be strategic — slight suspicion if it benefits them
    if (from !== undefined) {
      adjustSuspicion(memory, from, SUSPICION_DELTAS.swappedTowardSuspect * 0.3);
    }
  }

  // --- Defense: no_barbecue ---
  if (textEn.includes('No barbecue') || textRu.includes('Никакого шашлыка')) {
    if (target !== undefined) {
      adjustSuspicion(memory, target, SUSPICION_DELTAS.survivedFlamethrower);
    }
  }

  // --- Defense: anti_analysis ---
  if (textEn.includes('blocked analysis') || textEn.includes('Anti-Analysis') ||
      textRu.includes('Антианализ') || textRu.includes('заблокировал анализ')) {
    if (target !== undefined || from !== undefined) {
      const blocker = target ?? from;
      if (blocker !== undefined) {
        // Blocking analysis is suspicious — what are you hiding?
        adjustSuspicion(memory, blocker, SUSPICION_DELTAS.blockedAnalysis);
      }
    }
  }

  // --- Defense: trade refusal (fear/no_thanks/miss) ---
  if (textEn.includes('played Fear') || textEn.includes('played No thanks') || textEn.includes('played Miss') ||
      textRu.includes('Страх') || textRu.includes('Нет уж, спасибо') || textRu.includes('Мимо')) {
    if (from !== undefined || target !== undefined) {
      const refuser = target ?? from;
      if (refuser !== undefined) {
        adjustSuspicion(memory, refuser, SUSPICION_DELTAS.refusedTrade);
        const obs = getObs(memory, refuser);
        obs.refusedTradeCount++;
      }
    }
  }

  // --- Exchange happened ---
  if (
    textEn.includes('exchanged cards') ||
    textEn.includes('traded due to Just Between Us') ||
    textRu.includes('обменял') ||
    textRu.includes('обменялись')
  ) {
    if (from !== undefined && target !== undefined) {
      const obsFrom = getObs(memory, from);
      const obsTarget = getObs(memory, target);
      markHandChanged(memory, from, turn);
      markHandChanged(memory, target, turn);
      obsFrom.exchangeCount++;
      obsTarget.exchangeCount++;
      if (!obsFrom.exchangePartners.includes(target)) obsFrom.exchangePartners.push(target);
      if (!obsTarget.exchangePartners.includes(from)) obsTarget.exchangePartners.push(from);

      // Track for infection chain analysis
      const chainsFrom = memory.infectionChains.get(from) ?? [];
      chainsFrom.push({ partner: target, turn });
      memory.infectionChains.set(from, chainsFrom);
      const chainsTarget = memory.infectionChains.get(target) ?? [];
      chainsTarget.push({ partner: from, turn });
      memory.infectionChains.set(target, chainsTarget);

      addInteraction(memory, { from, to: target, type: 'exchange', turn });
      addInteraction(memory, { from: target, to: from, type: 'exchange', turn });

      adjustSuspicion(memory, from, SUSPICION_DELTAS.exchangePartner);
      adjustSuspicion(memory, target, SUSPICION_DELTAS.exchangePartner);
    }
  }

  // --- Visible hand changes invalidate stale certainty ---
  if (
    from !== undefined &&
    (
      textEn.includes('drew a card') ||
      textEn.includes('drew new cards') ||
      textEn.includes('swapped a card with the deck') ||
      textRu.includes('взял(а) карту') ||
      textRu.includes('взял(а) новые карты') ||
      textRu.includes('обменял(а) карту с колодой')
    )
  ) {
    markHandChanged(memory, from, turn);
  }

  // --- Player eliminated ---
  if (textEn.includes('eliminated') || textRu.includes('выбыва') || textRu.includes('устранён')) {
    // Remove eliminated player from active suspicion tracking
    if (target !== undefined) {
      memory.suspicion.delete(target);
    }
  }

  // --- Public hand reveal (whisky/panic) ---
  if (textEn.includes('shows their hand') || textRu.includes('показывает свою руку') || textRu.includes('показал')) {
    if (from !== undefined) {
      const obs = getObs(memory, from);
      obs.publicReveals.push({ turn, hadInfection: false }); // Updated when we see cards
    }
  }

  // --- Revelations: declined ---
  if (textEn.includes('declined to show') || textRu.includes('отказался показ') || textRu.includes('не показал')) {
    if (from !== undefined) {
      adjustSuspicion(memory, from, SUSPICION_DELTAS.declinedReveal);
      const obs = getObs(memory, from);
      obs.declinedRevealTurns.push(turn);
    }
  }

  // --- Revelations: showed clean ---
  if (textEn.includes('showed their hand') || textRu.includes('показал свою руку')) {
    if (from !== undefined) {
      // If the log doesn't mention infection, assume clean
      if (!textEn.includes('infected') && !textRu.includes('заражён')) {
        adjustSuspicion(memory, from, SUSPICION_DELTAS.acceptedRevealClean);
      }
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function recordSeenCards(
  memory: BotMemory,
  playerId: number,
  cards: { defId: string }[],
  turn: number,
  isFullHand: boolean,
): void {
  const obs = getObs(memory, playerId);
  for (const c of cards) {
    obs.seenCards.push({ uid: 'uid' in c ? (c as { uid?: string }).uid : undefined, defId: c.defId, turn });
  }

  const hasThingCard = cards.some(c => c.defId === 'the_thing');
  const hasInfectionCard = cards.some(c => c.defId === 'infected');

  if (hasThingCard) {
    obs.knownRole = 'thing';
  }

  if (hasInfectionCard) {
    obs.seenInfectionCardTurns.push(turn);
    adjustSuspicion(memory, playerId, SUSPICION_DELTAS.revealedInfected);
  }

  if (isFullHand) {
    if (!hasThingCard && !hasInfectionCard) {
      obs.lastFullHandInfectionFreeTurn = turn;
      adjustSuspicion(memory, playerId, SUSPICION_DELTAS.revealedClean);
    } else {
      // We saw a full hand, but future deductions must not treat this as permanent cleanliness.
      obs.lastFullHandInfectionFreeTurn = null;
    }
  }

  refreshCertainty(obs);

  if (obs.confirmedInfected) {
    propagateInfectionChain(memory, playerId);
  }
}

export function getMostSuspicious(memory: BotMemory): { playerId: number; score: number }[] {
  const result: { playerId: number; score: number }[] = [];
  for (const [pid, score] of memory.suspicion) {
    result.push({ playerId: pid, score });
  }
  return result.sort((a, b) => b.score - a.score);
}

/**
 * Get the game stage (0-1 progress) based on how many rounds have passed
 * and how many players are still alive.
 */
export function getGameProgress(memory: BotMemory, aliveCount: number): number {
  const turnProgress = Math.min(1, memory.globalTurnCount / (memory.totalPlayers * 4));
  const elimProgress = 1 - (aliveCount / memory.totalPlayers);
  return Math.max(turnProgress, elimProgress);
}

/**
 * Check if two players appear to be allies based on interaction patterns.
 * Returns a score from 0 (no evidence) to 1 (strong evidence).
 */
export function getAllianceScore(memory: BotMemory, playerA: number, playerB: number): number {
  let score = 0;
  const obsA = getObs(memory, playerA);
  const obsB = getObs(memory, playerB);

  // A protected B
  if (obsA.protectedPlayers.includes(playerB)) score += 0.3;
  if (obsB.protectedPlayers.includes(playerA)) score += 0.3;

  // A freed B from quarantine
  if (obsA.freedTargets.includes(playerB)) score += 0.25;
  if (obsB.freedTargets.includes(playerA)) score += 0.25;

  // Neither attacked the other
  if (!obsA.attackedPlayers.includes(playerB) && !obsB.attackedPlayers.includes(playerA)) {
    score += 0.1;
  }

  // Mutual exchanges
  const mutualExchanges = obsA.exchangePartners.filter(p => p === playerB).length;
  if (mutualExchanges >= 2) score += 0.15;

  return Math.min(1, score);
}
