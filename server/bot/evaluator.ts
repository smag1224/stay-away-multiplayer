/**
 * Action Evaluator — scores all legal actions using weighted heuristics.
 * Features: game stages, infection chains, bluffing, positional awareness,
 * coalition detection, direction planning.
 */

import type { GameAction, PendingAction } from '../../src/types.ts';
import { getCardDef } from '../../src/cards.ts';
import type { BotVisibleState } from './visibleState.ts';
import type { BotMemory } from './memory.ts';
import { getSuspicion, getGameProgress, getAllianceScore } from './memory.ts';
import {
  HUMAN_WEIGHTS,
  THING_WEIGHTS,
  INFECTED_WEIGHTS,
  NOISE_AMPLITUDE,
  BEST_ACTION_PROB,
  CARD_VALUES,
  SUSPICION_THRESHOLD_HIGH,
  SUSPICION_THRESHOLD_TRUSTED,
  STAGE,
  THING_SAFE_TURNS,
  THING_AGGRESSIVE_TURNS,
  STAGE_VALUE_MULTS,
  infoCardMultiplier,
  aggressionMultiplier,
} from './config.ts';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScoredAction {
  action: GameAction;
  score: number;
  reason: string;
}

type Weights = typeof HUMAN_WEIGHTS | typeof THING_WEIGHTS | typeof INFECTED_WEIGHTS;

// ── Game stage ──────────────────────────────────────────────────────────────

type GameStage = 'early' | 'mid' | 'late';

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

/** Check who will be our trade partner based on current direction */
function getNextTradeNeighborSuspicion(vs: BotVisibleState, memory: BotMemory): number {
  if (!vs.tradePartnerId) return 0;
  return getSuspicion(memory, vs.tradePartnerId);
}

// ── Play phase ──────────────────────────────────────────────────────────────

function evaluatePlayPhase(vs: BotVisibleState, memory: BotMemory, w: Weights, actions: ScoredAction[], stage: GameStage): void {
  for (const pc of vs.playableCards) {
    const score = scorePlayCard(vs, memory, pc.defId, pc.targets, w, stage);
    if (score > 0 && pc.targets.length > 0) {
      actions.push({
        action: { type: 'PLAY_CARD', cardUid: pc.card.uid },
        score,
        reason: `Play ${pc.defId}`,
      });
    } else if (score > 0 && pc.targets.length === 0) {
      actions.push({
        action: { type: 'PLAY_CARD', cardUid: pc.card.uid },
        score,
        reason: `Play ${pc.defId}`,
      });
    }
  }

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

    if (def.category === 'defense') score *= 0.35;

    actions.push({
      action: { type: 'DISCARD_CARD', cardUid: dc.uid },
      score: Math.max(0.05, score),
      reason: `Discard ${dc.defId}`,
    });
  }
}

