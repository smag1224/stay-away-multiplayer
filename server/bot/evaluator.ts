/**
 * Action Evaluator — scores all legal actions using weighted heuristics.
 * Features: game stages, infection chains, bluffing, positional awareness,
 * coalition detection, direction planning.
 */

import type { GameAction, PendingAction } from '../../src/types.ts';
import { getCardDef } from '../../src/cards.ts';
import type { BotVisibleState } from './visibleState.ts';
import type { BotMemory, BotIntent } from './memory.ts';
import { getSuspicion, getGameProgress, getAllianceScore } from './memory.ts';
import {
  HUMAN_WEIGHTS,
  THING_WEIGHTS,
  INFECTED_WEIGHTS,
  NOISE_AMPLITUDE,
  BEST_ACTION_PROB,
  CARD_VALUES,
  SUSPICION_THRESHOLD_TRUSTED,
  STAGE,
  THING_AGGRESSIVE_TURNS,
  STAGE_VALUE_MULTS,
  infoCardMultiplier,
  aggressionMultiplier,
} from './config.ts';
import { applyStrategicBias } from './strategy.ts';

// ── Dynamic suspicion threshold ─────────────────────────────────────────────
// Lower threshold late-game: fewer suspects = more certainty needed to act
function suspicionThreshold(aliveCount: number): number {
  if (aliveCount <= 3) return 0.20;
  if (aliveCount <= 5) return 0.35;
  return 0.45;
}

// ── Intent planning helpers ──────────────────────────────────────────────────
const INTENT_MAX_AGE = 2; // Expire intents older than 2 turns

/** Cards worth creating an intent for when drawn */
const INTENT_WORTHY_CARDS: Record<string, string> = {
  axe: 'Break a door or free ally next turn',
  flamethrower: 'Burn suspected enemy next turn',
  swap_places: 'Swap with target next turn',
  you_better_run: 'Force move target next turn',
  analysis: 'Analyze suspicious player next turn',
  suspicion: 'Inspect suspicious player next turn',
};

function isIntentStale(intent: BotIntent, currentTurn: number): boolean {
  return currentTurn - intent.createdOnTurn > INTENT_MAX_AGE;
}

function expireStaleIntent(memory: BotMemory): void {
  if (memory.intent && isIntentStale(memory.intent, memory.currentTurn)) {
    memory.intent = null;
  }
}

/** Score boost when a playable card matches the stored intent */
function intentBoost(memory: BotMemory, defId: string): number {
  if (!memory.intent) return 0;
  if (memory.intent.playCardDefId === defId) return 4;
  return 0;
}