function scorePlayCard(vs: BotVisibleState, memory: BotMemory, defId: string, targets: number[], w: Weights, stage: GameStage): number {
  const isEarly = stage === 'early';
  const isLate = stage === 'late';

  switch (defId) {
    case 'flamethrower': {
      const hasConfirmed = targets.some(t => memory.observations.get(t)?.confirmedInfected);
      const hasStrong = targets.some(t => getSuspicion(memory, t) > SUSPICION_THRESHOLD_HIGH);

      // Infected endgame: burn the last human!
      if (vs.myRole === 'infected' && vs.aliveCount <= 3) {
        const lastHuman = targets.find(t => {
          const obs = memory.observations.get(t);
          return !obs?.confirmedInfected;
        });
        if (lastHuman !== undefined) return 18; // Win condition
      }

      // Thing endgame: if all remaining are infected, use flamethrower on human
      if (vs.myRole === 'thing' && vs.aliveCount <= 3) {
        const lastHuman = targets.find(t => {
          const obs = memory.observations.get(t);
          return !obs?.confirmedInfected;
        });
        if (lastHuman !== undefined) return 16;
      }

      if (hasConfirmed) return (w as any).playFlamethrower + 4;
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
      let score = unknowns.length > 0 ? (w as any).playAnalysis : 1;
      if (suspicious.length > 0 && unknowns.some(t => suspicious.includes(t))) score += 2;

      // Thing bluff: analyze own infected ally to look like proactive human
      if (vs.myRole === 'thing' && isEarly) {
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
        const susTargs = targets.filter(t => t !== vs.myId && getSuspicion(memory, t) > SUSPICION_THRESHOLD_HIGH);
        if (susTargs.length > 0) return (w as any).playQuarantine * 1.8;
        return (w as any).playQuarantine * 0.4;
      }
      // Thing: quarantine dangerous humans who have flamethrower
      let score = (w as any).playQuarantine;
      // Bluff: quarantine own ally to deflect suspicion
      if (vs.myRole === 'thing' && Math.random() < 0.15) {
        score = (w as any).bluffQuarantineAlly ?? score * 0.5;
      }
      return score;
    }

    case 'locked_door': {
      let score = (w as any).playLockedDoor;
      // Place door between us and suspicious neighbor
      if (vs.myRole === 'human') {
        const susNeighbor = vs.myAdjacentIds.find(id => getSuspicion(memory, id) > SUSPICION_THRESHOLD_HIGH);
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
      // Human: move away from suspicious neighbors
      if (vs.myRole === 'human') {
        const dangerousNeighbor = vs.myAdjacentIds.find(id => getSuspicion(memory, id) > SUSPICION_THRESHOLD_HIGH);
        if (dangerousNeighbor !== undefined) score *= 1.5;
      }
      return score;
    }

    case 'you_better_run': {
      let score = (w as any).playYouBetterRun;
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
      return score;
    }

    case 'watch_your_back': {
      let score = (w as any).playWatchYourBack;
      // Check if reversing direction improves our trade partner
      const currentPartnerSusp = getNextTradeNeighborSuspicion(vs, memory);
      // If current partner is suspicious and we're human, maybe reverse is good
      if (vs.myRole === 'human' && currentPartnerSusp > SUSPICION_THRESHOLD_HIGH) score += 2;
      // Thing: reverse if it puts us next to non-infected human for trade
      if (vs.myRole === 'thing') score += 1.5;
      return score;
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
        // Don't use temptation too early (suspicious)
        if (memory.globalTurnCount < THING_SAFE_TURNS) return 1;
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

function scoreTarget(vs: BotVisibleState, memory: BotMemory, targetId: number, cardDefId: string, w: Weights, _stage: GameStage): number {
  let score = 5;
  const susp = getSuspicion(memory, targetId);
  const targetInfo = vs.alivePlayers.find(p => p.id === targetId);
  const targetObs = memory.observations.get(targetId);

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
    if (susp > SUSPICION_THRESHOLD_HIGH) score += 2; // Remove their door to verify
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
  const obs = memory.observations.get(targetId);

  if (vs.myRole === 'human') {
    if (obs?.confirmedInfected) score += 10;
    else if (susp > SUSPICION_THRESHOLD_HIGH) score += susp * (w as any).targetSuspiciousMult;
    else if (susp < SUSPICION_THRESHOLD_TRUSTED) score -= 3;

    // Info cards: prefer unknown targets
    if (['analysis', 'suspicion', 'lovecraft'].includes(cardDefId)) {
      if (!obs?.confirmedClean && !obs?.confirmedInfected) score += 4;
      // Prefer targets with high suspicion for analysis
      if (cardDefId === 'analysis' && susp > 0.15) score += 3;
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
    if (susp > SUSPICION_THRESHOLD_HIGH && vs.myRole === 'infected') {
      score += (w as any).redirectSuspicionBonus ?? 2;
    }
  }

  // Adjacency bonus
  if (vs.myAdjacentIds.includes(targetId)) {
    score += (w as any).targetAdjacentBonus ?? 1;
  }

  return Math.max(0.1, score);
}

// ── Trade phase ─────────────────────────────────────────────────────────────

function evaluateTradePhase(vs: BotVisibleState, memory: BotMemory, _w: Weights, actions: ScoredAction[], stage: GameStage): void {
  if (vs.tradeableCards.length === 0) return;

  const partnerSusp = vs.tradePartnerId ? getSuspicion(memory, vs.tradePartnerId) : 0;

  for (const card of vs.tradeableCards) {
    const def = getCardDef(card.defId);
    const dv = dynamicCardValue(card.defId, stage, vs.players.length);
    let score = 12 - dv;

    // Thing: infect through trade!
    if (vs.myRole === 'thing' && card.defId === 'infected') {
      // Don't infect too early
      if (memory.globalTurnCount < THING_SAFE_TURNS) {
        score = 4; // Hold off
      } else if (memory.globalTurnCount >= THING_AGGRESSIVE_TURNS) {
        score = 15; // Go aggressive
      } else {
        score = 10; // Normal priority
      }
    }

    // Infected trading with Thing
    if (vs.myRole === 'infected' && card.defId === 'infected') {
      score = 3;
    }

    // ── Infected coalition trades ────────────────────────────────────────────
    if (vs.myRole === 'infected' && vs.tradePartnerId !== null) {
      const partnerObs = memory.observations.get(vs.tradePartnerId);
      const partnerIsAlly = partnerObs?.confirmedInfected; // known Thing/Infected

      if (partnerIsAlly) {
        // Pass axe to ally so they can remove doors blocking infection path
        if (card.defId === 'axe') {
          const allyHasDoorProblem = vs.doors.length > 0 && vs.aliveCount <= 5;
          score = allyHasDoorProblem ? 14 : 8;
        }
        // Pass swap_places / you_better_run to ally to help reach humans
        if (['swap_places', 'you_better_run'].includes(card.defId)) {
          score = vs.aliveCount <= 4 ? 12 : 7;
        }
        // Pass no_barbecue to protect Thing from flamethrower
        if (card.defId === 'no_barbecue') {
          score = 13; // Critical coalition support
        }
        // Pass anti_analysis to protect ally
        if (card.defId === 'anti_analysis') {
          score = 10;
        }
        // Pass flamethrower to infected ally who is next to a human
        if (card.defId === 'flamethrower' && vs.aliveCount <= 3) {
          const partnerInfo = vs.alivePlayers.find(p => p.id === vs.tradePartnerId);
          const partnerAdjacentHuman = partnerInfo && vs.alivePlayers.some(p => {
            if (p.id === vs.tradePartnerId || p.id === vs.myId) return false;
            const pObs = memory.observations.get(p.id);
            return !pObs?.confirmedInfected; // human neighbour
          });
          if (partnerAdjacentHuman) score = 15; // Give flamethrower to finish the game!
        }
        // Pass extra infected card back to Thing if they might need it
        // (priority lower than no_barbecue=13, but higher than holding it)
        if (card.defId === 'infected') {
          const myInfectedCards = vs.myHand.filter(c => c.defId === 'infected').length;
          if (myInfectedCards >= 2) {
            // Have a spare — pass one back to Thing so they don't run dry
            score = 9;
          } else {
            // Only one — keep it, might need to trade it to a human
            score = 1;
          }
        }
      }

      // Endgame: infected knows who the last human is — use flamethrower directly
      if (!partnerIsAlly && vs.aliveCount <= 3 && card.defId === 'flamethrower') {
        // Partner is the last human — but we're passing, not playing
        // Score low so we'd rather PLAY it than pass it
        score = 0.5;
      }
    }

    // Human: avoid giving strong cards to suspicious partners
    if (vs.myRole === 'human' && partnerSusp > SUSPICION_THRESHOLD_HIGH) {
      if (['flamethrower', 'analysis', 'no_barbecue'].includes(card.defId)) {
        score *= 0.2; // Don't give weapons to suspects
      }
    }

    // Keep defense cards (but not if ally needs them)
    if (def.category === 'defense') score *= 0.3;

    // Keep strong action cards
    if (['flamethrower', 'analysis', 'persistence'].includes(card.defId)) score *= 0.25;

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
        const score = scoreTarget(vs, memory, t, pa.cardDefId, w, stage);
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
        let score = 5 + (Math.random() - 0.5) * 2;
        if (vs.myRole === 'human') score += getSuspicion(memory, t) * 2;
        if (vs.myRole === 'thing') score -= getSuspicion(memory, t); // Move toward trusted (non-suspected)
        actions.push({
          action: { type: 'PANIC_SELECT_TARGET', targetPlayerId: t },
          score,
          reason: `Panic target ${t}`,
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
        for (const card of vs.tradeableCards) {
          const dv = dynamicCardValue(card.defId, stage, vs.players.length);
          let score = 10 - dv;

          if (vs.myRole === 'thing' && card.defId === 'infected') {
            if (memory.globalTurnCount < THING_SAFE_TURNS) score = 4;
            else score = 14;
          }

          // Human: be wary of accepting trades from suspicious players
          if (vs.myRole === 'human') {
            const fromSusp = getSuspicion(memory, pa.fromId);
            if (fromSusp > SUSPICION_THRESHOLD_HIGH) {
              // Accepting trade from suspect risks infection — prefer defense
              score *= 0.5;
            }
          }

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
            score: 5 + Math.random(),
            reason: `Preview card`,
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
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
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
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
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
          score: 6,
          reason: 'Remove quarantine',
        });
      }
      if (pa.canRemoveDoor) {
        actions.push({
          action: { type: 'AXE_CHOOSE_EFFECT', targetPlayerId: pa.targetPlayerId, choice: 'door' },
          score: 5,
          reason: 'Remove door',
        });
      }
      break;
    }

    case 'revelations_round': {
      const currentRevealer = pa.revealOrder[pa.currentRevealerIdx];
      if (currentRevealer !== vs.myId) break;
      const shouldShow = vs.myRole === 'human' && vs.myInfectedCount === 0;
      actions.push({
        action: { type: 'REVELATIONS_RESPOND', show: shouldShow },
        score: 10,
        reason: shouldShow ? 'Show clean hand' : 'Hide hand',
      });
      break;
    }

    case 'just_between_us_pick': {
      if (pa.playerA !== vs.myId && pa.playerB !== vs.myId) break;
      if (pa.playerA === vs.myId && pa.cardUidA !== null) break;
      if (pa.playerB === vs.myId && pa.cardUidB !== null) break;
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
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
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') {
          score = memory.globalTurnCount < THING_SAFE_TURNS ? 5 : 15;
        }
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
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
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
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
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
      for (const card of vs.tradeableCards) {
        const dv = dynamicCardValue(card.defId, stage, vs.players.length);
        let score = 12 - dv;
        if (vs.myRole === 'thing' && card.defId === 'infected') score = 15;
        actions.push({
          action: { type: 'OFFER_TRADE', cardUid: card.uid },
          score: Math.max(0.1, score),
          reason: `Offer ${card.defId}`,
        });
      }
      break;
    }
  }

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
      if (vs.myRole === 'human' && fromSusp > SUSPICION_THRESHOLD_HIGH) score *= 1.5;
      // Thing: less valuable (we want to accept trades to infect)
      if (vs.myRole === 'thing') score *= 0.5;
      return score;
    }

    case 'no_thanks': {
      let score = (w as any).defendNoThanks;
      // Human: block trades from suspicious players
      if (vs.myRole === 'human' && fromSusp > SUSPICION_THRESHOLD_HIGH) score *= 1.5;
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