/** After evaluating play phase, create an intent for next turn if hand has key cards */
function maybeCreateIntent(
  vs: BotVisibleState,
  memory: BotMemory,
  _stage: GameStage,
): void {
  // Only create intent during play_or_discard — bot just drew and is choosing what to play
  // If bot plays the card now, no intent needed; intent is for cards held for next turn
  const heldDefIds = vs.myHand.map(c => c.defId);

  // Find the highest-priority intent-worthy card in hand that we're NOT playing this turn
  let bestCard: string | null = null;
  let bestPriority = -1;
  const priorities: Record<string, number> = {
    flamethrower: 5, axe: 4, swap_places: 3, you_better_run: 3,
    analysis: 2, suspicion: 1,
  };

  for (const defId of heldDefIds) {
    if (defId in INTENT_WORTHY_CARDS && (priorities[defId] ?? 0) > bestPriority) {
      bestCard = defId;
      bestPriority = priorities[defId] ?? 0;
    }
  }

  if (bestCard) {
    // Find best target for the intent
    let bestTarget: number | undefined;
    if (['flamethrower', 'analysis', 'suspicion'].includes(bestCard)) {
      // Target the most suspicious alive player, or confirmed enemy
      let highestSusp = -1;
      for (const p of vs.alivePlayers) {
        if (p.id === vs.myId) continue;
        const obs = memory.observations.get(p.id);
        // Confirmed infected gets highest priority
        const effectiveSusp = obs?.confirmedInfected ? 10 : getSuspicion(memory, p.id);
        if (effectiveSusp > highestSusp) { highestSusp = effectiveSusp; bestTarget = p.id; }
      }
    } else if (bestCard === 'axe') {
      // Target a door or quarantined ally
      const door = vs.doors.find(d =>
        d.between[0] === vs.me.position || d.between[1] === vs.me.position
      );
      if (door) {
        const otherPos = door.between[0] === vs.me.position ? door.between[1] : door.between[0];
        const otherPlayer = vs.alivePlayers.find(p => p.position === otherPos);
        if (otherPlayer) bestTarget = otherPlayer.id;
      }
    }

    memory.intent = {
      playCardDefId: bestCard,
      targetPlayerId: bestTarget,
      createdOnTurn: memory.currentTurn,
      reason: INTENT_WORTHY_CARDS[bestCard],
    };
    return;
  }

  // No intent-worthy card in hand — but if we know an enemy, set "hunt" intent
  // This motivates the bot to draw cards and look for flamethrower
  if (vs.myRole === 'human') {
    const confirmedEnemy = vs.alivePlayers.find(p => {
      if (p.id === vs.myId) return false;
      return memory.observations.get(p.id)?.confirmedInfected;
    });
    if (confirmedEnemy) {
      memory.intent = {
        playCardDefId: 'flamethrower', // "I want a flamethrower"
        targetPlayerId: confirmedEnemy.id,
        createdOnTurn: memory.currentTurn,
        reason: 'Hunt: find flamethrower to burn confirmed enemy',
      };
    }
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScoredAction {
  action: GameAction;
  score: number;
  reason: string;
}

type Weights = typeof HUMAN_WEIGHTS | typeof THING_WEIGHTS | typeof INFECTED_WEIGHTS;
type PositionMap = Map<number, number>;
type ObservedPlayer = BotMemory['observations'] extends Map<number, infer T> ? T : never;

interface IncomingTradePolicySnapshot {
  observation: ObservedPlayer;
  freshSeenDefs: string[];
  freshSeenCounts: Map<string, number>;
  totalFreshSeen: number;
  thingCount: number;
  infectedCount: number;
  safeSeenCount: number;
  infectedPassability: number;
  safeEscapeWeight: number;
  effectiveInfectedThreat: number;
  forcedness: number;
  behavioralIntentModifier: number;
}

// ── Game stage ──────────────────────────────────────────────────────────────

type GameStage = 'early' | 'mid' | 'late';
const INFECTION_OVERLOAD_LIMIT = 4;
const INFECTION_OVERLOAD_WARNING = INFECTION_OVERLOAD_LIMIT - 1;

function getStage(progress: number): GameStage {
  if (progress < STAGE.earlyEnd) return 'early';
  if (progress < STAGE.midEnd) return 'mid';
  return 'late';
}

function stageIndex(stage: GameStage): 0 | 1 | 2 {
  if (stage === 'early') return 0;
  if (stage === 'mid') return 1;
  return 2;
}

/** Get dynamic card value adjusted for game stage and player count */
function dynamicCardValue(defId: string, stage: GameStage, playerCount: number): number {
  const base = CARD_VALUES[defId] ?? 2;
  const mults = STAGE_VALUE_MULTS[defId];
  const stageMult = mults ? mults[stageIndex(stage)] : 1;
  const def = getCardDef(defId);
  let countMult = 1;
  if (def.category === 'action' && ['analysis', 'suspicion', 'lovecraft'].includes(defId)) {
    countMult = infoCardMultiplier(playerCount);
  }
  if (['flamethrower', 'necronomicon'].includes(defId)) {
    countMult = aggressionMultiplier(playerCount);
  }
  return base * stageMult * countMult;
}

function applyInfectionOverloadSheddingBias(
  vs: BotVisibleState,
  defId: string,
  score: number,
): number {
  if (defId !== 'infected') return score;
  if (vs.myRole !== 'thing' && vs.myRole !== 'infected') return score;

  if (vs.myInfectedCount >= INFECTION_OVERLOAD_WARNING) {
    return Math.max(score, 18);
  }

  if (vs.myInfectedCount >= 2) {
    return Math.max(score, vs.myRole === 'thing' ? 10 : 9);
  }

  return score;
}

function applyInfectionOverloadKeepPenalty(
  vs: BotVisibleState,
  defId: string,
  score: number,
): number {
  if (defId !== 'infected') return score;
  if (vs.myRole !== 'thing' && vs.myRole !== 'infected') return score;
  if (vs.myInfectedCount < INFECTION_OVERLOAD_WARNING) return score;
  return Math.min(score, 0.1);
}

function canTradeCardWithTarget(
  vs: BotVisibleState,
  card: BotVisibleState['myHand'][number],
  targetId: number,
): boolean {
  if (card.defId === 'the_thing') return false;
  if (card.defId !== 'infected') return true;

  const target = vs.players.find(player => player.id === targetId);
  if (!target || target.id === vs.myId) return false;
  if (!target.canReceiveInfectedCardFromMe) return false;

  if (vs.myRole === 'thing') return true;
  if (vs.myRole === 'infected') return vs.myInfectedCount > 1;
  return false;
}

function getTradeableCardsForTarget(vs: BotVisibleState, targetId: number | null): BotVisibleState['myHand'] {
  if (targetId === null) return vs.tradeableCards;
  return vs.myHand.filter(card => canTradeCardWithTarget(vs, card, targetId));
}

function getDirectionalTradeTargetId(
  vs: BotVisibleState,
  playerId: number,
  direction: 1 | -1,
): number | null {
  const alivePlayers = [...vs.alivePlayers].sort((left, right) => left.position - right.position);
  if (alivePlayers.length <= 1) return null;

  const currentIndex = alivePlayers.findIndex(player => player.id === playerId);
  if (currentIndex === -1) return null;

  const targetIndex = (currentIndex + direction + alivePlayers.length) % alivePlayers.length;
  return alivePlayers[targetIndex]?.id ?? null;
}

// ── Main entry ──────────────────────────────────────────────────────────────

export function evaluateActions(vs: BotVisibleState, memory: BotMemory): ScoredAction[] {
  const actions: ScoredAction[] = [];
  const w = getWeights(vs.myRole);
  const pa = vs.pendingAction;
  const progress = getGameProgress(memory, vs.aliveCount);
  const stage = getStage(progress);

  if (pa) {
    return evaluatePendingActions(vs, memory, pa, w, stage);
  }

  if (!vs.isMyTurn) return [];

  switch (vs.step) {
    case 'draw':
      actions.push({ action: { type: 'DRAW_CARD' }, score: 10, reason: 'Must draw' });
      break;
    case 'play_or_discard':
      evaluatePlayPhase(vs, memory, w, actions, stage);
      break;
    case 'trade':
      evaluateTradePhase(vs, memory, w, actions, stage);
      break;
    case 'end_turn':
      actions.push({ action: { type: 'END_TURN' }, score: 10, reason: 'End turn' });
      break;
  }

  applyStrategicBias(actions, vs, memory, stage);
  for (const a of actions) {
    a.score += (Math.random() - 0.5) * NOISE_AMPLITUDE;
  }
  return actions.sort((a, b) => b.score - a.score);
}

export function selectAction(scored: ScoredAction[]): GameAction | null {
  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0].action;

  if (Math.random() < BEST_ACTION_PROB || scored.length <= 2) {
    return scored[0].action;
  }
  const topN = scored.slice(0, Math.min(3, scored.length));
  const minScore = Math.min(...topN.map(a => a.score));
  const shifted = topN.map(a => ({ ...a, w: a.score - minScore + 0.1 }));
  const total = shifted.reduce((sum, a) => sum + a.w, 0);
  let r = Math.random() * total;
  for (const a of shifted) {
    r -= a.w;
    if (r <= 0) return a.action;
  }
  return scored[0].action;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWeights(role: string): Weights {
  if (role === 'thing') return THING_WEIGHTS;
  if (role === 'infected') return INFECTED_WEIGHTS;
  return HUMAN_WEIGHTS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCurrentPositions(vs: BotVisibleState): PositionMap {
  return new Map(vs.alivePlayers.map(player => [player.id, player.position]));
}

function swapPositionsInMap(positions: PositionMap, playerId: number, targetId: number): PositionMap {
  const next = new Map(positions);
  const playerPos = next.get(playerId);
  const targetPos = next.get(targetId);

  if (playerPos === undefined || targetPos === undefined) return next;

  next.set(playerId, targetPos);
  next.set(targetId, playerPos);
  return next;
}

function getTradePartnerIdForState(
  vs: BotVisibleState,
  positions: PositionMap,
  direction: 1 | -1,
): number | null {
  const myPos = positions.get(vs.myId);
  if (myPos === undefined) return null;

  const alivePositions = [...positions.values()].sort((a, b) => a - b);
  if (alivePositions.length <= 1) return null;

  const myIdx = alivePositions.indexOf(myPos);
  if (myIdx === -1) return null;

  const nextIdx = (myIdx + direction + alivePositions.length) % alivePositions.length;
  const nextPos = alivePositions[nextIdx];

  for (const [playerId, position] of positions.entries()) {
    if (position === nextPos) return playerId;
  }

  return null;
}

function hasDoorBetweenPositions(vs: BotVisibleState, pos1: number, pos2: number): boolean {
  return vs.doors.some(door =>
    (door.between[0] === pos1 && door.between[1] === pos2) ||
    (door.between[0] === pos2 && door.between[1] === pos1)
  );
}

function scoreTradePartnerUtility(
  vs: BotVisibleState,
  memory: BotMemory,
  partnerId: number,
  positions: PositionMap,
): number {
  const partnerInfo = vs.alivePlayers.find(player => player.id === partnerId);
  const myPos = positions.get(vs.myId);
  const partnerPos = positions.get(partnerId);
  if (!partnerInfo || myPos === undefined || partnerPos === undefined) return 0;

  const obs = memory.observations.get(partnerId);
  const susp = getSuspicion(memory, partnerId);
  const blocked = hasDoorBetweenPositions(vs, myPos, partnerPos);

  if (vs.myRole === 'human') {
    let score = clamp((0.2 - susp) * 12, -7, 7);
    if (obs?.confirmedClean) score += 4;
    if (obs?.confirmedInfected) score = -12;
    if (partnerInfo.inQuarantine) score -= 3;
    if (blocked) score += score < 0 ? 2.5 : -2.5;
    return score;
  }

  if (vs.myRole === 'thing') {
    let score = obs?.confirmedInfected ? -8 : 8;
    score += clamp((0.15 - susp) * 4, -2, 2);
    if (partnerInfo.inQuarantine) score -= 4;
    if (blocked) score -= 6;
    return score;
  }

  let score = 0;
  if (partnerInfo.canReceiveInfectedCardFromMe) score += 9;
  else if (obs?.confirmedInfected) score += 5;
  else score += vs.aliveCount <= 3 ? 4 : 1;

  if (!partnerInfo.canReceiveInfectedCardFromMe) {
    score += clamp((0.15 - susp) * 4, -2, 2);
  }
  if (partnerInfo.inQuarantine) score -= 3;
  if (blocked) score -= (partnerInfo.canReceiveInfectedCardFromMe || obs?.confirmedInfected) ? 3 : 4;
  return score;
}

function getTradePartnerUtility(
  vs: BotVisibleState,
  memory: BotMemory,
  positions: PositionMap,
  direction: 1 | -1,
): number {
  const partnerId = getTradePartnerIdForState(vs, positions, direction);
  if (partnerId === null) return 0;
  return scoreTradePartnerUtility(vs, memory, partnerId, positions);
}

function getReversedDirectionTradePartnerDelta(vs: BotVisibleState, memory: BotMemory): number {
  const positions = getCurrentPositions(vs);
  const current = getTradePartnerUtility(vs, memory, positions, vs.direction);
  const reversedDirection = (vs.direction === 1 ? -1 : 1) as 1 | -1;
  const reversed = getTradePartnerUtility(vs, memory, positions, reversedDirection);
  return reversed - current;
}

function getPostMoveTradePartnerDelta(vs: BotVisibleState, memory: BotMemory, targetId: number): number {
  const currentPositions = getCurrentPositions(vs);
  const current = getTradePartnerUtility(vs, memory, currentPositions, vs.direction);
  const movedPositions = swapPositionsInMap(currentPositions, vs.myId, targetId);
  const moved = getTradePartnerUtility(vs, memory, movedPositions, vs.direction);
  return moved - current;
}

function scoreTradeCardForPartner(
  vs: BotVisibleState,
  memory: BotMemory,
  card: { defId: string; uid: string },
  partnerId: number | null,
  stage: GameStage,
): number {
  const def = getCardDef(card.defId);
  const dv = dynamicCardValue(card.defId, stage, vs.players.length);
  let score = 12 - dv;

  const partnerSusp = partnerId !== null ? getSuspicion(memory, partnerId) : 0;
  const partnerObs = partnerId !== null ? memory.observations.get(partnerId) : undefined;
  const partnerInfo = partnerId !== null ? vs.alivePlayers.find(player => player.id === partnerId) : undefined;

  if (vs.myRole === 'thing' && card.defId === 'infected') {
    score = memory.globalTurnCount >= THING_AGGRESSIVE_TURNS ? 18 : 12;
  }

  if (vs.myRole === 'infected' && card.defId === 'infected') {
    // Identify the Thing via explicit knowledge or via game mechanic (canReceiveInfectedCardFromMe)
    const partnerIsTheThing = partnerObs?.knownRole === 'thing' || Boolean(partnerInfo?.canReceiveInfectedCardFromMe);
    score = partnerIsTheThing ? 12 : 3;
  }

  score = applyInfectionOverloadSheddingBias(vs, card.defId, score);

  if (vs.myRole === 'infected' && partnerId !== null) {
    // canReceiveInfectedCardFromMe is true only for the Thing — reliable ally identification
    const partnerIsTheThing = partnerObs?.knownRole === 'thing' || Boolean(partnerInfo?.canReceiveInfectedCardFromMe);
    const partnerIsAlly = partnerIsTheThing || Boolean(partnerObs?.confirmedInfected);

    if (partnerIsAlly) {
      // Use early returns to bypass the bottom defense/action multipliers.
      // Without early returns, no_barbecue=16 → ×0.3=4.8 and flamethrower=15 → ×0.25=3.75.
      if (card.defId === 'no_barbecue') return 16;   // Protect ally from flamethrower
      if (card.defId === 'anti_analysis') return 10;  // Protect ally from analysis
      if (card.defId === 'axe') {
        const allyHasDoorProblem = vs.doors.length > 0 && vs.aliveCount <= 5;
        return allyHasDoorProblem ? 14 : 8;
      }
      if (['swap_places', 'you_better_run'].includes(card.defId)) {
        return vs.aliveCount <= 4 ? 12 : 7;
      }
      if (card.defId === 'flamethrower' && vs.aliveCount <= 4) {
        const partnerAdjacentHuman = vs.alivePlayers.some(player => {
          if (player.id === partnerId || player.id === vs.myId) return false;
          const playerObs = memory.observations.get(player.id);
          return !playerObs?.confirmedInfected;
        });
        if (partnerAdjacentHuman) return 15;
      }
      if (card.defId === 'infected') {
        // Always reload the Thing even with 1 card — Thing needs ammo to infect more humans
        if (partnerIsTheThing) return 12;
        // Give excess infected cards to other infected allies
        const myInfectedCards = vs.myHand.filter(handCard => handCard.defId === 'infected').length;
        return myInfectedCards >= 2 ? 16 : 1;
      }
    }

    if (!partnerIsAlly && vs.aliveCount <= 4 && card.defId === 'flamethrower') {
      return 0.5; // Don't give flamethrower to humans in endgame
    }
  }

  // Human trading with confirmed enemy: never give them weapons/defense
  if (vs.myRole === 'human' && partnerObs?.confirmedInfected) {
    if (['flamethrower', 'analysis', 'no_barbecue', 'axe'].includes(card.defId)) {
      score *= 0.05; // Almost never trade these to known enemy
    }
  } else if (vs.myRole === 'human' && partnerSusp > suspicionThreshold(vs.aliveCount)) {
    if (['flamethrower', 'analysis', 'no_barbecue'].includes(card.defId)) {
      score *= 0.2;
    }
  }

  // Card-style profiling: avoid giving strong cards to dangerous partners
  if (vs.myRole === 'human' && partnerId !== null) {
    const partnerThreat = playerThreatFromHand(memory, partnerId);
    if (partnerThreat >= 3 && ['no_barbecue', 'no_thanks'].includes(card.defId)) {
      score *= 0.15; // Don't arm a dangerous/suspicious player with defense
    }
  }

  // Thing: lower infection trade score if partner likely has flamethrower (risky target)
  if (vs.myRole === 'thing' && card.defId === 'infected' && partnerId !== null) {
    if (playerLikelyHasCard(memory, partnerId, 'flamethrower')) {
      score *= 0.4; // They might burn us if we infect them
    }
  }

  // Thing: pass utility cards to known infected allies to strengthen them.
  // Early returns bypass the bottom ×0.3 and ×0.25 multipliers.
  if (vs.myRole === 'thing' && partnerObs?.confirmedInfected) {
    if (card.defId === 'no_barbecue') return 14;   // Protect infected ally from flamethrower
    if (card.defId === 'anti_analysis') return 9;  // Protect against analysis
    if (['axe', 'swap_places'].includes(card.defId) && vs.aliveCount <= 5) return 10;
  }

  if (def.category === 'defense') score *= 0.3;
  if (['flamethrower', 'analysis', 'persistence'].includes(card.defId)) score *= 0.25;

  return Math.max(0.1, score);
}

function getFreshSeenCardDefs(memory: BotMemory, playerId: number): string[] {
  const obs = memory.observations.get(playerId);
  if (!obs) return [];

  return obs.seenCards
    .filter(card => obs.lastHandChangeTurn === null || card.turn > obs.lastHandChangeTurn)
    .map(card => card.defId);
}

// ── Card-style profiling ────────────────────────────────────────────────────
// Check if a player likely has a specific card based on recent observations.
// Returns true if the card was seen in their hand and no hand change since.
function playerLikelyHasCard(memory: BotMemory, playerId: number, defId: string): boolean {
  const fresh = getFreshSeenCardDefs(memory, playerId);
  return fresh.includes(defId);
}

// Check if a player likely has ANY defense card that blocks a specific attack.
function playerLikelyHasDefenseAgainst(memory: BotMemory, playerId: number, attackDefId: string): boolean {
  const fresh = getFreshSeenCardDefs(memory, playerId);
  switch (attackDefId) {
    case 'flamethrower': return fresh.includes('no_barbecue');
    case 'analysis': return fresh.includes('anti_analysis');
    case 'swap_places':
    case 'you_better_run': return fresh.includes('im_fine_here');
    default: return fresh.includes('no_thanks') || fresh.includes('fear');
  }
}

// Score how threatening a player's known hand is (higher = more dangerous)
function playerThreatFromHand(memory: BotMemory, playerId: number): number {
  const fresh = getFreshSeenCardDefs(memory, playerId);
  let threat = 0;
  for (const defId of fresh) {
    if (defId === 'flamethrower') threat += 4;
    else if (defId === 'analysis') threat += 2;
    else if (defId === 'suspicion') threat += 1.5;
    else if (defId === 'axe') threat += 1;
    else if (defId === 'no_barbecue') threat += 0.5;
  }
  return threat;
}

function countCardDefs(defIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const defId of defIds) {
    counts.set(defId, (counts.get(defId) ?? 0) + 1);
  }

  return counts;
}

function getSeenSafeCardEscapeWeight(defId: string, stage: GameStage, playerCount: number): number {
  if (['infected', 'the_thing'].includes(defId)) return 0;

  const value = dynamicCardValue(defId, stage, playerCount);
  const keepPressure = clamp(value / 8, 0.1, 1.4);

  return clamp(1.15 - keepPressure, 0.12, 1.05);
}

function getInfectedPassability(
  obs: ObservedPlayer,
  recipientRole: BotVisibleState['myRole'],
  infectedCount: number,
  safeSeenCount: number,
): number {
  if (infectedCount <= 0) return 0;
  if (obs.knownRole === 'infected' && recipientRole === 'human') return 0;
  if (obs.knownRole !== 'infected') return 1;
  if (infectedCount >= 2) return 1;
  if (safeSeenCount > 0) return 0.15;
  return 0.45;
}

function getBehavioralTradeIntentModifier(
  vs: BotVisibleState,
  obs: ObservedPlayer,
): number {
  const directAttacks = obs.attackedPlayers.filter(playerId => playerId === vs.myId).length;
  const directQuarantines = obs.quarantineTargets.filter(playerId => playerId === vs.myId).length;
  const directFlamethrowers = obs.flamethrowerTargets.filter(playerId => playerId === vs.myId).length;
  const directProtections = obs.protectedPlayers.filter(playerId => playerId === vs.myId).length;
  const directFrees = obs.freedTargets.filter(playerId => playerId === vs.myId).length;

  return clamp(
    directAttacks * 0.9 +
    directQuarantines * 0.6 +
    directFlamethrowers * 1.5 -
    directProtections * 0.45 -
    directFrees * 0.75,
    -2,
    4,
  );
}

function buildIncomingTradePolicySnapshot(
  vs: BotVisibleState,
  memory: BotMemory,
  partnerId: number | null,
  stage: GameStage,
): IncomingTradePolicySnapshot | null {
  if (partnerId === null) return null;

  const observation = memory.observations.get(partnerId);
  if (!observation) return null;

  const freshSeenDefs = getFreshSeenCardDefs(memory, partnerId);
  const freshSeenCounts = countCardDefs(freshSeenDefs);
  const totalFreshSeen = [...freshSeenCounts.values()].reduce((sum, count) => sum + count, 0);
  const thingCount = freshSeenCounts.get('the_thing') ?? 0;
  const infectedCount = freshSeenCounts.get('infected') ?? 0;
  const safeSeenCount = Math.max(0, totalFreshSeen - thingCount - infectedCount);
  const infectedPassability = getInfectedPassability(
    observation,
    vs.myRole,
    infectedCount,
    safeSeenCount,
  );
  const safeEscapeWeight = freshSeenDefs.reduce((sum, defId) => (
    sum + getSeenSafeCardEscapeWeight(defId, stage, vs.players.length)
  ), 0);
  const effectiveInfectedThreat = infectedCount * infectedPassability;
  const dangerWeight = thingCount * 1.3 + effectiveInfectedThreat;
  const forcedness = dangerWeight > 0
    ? clamp(dangerWeight / (dangerWeight + safeEscapeWeight), 0.25, 1)
    : (totalFreshSeen > 0 ? 0.25 : 1);
  const behavioralIntentModifier = getBehavioralTradeIntentModifier(vs, observation);

  return {
    observation,
    freshSeenDefs,
    freshSeenCounts,
    totalFreshSeen,
    thingCount,
    infectedCount,
    safeSeenCount,
    infectedPassability,
    safeEscapeWeight,
    effectiveInfectedThreat,
    forcedness,
    behavioralIntentModifier,
  };
}

function scoreHumanIncomingTradeRisk(snapshot: IncomingTradePolicySnapshot): number {
  let risk = 0;

  if (snapshot.observation.knownRole === 'thing') risk += 10;
  if (snapshot.thingCount > 0) {
    risk = Math.max(risk, 12 * snapshot.forcedness);
  }
  if (snapshot.infectedCount > 0) {
    risk +=
      (5 + Math.max(0, snapshot.infectedCount - 1) * 3) *
      snapshot.forcedness *
      snapshot.infectedPassability;
  }

  risk += snapshot.behavioralIntentModifier;
  return risk;
}

export function getIncomingTradeRisk(
  vs: BotVisibleState,
  memory: BotMemory,
  partnerId: number | null,
  stage: GameStage,
): number {
  const snapshot = buildIncomingTradePolicySnapshot(vs, memory, partnerId, stage);
  if (!snapshot) return 0;

  if (vs.myRole === 'human') return scoreHumanIncomingTradeRisk(snapshot);

  if (vs.myInfectedCount < INFECTION_OVERLOAD_WARNING) return 0;

  const knownRole = snapshot.observation.knownRole;

  if (knownRole === 'infected' && vs.myRole === 'infected') {
    return 0;
  }

  let risk = 4;

  if (vs.myInfectedCount >= INFECTION_OVERLOAD_WARNING) {
    risk += 6;
  }

  if (knownRole === 'thing') {
    risk += vs.myInfectedCount >= INFECTION_OVERLOAD_WARNING ? 16 : 10;
  } else if (knownRole === 'infected' && vs.myRole === 'thing') {
    risk += 8;
  } else {
    risk += snapshot.infectedCount > 0 ? 4 * snapshot.forcedness : 0;
    risk += snapshot.thingCount > 0 ? 8 * snapshot.forcedness : 0;
  }

  return risk;
}

function getBestTradeFollowUpForPartner(
  vs: BotVisibleState,
  memory: BotMemory,
  partnerId: number | null,
  stage: GameStage,
  excludeCardUid?: string,
): number {
  if (vs.tradeSkipped || partnerId === null) return 0;

  const remainingTradeCards = vs.tradeableCards.filter(card => card.uid !== excludeCardUid);
  if (remainingTradeCards.length === 0) return 0;

  const bestOutgoing = remainingTradeCards.reduce((best, card) => (
    Math.max(best, scoreTradeCardForPartner(vs, memory, card, partnerId, stage))
  ), 0);
  const incomingRisk = getIncomingTradeRisk(vs, memory, partnerId, stage);

  return bestOutgoing - incomingRisk;
}

function getTradeFollowUpForLayout(
  vs: BotVisibleState,
  memory: BotMemory,
  positions: PositionMap,
  direction: 1 | -1,
  stage: GameStage,
  excludeCardUid?: string,
): number {
  const partnerId = getTradePartnerIdForState(vs, positions, direction);
  return getBestTradeFollowUpForPartner(vs, memory, partnerId, stage, excludeCardUid);
}

function getTradeFollowUpScoreForReversedLayout(
  vs: BotVisibleState,
  memory: BotMemory,
  stage: GameStage,
  excludeCardUid?: string,
): number {
  const positions = getCurrentPositions(vs);
  const reversedDirection = (vs.direction === 1 ? -1 : 1) as 1 | -1;
  return getTradeFollowUpForLayout(vs, memory, positions, reversedDirection, stage, excludeCardUid);
}

function getTradeFollowUpScoreForMovedLayout(
  vs: BotVisibleState,
  memory: BotMemory,
  targetId: number,
  stage: GameStage,
  excludeCardUid?: string,
): number {
  const positions = swapPositionsInMap(getCurrentPositions(vs), vs.myId, targetId);
  return getTradeFollowUpForLayout(vs, memory, positions, vs.direction, stage, excludeCardUid);
}

function getReversedTradeFollowUpDelta(
  vs: BotVisibleState,
  memory: BotMemory,
  stage: GameStage,
  excludeCardUid?: string,
): number {
  const positions = getCurrentPositions(vs);
  const current = getTradeFollowUpForLayout(vs, memory, positions, vs.direction, stage, excludeCardUid);
  const reversedDirection = (vs.direction === 1 ? -1 : 1) as 1 | -1;
  const reversed = getTradeFollowUpForLayout(vs, memory, positions, reversedDirection, stage, excludeCardUid);
  return reversed - current;
}

function getPostMoveTradeFollowUpDelta(
  vs: BotVisibleState,
  memory: BotMemory,
  targetId: number,
  stage: GameStage,
  excludeCardUid?: string,
): number {
  const currentPositions = getCurrentPositions(vs);
  const current = getTradeFollowUpForLayout(vs, memory, currentPositions, vs.direction, stage, excludeCardUid);
  const movedPositions = swapPositionsInMap(currentPositions, vs.myId, targetId);
  const moved = getTradeFollowUpForLayout(vs, memory, movedPositions, vs.direction, stage, excludeCardUid);
  return moved - current;
}

function getBestPostMovePlanValue(
  vs: BotVisibleState,
  memory: BotMemory,
  targets: number[],
  stage: GameStage,
  excludeCardUid: string | undefined,
  partnerDeltaWeight: number,
  tradeDeltaWeight: number,
  tradeScoreWeight: number,
): number {
  if (targets.length === 0) return 0;

  return targets.reduce((best, targetId) => {
    const value =
      getPostMoveTradePartnerDelta(vs, memory, targetId) * partnerDeltaWeight +
      getPostMoveTradeFollowUpDelta(vs, memory, targetId, stage, excludeCardUid) * tradeDeltaWeight +
      getTradeFollowUpScoreForMovedLayout(vs, memory, targetId, stage, excludeCardUid) * tradeScoreWeight;
    return Math.max(best, value);
  }, Number.NEGATIVE_INFINITY);
}

function getReversePlanValue(
  vs: BotVisibleState,
  memory: BotMemory,
  stage: GameStage,
  excludeCardUid: string | undefined,
  partnerDeltaWeight: number,
  tradeDeltaWeight: number,
  tradeScoreWeight: number,
): number {
  return (
    getReversedDirectionTradePartnerDelta(vs, memory) * partnerDeltaWeight +
    getReversedTradeFollowUpDelta(vs, memory, stage, excludeCardUid) * tradeDeltaWeight +
    getTradeFollowUpScoreForReversedLayout(vs, memory, stage, excludeCardUid) * tradeScoreWeight
  );
}

// ── Play phase ──────────────────────────────────────────────────────────────

function evaluatePlayPhase(vs: BotVisibleState, memory: BotMemory, w: Weights, actions: ScoredAction[], stage: GameStage): void {
  // Expire stale intents
  expireStaleIntent(memory);

  for (const pc of vs.playableCards) {
    let score = scorePlayCard(vs, memory, pc.card.uid, pc.defId, pc.targets, w, stage);

    // Intent boost: if this card matches what bot planned last turn, boost it
    const boost = intentBoost(memory, pc.defId);
    if (boost > 0) {
      score += boost;
      // Extra boost if target also matches the intent
      if (memory.intent?.targetPlayerId !== undefined && pc.targets.includes(memory.intent.targetPlayerId)) {
        score += 2;
      }
    }

    if (score > 0 && pc.targets.length > 0) {
      actions.push({
        action: { type: 'PLAY_CARD', cardUid: pc.card.uid },
        score,
        reason: boost > 0 ? `Play ${pc.defId} (planned)` : `Play ${pc.defId}`,
      });
    } else if (score > 0 && pc.targets.length === 0) {
      actions.push({
        action: { type: 'PLAY_CARD', cardUid: pc.card.uid },
        score,
        reason: boost > 0 ? `Play ${pc.defId} (planned)` : `Play ${pc.defId}`,
      });
    }
  }

  // Clear intent after play evaluation — it was either used or is no longer relevant
  if (memory.intent) memory.intent = null;

  for (const dc of vs.discardableCards) {
    const def = getCardDef(dc.defId);
    const dv = dynamicCardValue(dc.defId, stage, vs.players.length);
    let score = 12 - dv;

    if (vs.myRole === 'thing' || vs.myRole === 'infected') {
      if (dc.defId === 'infected') score = 0.05;
      if (dc.defId === 'anti_analysis') score = 0.1;
      if (dc.defId === 'no_barbecue') score = 0.1;
    } else {
      if (dc.defId === 'infected') score = 11;
    }

    score = applyInfectionOverloadSheddingBias(vs, dc.defId, score);

    if (def.category === 'defense') score *= 0.35;

    actions.push({
      action: { type: 'DISCARD_CARD', cardUid: dc.uid },
      score: Math.max(0.05, score),
      reason: `Discard ${dc.defId}`,
    });
  }

  // After scoring, create intent for next turn based on cards still in hand
  maybeCreateIntent(vs, memory, stage);
}

function scorePlayCard(
  vs: BotVisibleState,
  memory: BotMemory,
  cardUid: string,
  defId: string,
  targets: number[],
  w: Weights,
  stage: GameStage,
): number {
  const isEarly = stage === 'early';
  const isLate = stage === 'late';

  switch (defId) {
    case 'flamethrower': {
      const hasConfirmed = targets.some(t => memory.observations.get(t)?.confirmedInfected);
      const hasStrong = targets.some(t => getSuspicion(memory, t) > suspicionThreshold(vs.aliveCount));

      // Infected endgame: burn humans — aliveCount<=4 covers 1T+2I+1H which is already a win
      if (vs.myRole === 'infected' && vs.aliveCount <= 4) {
        const lastHuman = targets.find(t => {
          const obs = memory.observations.get(t);
          return !obs?.confirmedInfected;
        });
        if (lastHuman !== undefined) return 18; // Win condition
      }

      // Thing endgame: flamethrower the remaining human(s)
      if (vs.myRole === 'thing' && vs.aliveCount <= 4) {
        const lastHuman = targets.find(t => {
          const obs = memory.observations.get(t);
          return !obs?.confirmedInfected;
        });
        if (lastHuman !== undefined) return 16;
      }

      if (hasConfirmed) {
        // Even if target has no_barbecue — burn anyway to force them to spend the defense!
        // After they waste it, next flamethrower will kill. This is the optimal human strategy.
        const confirmedTargets = targets.filter(t => memory.observations.get(t)?.confirmedInfected);
        const someDefended = confirmedTargets.some(t => playerLikelyHasDefenseAgainst(memory, t, 'flamethrower'));
        // Slightly lower score if defended (we know it'll be blocked), but still high — burning defense is valuable
        return someDefended
          ? (w as any).playFlamethrower + 2  // Force out no_barbecue
          : (w as any).playFlamethrower + 4; // Clean kill
      }
      if (hasStrong) return (w as any).playFlamethrower * (isLate ? 1.3 : 0.9);

      // Thing/Infected: consider bluffing — burn a "burned" infected ally to look innocent
      if ((vs.myRole === 'thing' || vs.myRole === 'infected') && isLate) {
        const expendableAlly = targets.find(t => {
          const obs = memory.observations.get(t);
          return obs?.confirmedInfected && getSuspicion(memory, t) > 0.5;
        });
        if (expendableAlly !== undefined) {
          return (w as any).bluffFlamethrowerInfected ?? (w as any).playFlamethrowerLowEvidence;
        }
      }

      return (w as any).playFlamethrowerLowEvidence * (isEarly ? 0.3 : isLate ? 1.5 : 0.7);
    }

    case 'analysis': {
      const unknowns = targets.filter(t => {
        const obs = memory.observations.get(t);
        return !obs?.confirmedClean && !obs?.confirmedInfected;
      });
      const suspicious = targets.filter(t => getSuspicion(memory, t) > 0.15);
      const verySuspicious = targets.filter(t => getSuspicion(memory, t) > 0.35);
      let score = unknowns.length > 0 ? (w as any).playAnalysis : 1;
      if (suspicious.length > 0 && unknowns.some(t => suspicious.includes(t))) score += 2;
      // Bigger bonus for targeting highly suspicious unknowns — humans should investigate aggressively
      if (verySuspicious.length > 0 && unknowns.some(t => verySuspicious.includes(t))) score += 3;

      // Thing bluff: analyze own infected ally to look like proactive human
      if (vs.myRole === 'thing' && (isEarly || stage === 'mid')) {
        const infectedAlly = targets.find(t => memory.observations.get(t)?.confirmedInfected);
        if (infectedAlly !== undefined) {
          score = Math.max(score, (w as any).bluffAnalyzeInfected ?? 3);
        }
      }

      return score * infoCardMultiplier(vs.players.length);
    }

    case 'suspicion': {
      let score = (w as any).playSuspicion * (isEarly ? 1.3 : 0.7);
      return score * infoCardMultiplier(vs.players.length);
    }

    case 'quarantine': {
      if (vs.myRole === 'human') {
        const susTargs = targets.filter(t => t !== vs.myId && getSuspicion(memory, t) > suspicionThreshold(vs.aliveCount));
        if (susTargs.length > 0) return (w as any).playQuarantine * 1.8;
        return (w as any).playQuarantine * 0.4;
      }
      // Thing/Infected: prioritize quarantining humans who likely have flamethrower or analysis
      const dangerousHuman = targets.find(t => {
        const obs = memory.observations.get(t);
        if (obs?.confirmedInfected) return false; // Don't quarantine allies
        return playerLikelyHasCard(memory, t, 'flamethrower') ||
               playerLikelyHasCard(memory, t, 'analysis');
      });
      if (dangerousHuman !== undefined) {
        return (w as any).playQuarantine * 1.6; // Neutralize threats
      }
      let score = (w as any).playQuarantine;
      // Bluff: quarantine own ally to deflect suspicion (look human)
      if (vs.myRole === 'thing' && Math.random() < 0.2) {
        score = Math.max(score, (w as any).bluffQuarantineAlly ?? score * 0.5);
      }
      return score;
    }

    case 'locked_door': {
      let score = (w as any).playLockedDoor;
      // Place door between us and suspicious neighbor
      if (vs.myRole === 'human') {
        const susNeighbor = vs.myAdjacentIds.find(id => getSuspicion(memory, id) > suspicionThreshold(vs.aliveCount));
        if (susNeighbor !== undefined) score *= 1.5;
      }
      // Thing: place doors to isolate dangerous humans
      if (vs.myRole === 'thing') {
        score *= 1.2;
      }
      return score;
    }

    case 'axe': {
      let score = (w as any).playAxe;
      // Thing/Infected: massive bonus to remove door blocking infection path
      if (vs.myRole === 'thing' || vs.myRole === 'infected') {
        const blockedHumans = vs.alivePlayers.filter(p => {
          if (p.id === vs.myId) return false;
          const obs = memory.observations.get(p.id);
          if (obs?.confirmedInfected) return false; // already infected
          // Is there a door blocking us from this human?
          return vs.doors.some(d =>
            (d.between[0] === vs.me.position && d.between[1] === p.position) ||
            (d.between[0] === p.position && d.between[1] === vs.me.position)
          );
        });
        if (blockedHumans.length > 0) {
          score *= (vs.aliveCount <= 4 ? 4 : 2.5); // Critical in endgame
        }
        // Infected: bonus to remove quarantine from confirmed ally
        const blockedAlly = vs.alivePlayers.find(p => {
          const obs = memory.observations.get(p.id);
          return obs?.confirmedInfected && p.inQuarantine;
        });
        if (blockedAlly) score *= 2;
      }
      // Human: bonus to remove door blocking suspected player for better info
      if (vs.myRole === 'human' && vs.aliveCount <= 4) {
        score += 1;
      }
      return score;
    }

    case 'swap_places': {
      let score = (w as any).playSwapPlaces;
      // Thing: high priority if door blocks path to last human
      if (vs.myRole === 'thing') {
        const uninfectedHumans = vs.alivePlayers.filter(p => {
          if (p.id === vs.myId) return false;
          const obs = memory.observations.get(p.id);
          return !obs?.confirmedInfected;
        });
        const doorBlocked = uninfectedHumans.some(p =>
          vs.doors.some(d =>
            (d.between[0] === vs.me.position && d.between[1] === p.position) ||
            (d.between[0] === p.position && d.between[1] === vs.me.position)
          )
        );
        if (doorBlocked && vs.aliveCount <= 4) score *= 3; // Escape blockade!
        else score *= 1.3;
      }
      // Infected: swap to get adjacent to last human in endgame
      if (vs.myRole === 'infected' && vs.aliveCount <= 3) {
        const confirmedThingId = vs.alivePlayers.find(p => {
          const obs = memory.observations.get(p.id);
          return obs?.confirmedInfected && p.id !== vs.myId;
        })?.id;
        // If I'm next to Thing, swap to get next to the human instead
        if (confirmedThingId && vs.myAdjacentIds.includes(confirmedThingId)) {
          score *= 2;
        }
      }
      // Human: move away from suspicious/confirmed enemies
      if (vs.myRole === 'human') {
        const dangerousNeighbor = vs.myAdjacentIds.find(id => getSuspicion(memory, id) > suspicionThreshold(vs.aliveCount));
        if (dangerousNeighbor !== undefined) score *= 1.5;
        // If adjacent to confirmed enemy, strongly prefer swapping away to avoid forced trade
        const confirmedEnemyAdjacent = vs.myAdjacentIds.find(id => memory.observations.get(id)?.confirmedInfected);
        if (confirmedEnemyAdjacent !== undefined) score *= 2.5;
      }
      score += getBestPostMovePlanValue(
        vs,
        memory,
        targets,
        stage,
        cardUid,
        0.8,
        1.2,
        0.35,
      );
      return Math.max(0.1, score);
    }

    case 'you_better_run': {
      let score = (w as any).playYouBetterRun;
      // Human: push confirmed enemy away to avoid trade / buy time to find flamethrower
      if (vs.myRole === 'human') {
        const confirmedEnemyTarget = targets.find(id => memory.observations.get(id)?.confirmedInfected);
        if (confirmedEnemyTarget !== undefined) score *= 2.5;
      }
      if (vs.myRole === 'thing') {
        // High value if door-blocked from humans
        const blocked = vs.alivePlayers.filter(p => {
          if (p.id === vs.myId) return false;
          const obs = memory.observations.get(p.id);
          return !obs?.confirmedInfected && vs.doors.some(d =>
            (d.between[0] === vs.me.position && d.between[1] === p.position) ||
            (d.between[0] === p.position && d.between[1] === vs.me.position)
          );
        });
        if (blocked.length > 0) score *= 2.5;
        else score *= 1.3;
      }
      score += getBestPostMovePlanValue(
        vs,
        memory,
        targets,
        stage,
        cardUid,
        0.7,
        1.05,
        0.3,
      );
      return Math.max(0.1, score);
    }

    case 'watch_your_back': {
      let score = (w as any).playWatchYourBack;
      score += getReversePlanValue(
        vs,
        memory,
        stage,
        cardUid,
        vs.myRole === 'human' ? 1.05 : 0.8,
        1.4,
        0.3,
      );
      return Math.max(0.1, score);
    }

    case 'whisky': {
      if (vs.myRole === 'human' && vs.myInfectedCount === 0) {
        return (w as any).playWhisky + (isLate ? 3 : 1); // Proves innocence
      }
      return 0.1; // Thing/Infected: never reveal
    }

    case 'persistence': {
      let score = (w as any).playPersistence;
      // Thing/Infected: use persistence to dig for axe/swap when door-blocked
      if (vs.myRole === 'thing' || vs.myRole === 'infected') {
        const doorBlocked = vs.aliveCount <= 5 && vs.doors.some(d =>
          d.between[0] === vs.me.position || d.between[1] === vs.me.position
        );
        if (doorBlocked) score *= 2.5; // Dig for axe/swap!
      }
      return score;
    }

    case 'temptation': {
      if (vs.myRole === 'thing') {
        return (w as any).playTemptation * 1.5;
      }
      return (w as any).playTemptation;
    }

    case 'lovecraft':
      return (w as any).playLovecraft * infoCardMultiplier(vs.players.length);

    case 'necronomicon': {
      const hasConfirmed = targets.some(t => memory.observations.get(t)?.confirmedInfected);
      if (hasConfirmed) return (w as any).playNecronomicon + 3;
      return (w as any).playNecronomicon * (isLate ? 1.3 : 0.3);
    }

    default:
      return 1;
  }
}

// ── Target picking ──────────────────────────────────────────────────────────

function scoreTarget(
  vs: BotVisibleState,
  memory: BotMemory,
  targetId: number,
  cardDefId: string,
  w: Weights,
  stage: GameStage,
  cardUid?: string,
): number {
  let score = 5;
  const susp = getSuspicion(memory, targetId);
  const targetInfo = vs.alivePlayers.find(p => p.id === targetId);
  const targetObs = memory.observations.get(targetId);

  // Intent target bonus: if bot planned to target this player, boost
  if (memory.intent?.targetPlayerId === targetId && memory.intent?.playCardDefId === cardDefId) {
    score += 3;
  }

  // Axe: Thing/Infected — prioritise the target ACROSS THE DOOR blocking infection
  if (cardDefId === 'axe' && (vs.myRole === 'thing' || vs.myRole === 'infected')) {
    const doorBetween = vs.doors.some(d =>
      (d.between[0] === vs.me.position && d.between[1] === targetInfo?.position) ||
      (d.between[0] === targetInfo?.position && d.between[1] === vs.me.position)
    );
    if (doorBetween && !targetObs?.confirmedInfected) score += 15; // Remove door to human!
    if (doorBetween && targetObs?.confirmedInfected && targetInfo?.inQuarantine) score += 10; // Free ally
    if (!doorBetween && !targetInfo?.inQuarantine) score -= 4; // No reason to axe here
  }

  // Axe: Human — remove quarantine from self or door blocking suspected player
  if (cardDefId === 'axe' && vs.myRole === 'human') {
    if (targetId === vs.myId) score += (vs.me.inQuarantine ? 8 : -3);
    if (susp > suspicionThreshold(vs.aliveCount)) score += 2; // Remove their door to verify
  }

  // ── Card-style profiling adjustments ──────────────────────────────────
  // Flamethrower: penalise target if we saw no_barbecue in their hand
  if (cardDefId === 'flamethrower' && playerLikelyHasDefenseAgainst(memory, targetId, 'flamethrower')) {
    score -= 8; // Likely wasted — they'll block it
  }
  // Analysis: penalise if they have anti_analysis
  if (cardDefId === 'analysis' && playerLikelyHasDefenseAgainst(memory, targetId, 'analysis')) {
    score -= 6;
  }
  // Swap: penalise if they have im_fine_here
  if (['swap_places', 'you_better_run'].includes(cardDefId) && playerLikelyHasDefenseAgainst(memory, targetId, cardDefId)) {
    score -= 5;
  }

  // Thing/Infected: avoid players with flamethrower in hand (they're dangerous)
  if ((vs.myRole === 'thing' || vs.myRole === 'infected') && playerLikelyHasCard(memory, targetId, 'flamethrower')) {
    if (cardDefId === 'swap_places' || cardDefId === 'you_better_run') {
      score -= 4; // Don't swap next to someone with flamethrower
    }
  }

  // Human: prioritise attacking players who hold threatening cards
  if (vs.myRole === 'human' && cardDefId === 'flamethrower') {
    const threat = playerThreatFromHand(memory, targetId);
    if (threat >= 3 && susp > 0.15) score += 3; // Dangerous suspected enemy
    // Strongly reward burning highly suspicious players in late game
    const flameTargetObs = memory.observations.get(targetId);
    if (susp > 0.5 && !flameTargetObs?.confirmedClean) score += 4;
  }

  // swap_places / you_better_run: Thing — swap toward uninfected human
  if (['swap_places', 'you_better_run'].includes(cardDefId) && vs.myRole === 'thing') {
    if (!targetObs?.confirmedInfected) score += 8; // Swap toward human!
    else score -= 4; // Don't swap with infected ally
  }

  // swap_places: Infected endgame — swap with human (then use flamethrower)
  if (cardDefId === 'swap_places' && vs.myRole === 'infected' && vs.aliveCount <= 3) {
    if (!targetObs?.confirmedInfected) score += 12;
  }

  if (['swap_places', 'you_better_run'].includes(cardDefId)) {
    score += getPostMoveTradePartnerDelta(vs, memory, targetId) * (vs.myRole === 'human' ? 2.2 : 1.5);
    score += getPostMoveTradeFollowUpDelta(vs, memory, targetId, stage, cardUid) * (vs.myRole === 'human' ? 1.8 : 1.3);
  }

  const obs = memory.observations.get(targetId);

  if (vs.myRole === 'human') {
    if (obs?.confirmedInfected) score += 10;
    else if (susp > suspicionThreshold(vs.aliveCount)) score += susp * (w as any).targetSuspiciousMult;
    else if (susp < SUSPICION_THRESHOLD_TRUSTED) score -= 3;

    // Info cards: prefer unknown targets
    if (['analysis', 'suspicion', 'lovecraft'].includes(cardDefId)) {
      if (!obs?.confirmedClean && !obs?.confirmedInfected) score += 4;
      // Prefer targets with high suspicion for analysis — scale with suspicion level
      if (cardDefId === 'analysis' && susp > 0.15) score += 3;
      if (cardDefId === 'analysis' && susp > 0.35) score += 4; // Very suspicious → investigate hard
      if (cardDefId === 'analysis' && susp > 0.5) score += 3; // Even more suspicious → highest priority
    }

    // Quarantine: prefer suspicious, never self unless desperate
    if (cardDefId === 'quarantine' && targetId !== vs.myId) {
      score += susp * 3;
    }
    if (cardDefId === 'quarantine' && targetId === vs.myId) {
      score -= 5;
    }

    // Alliance detection: if two players seem allied and one is infected, target the other
    if (obs?.confirmedInfected) {
      // Also boost suspicion of their allies
      for (const p of vs.alivePlayers) {
        if (p.id !== targetId && p.id !== vs.myId) {
          const alliance = getAllianceScore(memory, targetId, p.id);
          if (alliance > 0.4) score += 1;
        }
      }
    }
  } else if (vs.myRole === 'thing') {
    // Thing: target humans, avoid infected allies
    if (obs?.confirmedInfected) {
      score -= 5;
    } else {
      score += (w as any).targetHumanMult;
    }

    // Temptation: prefer targets who are less likely to defend
    if (cardDefId === 'temptation') {
      const tp = vs.players.find(p => p.id === targetId);
      if (tp && !tp.inQuarantine) score += 2;
      // Prefer targets with fewer cards (less likely to have defense)
      if (tp && tp.handCount <= 3) score += 1;
    }

    // Flamethrower/necronomicon: consider bluffing by targeting exposed infected
    if (['flamethrower', 'necronomicon'].includes(cardDefId) && obs?.confirmedInfected && susp > 0.5) {
      score += 3; // Expendable ally sacrifice for camouflage
    }
  } else {
    // Infected: avoid targeting Thing, target humans
    if (obs?.confirmedInfected) score -= 3;
    else score += (w as any).targetHumanMult * 0.8;

    // Redirect suspicion: target players already under suspicion to "pile on"
    if (susp > suspicionThreshold(vs.aliveCount) && vs.myRole === 'infected') {
      score += (w as any).redirectSuspicionBonus ?? 2;
    }
  }

  // Adjacency bonus
  if (vs.myAdjacentIds.includes(targetId)) {
    score += (w as any).targetAdjacentBonus ?? 1;
  }

  return Math.max(0.1, score);
}

function scoreSuspicionPreview(
  vs: BotVisibleState,
  memory: BotMemory,
  targetId: number,
  cardUid: string,
  _stage: GameStage,
): number {
  const obs = memory.observations.get(targetId);
  const susp = getSuspicion(memory, targetId);
  const seenEntry = obs?.seenCards
    .filter(entry => entry.uid === cardUid)
    .sort((a, b) => b.turn - a.turn)[0];

  let score = 5;

  if (!seenEntry) {
    score += 6;
  } else {
    score -= 2;

    if (['flamethrower', 'analysis', 'axe', 'no_barbecue', 'anti_analysis'].includes(seenEntry.defId)) {
      score += 1;
    }

    if (['infected', 'the_thing'].includes(seenEntry.defId)) {
      score -= 2.5;
    }
  }

  if (obs && !obs.confirmedClean && !obs.confirmedInfected) {
    score += 2;
  }

  if (obs?.lastHandChangeTurn !== null && obs?.lastHandChangeTurn !== undefined) {
    score += 1.5;
  }

  if (vs.myRole === 'human') {
    score += susp * 4;
    if (obs?.confirmedInfected) score -= 4;
  } else {
    score += Math.max(0, 0.15 - susp) * 2;
    if (obs?.confirmedInfected) score += 1;
  }

  return Math.max(0.1, score);
}

function scorePanicTarget(
  vs: BotVisibleState,
  memory: BotMemory,
  targetId: number,
  panicDefId: string,
  w: Weights,
  stage: GameStage,
): number {
  const susp = getSuspicion(memory, targetId);
  const obs = memory.observations.get(targetId);
  const targetInfo = vs.players.find(player => player.id === targetId);

  switch (panicDefId) {
    case 'cant_be_friends':
      return scoreTarget(vs, memory, targetId, 'temptation', w, stage) + 1.5;
    case 'get_out_of_here':
      return scoreTarget(vs, memory, targetId, 'swap_places', w, stage) + 1;
    case 'panic_one_two':
      return scoreTarget(vs, memory, targetId, 'swap_places', w, stage);
    case 'panic_between_us': {
      let score = 5;

      if (vs.myRole === 'human') {
        if (vs.myInfectedCount === 0) {
          if (obs?.confirmedInfected) score -= 8;
          else if (susp < SUSPICION_THRESHOLD_TRUSTED) score += 6;
          else if (susp > suspicionThreshold(vs.aliveCount)) score -= 4;
        } else {
          if (susp > suspicionThreshold(vs.aliveCount)) score += 4;
          else score -= 2;
        }
      } else if (vs.myRole === 'thing') {
        if (obs?.confirmedInfected) score += 8;
        else if (susp > suspicionThreshold(vs.aliveCount)) score += 2;
      } else {
        if (targetInfo?.canReceiveInfectedCardFromMe) score += 8;
        else if (obs?.confirmedInfected) score += 6;
        else if (susp < SUSPICION_THRESHOLD_TRUSTED) score -= 1.5;
      }

      if (vs.myAdjacentIds.includes(targetId)) score += 1;

      return Math.max(0.1, score);
    }
    default: {
      let score = 5;
      if (vs.myRole === 'human') score += susp * 2;
      if (vs.myRole === 'thing') score -= susp;
      return Math.max(0.1, score);
    }
  }
}

function scoreAxeChoice(
  vs: BotVisibleState,
  memory: BotMemory,
  targetId: number,
  choice: 'quarantine' | 'door',
): number {
  const targetInfo = vs.players.find(player => player.id === targetId);
  const targetObs = memory.observations.get(targetId);
  const doorBetween = Boolean(
    targetInfo && vs.doors.some(door =>
      (door.between[0] === vs.me.position && door.between[1] === targetInfo.position) ||
      (door.between[0] === targetInfo.position && door.between[1] === vs.me.position)
    )
  );
  const susp = getSuspicion(memory, targetId);

  let score = 5;

  if (choice === 'quarantine') {
    if (targetId === vs.myId) {
      score += vs.me.inQuarantine ? 12 : -6;
    }

    if (targetInfo?.inQuarantine) {
      if (vs.myRole === 'human') {
        if (targetId !== vs.myId && (targetObs?.confirmedInfected || susp > suspicionThreshold(vs.aliveCount))) {
          score -= 10;
        } else {
          score += 5;
        }
      } else if (targetObs?.confirmedInfected) {
        score += 12;
      } else {
        score -= 4;
      }
    } else {
      score -= 6;
    }
  } else {
    if (!doorBetween) score -= 8;

    if (doorBetween) {
      if (vs.myRole === 'human') {
        if (targetObs?.confirmedInfected || susp > suspicionThreshold(vs.aliveCount)) {
          score += 6;
        } else {
          score += 2;
        }
      } else if (!targetObs?.confirmedInfected) {
        score += 10;
      } else {
        score -= 1;
      }
    }
  }

  return Math.max(0.1, score);
}

function chooseRevelationsAction(vs: BotVisibleState): GameAction {
  if (vs.myRole === 'human') {
    if (vs.myInfectedCount === 0) {
      return { type: 'REVELATIONS_RESPOND', show: true, mode: 'all' };
    }

    return { type: 'REVELATIONS_RESPOND', show: true, mode: 'infected_only' };
  }

  return { type: 'REVELATIONS_RESPOND', show: false };
}

// ── Trade phase ─────────────────────────────────────────────────────────────

function evaluateTradePhase(vs: BotVisibleState, memory: BotMemory, _w: Weights, actions: ScoredAction[], stage: GameStage): void {
  const tradeCards = getTradeableCardsForTarget(vs, vs.tradePartnerId);
  if (tradeCards.length === 0) return;

  for (const card of tradeCards) {
    const score = scoreTradeCardForPartner(vs, memory, card, vs.tradePartnerId, stage);

    actions.push({
      action: { type: 'OFFER_TRADE', cardUid: card.uid },
      score: Math.max(0.1, score),
      reason: `Trade away ${card.defId}`,
    });
  }
}

// ── Pending action handling ─────────────────────────────────────────────────

function evaluatePendingActions(vs: BotVisibleState, memory: BotMemory, pa: PendingAction, w: Weights, stage: GameStage): ScoredAction[] {
  const actions: ScoredAction[] = [];

  switch (pa.type) {
    case 'choose_target': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const t of pa.targets) {
        const score = scoreTarget(vs, memory, t, pa.cardDefId, w, stage, pa.cardUid);
        actions.push({
          action: { type: 'SELECT_TARGET', targetPlayerId: t },
          score: score + (Math.random() - 0.5) * NOISE_AMPLITUDE,
          reason: `Target ${t} for ${pa.cardDefId}`,
        });
      }
      break;
    }

    case 'panic_choose_target': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const t of pa.targets) {
        const score = scorePanicTarget(vs, memory, t, pa.panicDefId, w, stage);
        actions.push({
          action: { type: 'PANIC_SELECT_TARGET', targetPlayerId: t },
          score,
          reason: `Panic target ${t} for ${pa.panicDefId}`,
        });
      }
      break;
    }

    case 'trade_defense': {
      if (pa.defenderId !== vs.myId) break;

      // Defense cards
      for (const dc of vs.defenseCards) {
        const score = scoreDefenseCard(vs, memory, dc.defId, pa.reason, w, pa.fromId, stage);
        actions.push({
          action: { type: 'PLAY_DEFENSE', cardUid: dc.uid },
          score,
          reason: `Defend with ${dc.defId} vs ${pa.reason}`,
        });
      }

      // Accept options
      if (['trade', 'temptation', 'panic_trade'].includes(pa.reason)) {
        const incomingTradeRisk = getIncomingTradeRisk(vs, memory, pa.fromId, stage);
        for (const card of getTradeableCardsForTarget(vs, pa.fromId)) {
          const dv = dynamicCardValue(card.defId, stage, vs.players.length);
          let score = 10 - dv;

          if (vs.myRole === 'thing' && card.defId === 'infected') {
            if (memory.globalTurnCount >= THING_AGGRESSIVE_TURNS) score = 18;
            else score = 14;
          }

          // Human: be wary of accepting trades from suspicious players
          if (vs.myRole === 'human') {
            const fromSusp = getSuspicion(memory, pa.fromId);
            if (fromSusp > suspicionThreshold(vs.aliveCount)) {
              // Accepting trade from suspect risks infection — prefer defense
              score *= 0.5;
            }
          }

          score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
          score -= incomingTradeRisk;

          const actionType = pa.reason === 'trade' ? 'RESPOND_TRADE'
            : pa.reason === 'temptation' ? 'TEMPTATION_RESPOND'
            : 'PANIC_TRADE_RESPOND';

          actions.push({
            action: { type: actionType, cardUid: card.uid } as GameAction,
            score: Math.max(0.1, score),
            reason: `Accept ${pa.reason} with ${card.defId}`,
          });
        }
      }

      if (['flamethrower', 'analysis', 'swap'].includes(pa.reason)) {
        let declineScore = 3;
        if (pa.reason === 'flamethrower') declineScore = 0.01;
        if (pa.reason === 'analysis' && vs.myRole === 'human' && vs.myInfectedCount === 0) declineScore = 9;
        if (pa.reason === 'swap') declineScore = 4;

        actions.push({
          action: { type: 'DECLINE_DEFENSE' },
          score: declineScore,
          reason: `Decline defense vs ${pa.reason}`,
        });
      }
      break;
    }

    case 'suspicion_pick': {
      if (pa.viewerPlayerId !== vs.myId) break;
      if (!pa.previewCardUid) {
        for (const uid of pa.selectableCardUids) {
          actions.push({
            action: { type: 'SUSPICION_PREVIEW_CARD', cardUid: uid },
            score: scoreSuspicionPreview(vs, memory, pa.targetPlayerId, uid, stage),
            reason: `Preview suspicion card ${uid}`,
          });
        }
      } else {
        actions.push({
          action: { type: 'SUSPICION_CONFIRM_CARD', cardUid: pa.previewCardUid },
          score: 10,
          reason: 'Confirm suspicion',
        });
      }
      break;
    }

    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal': {
      if (pa.viewerPlayerId !== vs.myId) break;
      actions.push({ action: { type: 'CONFIRM_VIEW' }, score: 10, reason: 'Confirm view' });
      break;
    }

    case 'show_hand_confirm': {
      if (pa.playerId !== vs.myId) break;
      actions.push({ action: { type: 'CONFIRM_VIEW' }, score: 10, reason: 'Confirm show' });
      break;
    }

    case 'persistence_pick': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const card of pa.drawnCards) {
        let score = dynamicCardValue(card.defId, stage, vs.players.length);
        if (vs.myRole === 'human') {
          if (card.defId === 'flamethrower') score += 6;
          if (card.defId === 'analysis') score += 5;
          if (card.defId === 'no_barbecue') score += 4;
        }
        if (vs.myRole === 'thing' || vs.myRole === 'infected') {
          if (card.defId === 'anti_analysis') score += 5;
          if (card.defId === 'no_barbecue') score += 4;
          if (card.defId === 'temptation') score += 3;
        }
        score = applyInfectionOverloadKeepPenalty(vs, card.defId, score);
        const discardUids = pa.drawnCards.filter(c => c.uid !== card.uid).map(c => c.uid);
        actions.push({
          action: { type: 'PERSISTENCE_PICK', keepUid: card.uid, discardUids },
          score,
          reason: `Keep ${card.defId}`,
        });
      }
      break;
    }

    case 'party_pass': {
      if (!pa.pendingPlayerIds.includes(vs.myId)) break;
      const passTargetId = getDirectionalTradeTargetId(vs, vs.myId, pa.direction);
      for (const card of getTradeableCardsForTarget(vs, passTargetId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'PARTY_PASS_CARD', playerId: vs.myId, cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Pass ${card.defId}`,
        });
      }
      break;
    }

    case 'blind_date_swap': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const card of vs.discardableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (card.defId === 'infected' && vs.myRole === 'human') score = 13;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'BLIND_DATE_PICK', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Swap out ${card.defId}`,
        });
      }
      break;
    }

    case 'forgetful_discard': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const card of vs.discardableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (card.defId === 'infected' && vs.myRole === 'human') score = 13;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'FORGETFUL_DISCARD_PICK', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Forgetful discard ${card.defId}`,
        });
      }
      break;
    }

    case 'panic_trade': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const card of getTradeableCardsForTarget(vs, pa.targetPlayerId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'PANIC_TRADE_SELECT', targetPlayerId: pa.targetPlayerId, cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Panic trade ${card.defId}`,
        });
      }
      break;
    }

    case 'axe_choice': {
      if (vs.currentPlayerId !== vs.myId) break;
      if (pa.canRemoveQuarantine) {
        actions.push({
          action: { type: 'AXE_CHOOSE_EFFECT', targetPlayerId: pa.targetPlayerId, choice: 'quarantine' },
          score: scoreAxeChoice(vs, memory, pa.targetPlayerId, 'quarantine'),
          reason: 'Remove quarantine',
        });
      }
      if (pa.canRemoveDoor) {
        actions.push({
          action: { type: 'AXE_CHOOSE_EFFECT', targetPlayerId: pa.targetPlayerId, choice: 'door' },
          score: scoreAxeChoice(vs, memory, pa.targetPlayerId, 'door'),
          reason: 'Remove door',
        });
      }
      break;
    }

    case 'revelations_round': {
      const currentRevealer = pa.revealOrder[pa.currentRevealerIdx];
      if (currentRevealer !== vs.myId) break;
      const action = chooseRevelationsAction(vs);
      actions.push({
        action,
        score: 10,
        reason:
          action.type === 'REVELATIONS_RESPOND' && action.show
            ? action.mode === 'infected_only'
              ? 'Reveal only infection'
              : 'Show clean hand'
            : 'Hide hand',
      });
      break;
    }

    case 'just_between_us_pick': {
      if (pa.playerA !== vs.myId && pa.playerB !== vs.myId) break;
      if (pa.playerA === vs.myId && pa.cardUidA !== null) break;
      if (pa.playerB === vs.myId && pa.cardUidB !== null) break;
      const partnerId = pa.playerA === vs.myId ? pa.playerB : pa.playerA;
      for (const card of getTradeableCardsForTarget(vs, partnerId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'JUST_BETWEEN_US_PICK', playerId: vs.myId, cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `JBU give ${card.defId}`,
        });
      }
      break;
    }

    case 'choose_card_to_discard': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const card of vs.discardableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (card.defId === 'infected' && vs.myRole === 'human') score = 13;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'DISCARD_CARD', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Discard ${card.defId}`,
        });
      }
      break;
    }

    case 'choose_card_to_give': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const card of getTradeableCardsForTarget(vs, pa.targetPlayerId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') {
          if (memory.globalTurnCount >= THING_AGGRESSIVE_TURNS) score = 18;
          else score = 13;
        }
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'TEMPTATION_SELECT', targetPlayerId: pa.targetPlayerId, cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Tempt with ${card.defId}`,
        });
      }
      break;
    }

    // ── Temptation target selection (bot played temptation, now picks target) ──
    case 'temptation_target': {
      if (vs.currentPlayerId !== vs.myId) break;
      for (const t of pa.targets) {
        const score = scoreTarget(vs, memory, t, 'temptation', w, stage);
        actions.push({
          action: { type: 'TEMPTATION_SELECT', targetPlayerId: t, cardUid: pa.cardUid },
          score: score + (Math.random() - 0.5) * NOISE_AMPLITUDE,
          reason: `Temptation target ${t}`,
        });
      }
      break;
    }

    // ── Just Between Us (panic): pick 2 adjacent players to swap cards ──
    case 'just_between_us': {
      if (vs.currentPlayerId !== vs.myId) break;
      const targets = pa.targets;
      // Pick 2 players — prefer suspicious ones
      if (targets.length >= 2) {
        const scored = targets.map(t => ({ id: t, s: scoreTarget(vs, memory, t, 'analysis', w, stage) }))
          .sort((a, b) => b.s - a.s);
        const p1 = scored[0].id;
        const p2 = scored[1].id;
        actions.push({
          action: { type: 'JUST_BETWEEN_US_SELECT', player1: p1, player2: p2 },
          score: 10,
          reason: `JBU select ${p1} and ${p2}`,
        });
      } else if (targets.length === 1) {
        // Only one target — must include self
        actions.push({
          action: { type: 'JUST_BETWEEN_US_SELECT', player1: vs.myId, player2: targets[0] },
          score: 10,
          reason: `JBU select self and ${targets[0]}`,
        });
      }
      break;
    }

    case 'temptation_response': {
      if (pa.toId !== vs.myId) break;
      for (const card of getTradeableCardsForTarget(vs, pa.fromId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'TEMPTATION_RESPOND', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Temptation respond ${card.defId}`,
        });
      }
      break;
    }

    case 'panic_trade_response': {
      if (pa.toId !== vs.myId) break;
      for (const card of getTradeableCardsForTarget(vs, pa.fromId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'PANIC_TRADE_RESPOND', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Panic respond ${card.defId}`,
        });
      }
      break;
    }

    case 'trade_offer': {
      if (pa.toId !== vs.myId) break;
      for (const card of getTradeableCardsForTarget(vs, pa.fromId)) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
        score = applyInfectionOverloadSheddingBias(vs, card.defId, score);
        actions.push({
          action: { type: 'OFFER_TRADE', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Offer ${card.defId}`,
        });
      }
      break;
    }
  }

  applyStrategicBias(actions, vs, memory, stage);
  for (const a of actions) {
    a.score += (Math.random() - 0.5) * NOISE_AMPLITUDE * 0.5;
  }
  return actions.sort((a, b) => b.score - a.score);
}

// ── Defense scoring ─────────────────────────────────────────────────────────

function scoreDefenseCard(vs: BotVisibleState, memory: BotMemory, defenseDefId: string, _reason: string, w: Weights, fromId: number, _stage: GameStage): number {
  const fromSusp = getSuspicion(memory, fromId);

  switch (defenseDefId) {
    case 'no_barbecue':
      return (w as any).defendNoBarbecue; // Always defend

    case 'anti_analysis': {
      if (vs.myRole === 'thing' || vs.myRole === 'infected') {
        return (w as any).defendAntiAnalysis; // Must hide infection
      }
      if (vs.myInfectedCount === 0) return 0.5; // Nothing to hide
      return (w as any).defendAntiAnalysis;
    }

    case 'im_fine_here': {
      let score = (w as any).defendImFineHere;
      // If the person swapping us is suspicious, defend more eagerly
      if (vs.myRole === 'human' && fromSusp > 0.2) score *= 1.3;
      return score;
    }

    case 'fear': {
      let score = (w as any).defendFear;
      // Human: more valuable when trade partner is suspicious (see their card + block trade)
      if (vs.myRole === 'human' && fromSusp > suspicionThreshold(vs.aliveCount)) score *= 1.5;
      // Thing: less valuable (we want to accept trades to infect)
      if (vs.myRole === 'thing') score *= 0.5;
      return score;
    }

    case 'no_thanks': {
      let score = (w as any).defendNoThanks;
      // Human: block trades from suspicious players
      if (vs.myRole === 'human' && fromSusp > suspicionThreshold(vs.aliveCount)) score *= 1.5;
      if (vs.myRole === 'thing') score *= 0.4;
      return score;
    }

    case 'miss': {
      let score = (w as any).defendMiss;
      if (vs.myRole === 'thing') score *= 0.4;
      return score;
    }

    default:
      return 1;
  }
}
