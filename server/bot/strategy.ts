import type { GameAction, PendingAction } from '../../src/types.ts';
import type { ScoredAction } from './evaluator.ts';
import type { BotMemory, PlayerObservation } from './memory.ts';
import { getAllianceScore, getSuspicion } from './memory.ts';
import type { BotVisibleState } from './visibleState.ts';
import { THING_SAFE_TURNS } from './config.ts';

type GameStage = 'early' | 'mid' | 'late';

interface StrategyProfile {
  inspectTargetId: number | null;
  attackTargetId: number | null;
  confirmedAttackTargetId: number | null;
  containTargetId: number | null;
  protectTargetId: number | null;
  infectTargetId: number | null;
  supportThingTargetId: number | null;
  knownThingId: number | null;
  enemyScores: Map<number, number>;
  cleanScores: Map<number, number>;
}

const STRONG_SUPPORT_CARDS = new Set([
  'flamethrower',
  'analysis',
  'no_barbecue',
  'anti_analysis',
  'fear',
  'no_thanks',
  'axe',
  'quarantine',
  'locked_door',
]);

const ATTACK_CARD_IDS = new Set(['flamethrower', 'necronomicon']);
const INSPECT_CARD_IDS = new Set(['analysis', 'suspicion', 'lovecraft']);
const CONTAIN_CARD_IDS = new Set(['quarantine', 'locked_door', 'watch_your_back', 'swap_places', 'you_better_run', 'axe']);

function getObservation(memory: BotMemory, playerId: number): PlayerObservation | null {
  return memory.observations.get(playerId) ?? null;
}

function isConfirmedEnemy(obs: PlayerObservation | null): boolean {
  return Boolean(obs?.knownRole === 'thing' || obs?.knownRole === 'infected' || obs?.confirmedInfected);
}

function isConfirmedClean(obs: PlayerObservation | null): boolean {
  return Boolean(obs?.knownRole === 'human' || obs?.confirmedClean);
}

function threatFromSeenCards(obs: PlayerObservation | null): number {
  if (!obs) return 0;
  return obs.seenCards.reduce((score, card) => {
    switch (card.defId) {
      case 'flamethrower':
      case 'necronomicon':
        return score + 0.35;
      case 'analysis':
      case 'suspicion':
      case 'lovecraft':
        return score + 0.18;
      case 'no_barbecue':
      case 'fear':
      case 'no_thanks':
      case 'anti_analysis':
        return score + 0.12;
      default:
        return score;
    }
  }, 0);
}

function scoreEnemyForHuman(vs: BotVisibleState, memory: BotMemory, playerId: number): number {
  const obs = getObservation(memory, playerId);
  const suspicion = getSuspicion(memory, playerId);
  const attackedMe = obs?.attackedPlayers.filter(id => id === vs.myId).length ?? 0;
  const base =
    (obs?.knownRole === 'thing' ? 1.4 : 0) +
    (obs?.knownRole === 'infected' ? 1.0 : 0) +
    suspicion * 1.5 +
    threatFromSeenCards(obs) +
    attackedMe * 0.2;
  return isConfirmedClean(obs) ? base - 1.1 : base;
}

function scoreCleanForHuman(memory: BotMemory, playerId: number): number {
  const obs = getObservation(memory, playerId);
  const suspicion = getSuspicion(memory, playerId);
  const alliance = getAllianceScore(memory, playerId, memory.botPlayerId);
  return (
    (obs?.confirmedClean ? 1.1 : 0) +
    (obs?.knownRole === 'human' ? 0.7 : 0) +
    Math.max(0, -suspicion) * 1.1 +
    alliance * 0.5
  );
}

function scoreInfectTargetForThing(vs: BotVisibleState, memory: BotMemory, playerId: number): number {
  const obs = getObservation(memory, playerId);
  const suspicion = getSuspicion(memory, playerId);

  // Prefer players who look clean — infecting them causes maximum surprise
  const seenSafeSignals =
    (obs?.confirmedClean ? 0.8 : 0) +
    (obs?.publicReveals.filter(reveal => !reveal.hadInfection).length ?? 0) * 0.2 +
    Math.max(0, -suspicion) * 1.3;

  // Infecting players with strong cards converts threats to allies (intelligent play)
  const strongHandValue = threatFromSeenCards(obs);

  // Penalize already-exposed enemies and quarantined targets
  const exposedPenalty =
    (obs?.knownRole === 'thing' || obs?.knownRole === 'infected' ? 1.5 : 0) +
    (vs.players.find(player => player.id === playerId)?.inQuarantine ? 0.5 : 0);

  // Penalize players with flamethrower (they can burn us right after getting infected) —
  // unless infection gives us their flamethrower which we can use ourselves
  const hasFlamethrower = obs?.seenCards.some(c => c.defId === 'flamethrower') ?? false;
  const flamePenalty = hasFlamethrower ? 0.3 : 0;

  // Bonus for players adjacent to us (easier to target in trade)
  const isAdjacent = vs.myAdjacentIds.includes(playerId) ? 0.4 : 0;

  return seenSafeSignals + strongHandValue - exposedPenalty - flamePenalty + isAdjacent;
}

function scoreHumanThreatForThing(vs: BotVisibleState, memory: BotMemory, playerId: number): number {
  const obs = getObservation(memory, playerId);
  const suspicion = getSuspicion(memory, playerId);
  const attackedMe = obs?.attackedPlayers.filter(id => id === vs.myId).length ?? 0;
  return Math.max(0, threatFromSeenCards(obs) + attackedMe * 0.25 + Math.max(0, suspicion) * 0.5);
}

function buildStrategyProfile(vs: BotVisibleState, memory: BotMemory): StrategyProfile {
  const enemyScores = new Map<number, number>();
  const cleanScores = new Map<number, number>();
  let inspectTargetId: number | null = null;
  let attackTargetId: number | null = null;
  let confirmedAttackTargetId: number | null = null;
  let containTargetId: number | null = null;
  let protectTargetId: number | null = null;
  let infectTargetId: number | null = null;
  let supportThingTargetId: number | null = null;
  let knownThingId: number | null = null;

  let bestEnemy = -Infinity;
  let bestClean = -Infinity;
  let bestAttack = -Infinity;
  let bestContain = -Infinity;
  let bestInfect = -Infinity;
  let bestThingThreat = -Infinity;

  for (const player of vs.alivePlayers) {
    if (player.id === vs.myId) continue;
    const obs = getObservation(memory, player.id);

    if (obs?.knownRole === 'thing' && knownThingId === null) {
      knownThingId = player.id;
    }

    if (vs.myRole === 'human') {
      const enemyScore = scoreEnemyForHuman(vs, memory, player.id);
      const cleanScore = scoreCleanForHuman(memory, player.id);
      enemyScores.set(player.id, enemyScore);
      cleanScores.set(player.id, cleanScore);

      if (!isConfirmedClean(obs) && enemyScore > bestEnemy) {
        bestEnemy = enemyScore;
        inspectTargetId = player.id;
      }

      if ((isConfirmedEnemy(obs) || enemyScore > 0.5) && enemyScore > bestAttack) {
        bestAttack = enemyScore;
        attackTargetId = player.id;
      }

      if (isConfirmedEnemy(obs) && (confirmedAttackTargetId === null || enemyScore > (enemyScores.get(confirmedAttackTargetId) ?? -Infinity))) {
        confirmedAttackTargetId = player.id;
      }

      if (enemyScore > bestContain) {
        bestContain = enemyScore;
        containTargetId = player.id;
      }

      if (cleanScore > bestClean) {
        bestClean = cleanScore;
        protectTargetId = player.id;
      }
      continue;
    }

    if (vs.myRole === 'thing') {
      const infectScore = scoreInfectTargetForThing(vs, memory, player.id);
      const threatScore = scoreHumanThreatForThing(vs, memory, player.id);
      enemyScores.set(player.id, threatScore);
      cleanScores.set(player.id, infectScore);

      if (player.canReceiveInfectedCardFromMe && infectScore > bestInfect) {
        bestInfect = infectScore;
        infectTargetId = player.id;
      }

      if (threatScore > bestThingThreat) {
        bestThingThreat = threatScore;
        attackTargetId = player.id;
        containTargetId = player.id;
        inspectTargetId = player.id;
      }
      continue;
    }

    const enemyScore = scoreEnemyForHuman(vs, memory, player.id);
    enemyScores.set(player.id, enemyScore);
    cleanScores.set(player.id, scoreCleanForHuman(memory, player.id));

    if (obs?.knownRole === 'thing' && enemyScore > bestThingThreat) {
      bestThingThreat = enemyScore;
      supportThingTargetId = player.id;
      knownThingId = player.id;
    }

    if (enemyScore > bestAttack) {
      bestAttack = enemyScore;
      attackTargetId = player.id;
      containTargetId = player.id;
      inspectTargetId = player.id;
    }
  }

  if (vs.myRole === 'infected' && supportThingTargetId === null) {
    supportThingTargetId = knownThingId;
  }

  return {
    inspectTargetId,
    attackTargetId,
    confirmedAttackTargetId,
    containTargetId,
    protectTargetId,
    infectTargetId,
    supportThingTargetId,
    knownThingId,
    enemyScores,
    cleanScores,
  };
}

function getCardDefIdFromAction(vs: BotVisibleState, action: GameAction): string | null {
  if (
    action.type === 'PLAY_CARD' ||
    action.type === 'DISCARD_CARD' ||
    action.type === 'PLAY_DEFENSE' ||
    action.type === 'OFFER_TRADE' ||
    action.type === 'RESPOND_TRADE' ||
    action.type === 'TEMPTATION_RESPOND' ||
    action.type === 'PANIC_TRADE_RESPOND' ||
    action.type === 'BLIND_DATE_PICK' ||
    action.type === 'FORGETFUL_DISCARD_PICK' ||
    action.type === 'PARTY_PASS_CARD' ||
    action.type === 'JUST_BETWEEN_US_PICK'
  ) {
    return vs.myHand.find(card => card.uid === action.cardUid)?.defId ?? null;
  }

  if (action.type === 'TEMPTATION_SELECT' || action.type === 'PANIC_TRADE_SELECT') {
    return vs.myHand.find(card => card.uid === action.cardUid)?.defId ?? null;
  }

  return null;
}

function getActionTargetId(vs: BotVisibleState, action: GameAction, pendingAction: PendingAction | null): number | null {
  switch (action.type) {
    case 'SELECT_TARGET':
    case 'PANIC_SELECT_TARGET':
      return action.targetPlayerId;
    case 'TEMPTATION_SELECT':
    case 'PANIC_TRADE_SELECT':
    case 'AXE_CHOOSE_EFFECT':
      return action.targetPlayerId;
    case 'OFFER_TRADE':
      return vs.tradePartnerId;
    case 'RESPOND_TRADE':
    case 'TEMPTATION_RESPOND':
    case 'PANIC_TRADE_RESPOND':
    case 'PLAY_DEFENSE':
    case 'DECLINE_DEFENSE':
      if (!pendingAction || pendingAction.type !== 'trade_defense') return null;
      return pendingAction.fromId;
    case 'PARTY_PASS_CARD':
      if (!pendingAction || pendingAction.type !== 'party_pass') return null;
      return getDirectionalTradeTargetId(vs, action.playerId, pendingAction.direction);
    case 'JUST_BETWEEN_US_PICK':
      if (!pendingAction || pendingAction.type !== 'just_between_us_pick') return null;
      return pendingAction.playerA === action.playerId ? pendingAction.playerB : pendingAction.playerA;
    default:
      return null;
  }
}

function getDirectionalTradeTargetId(vs: BotVisibleState, playerId: number, direction: 1 | -1): number | null {
  const alivePlayers = [...vs.alivePlayers].sort((left, right) => left.position - right.position);
  if (alivePlayers.length <= 1) return null;

  const currentIndex = alivePlayers.findIndex(player => player.id === playerId);
  if (currentIndex === -1) return null;

  const targetIndex = (currentIndex + direction + alivePlayers.length) % alivePlayers.length;
  return alivePlayers[targetIndex]?.id ?? null;
}

function strategicTargetBonus(
  targetId: number | null,
  strategy: StrategyProfile,
  currentCardDefId: string | null,
  pendingAction: PendingAction | null,
  vs: BotVisibleState,
  memory: BotMemory,
): number {
  if (targetId === null) return 0;

  if (vs.myRole === 'human') {
    if ((currentCardDefId && ATTACK_CARD_IDS.has(currentCardDefId)) || (pendingAction?.type === 'choose_target' && pendingAction.cardDefId && ATTACK_CARD_IDS.has(pendingAction.cardDefId))) {
      if (targetId === strategy.attackTargetId) return 9;
      if (targetId === strategy.protectTargetId) return -8;
    }

    if ((currentCardDefId && INSPECT_CARD_IDS.has(currentCardDefId)) || (pendingAction?.type === 'choose_target' && pendingAction.cardDefId && INSPECT_CARD_IDS.has(pendingAction.cardDefId))) {
      if (targetId === strategy.inspectTargetId) return 8;
      if (targetId === strategy.protectTargetId) return -6;
    }

    if ((currentCardDefId && CONTAIN_CARD_IDS.has(currentCardDefId)) || (pendingAction?.type === 'choose_target' && pendingAction.cardDefId && CONTAIN_CARD_IDS.has(pendingAction.cardDefId))) {
      if (targetId === strategy.containTargetId) return 7;
      if (targetId === strategy.protectTargetId) return -5;
    }
  }

  if (vs.myRole === 'thing') {
    // During safe period, suppress infection target bonuses to respect stealth mode
    const inSafePeriod = memory.globalTurnCount < THING_SAFE_TURNS;
    if (currentCardDefId === 'infected') {
      if (inSafePeriod) return -8; // Actively discourage infection during safe period
      if (targetId === strategy.infectTargetId) return 16;
      return 10;
    }
    if (targetId === strategy.attackTargetId) return 6;
  }

  if (vs.myRole === 'infected') {
    if (targetId === strategy.attackTargetId) return 6;
    if (targetId === strategy.supportThingTargetId && currentCardDefId && STRONG_SUPPORT_CARDS.has(currentCardDefId)) return 5;
  }

  return 0;
}

function strategicCardBonus(
  vs: BotVisibleState,
  strategy: StrategyProfile,
  action: GameAction,
  defId: string | null,
  targetId: number | null,
  stage: GameStage,
  memory: BotMemory,
): number {
  if (!defId) return 0;

  if (vs.myRole === 'human') {
    const attackThreat = strategy.attackTargetId === null
      ? 0
      : (strategy.enemyScores.get(strategy.attackTargetId) ?? 0);
    const urgentAttackReady =
      strategy.confirmedAttackTargetId !== null &&
      vs.myHand.some(card => ATTACK_CARD_IDS.has(card.defId));

    if (action.type === 'PLAY_CARD') {
      if (ATTACK_CARD_IDS.has(defId) && strategy.attackTargetId !== null) {
        return attackThreat >= 1 ? 18 : 8;
      }
      if (
        urgentAttackReady &&
        ['watch_your_back', 'swap_places', 'you_better_run'].includes(defId)
      ) {
        return -10;
      }
      if (INSPECT_CARD_IDS.has(defId) && strategy.inspectTargetId !== null) return 6;
      if (CONTAIN_CARD_IDS.has(defId) && strategy.containTargetId !== null) return 5;
    }

    if (action.type === 'DISCARD_CARD' || action.type === 'FORGETFUL_DISCARD_PICK' || action.type === 'BLIND_DATE_PICK') {
      if (defId === 'infected') return 24;
      if (ATTACK_CARD_IDS.has(defId) && strategy.attackTargetId !== null) return -11;
      if (INSPECT_CARD_IDS.has(defId) && strategy.inspectTargetId !== null) return -9;
      if ((defId === 'no_barbecue' || defId === 'fear' || defId === 'anti_analysis') && strategy.protectTargetId !== null) return -6;
    }

    if ((action.type === 'RESPOND_TRADE' || action.type === 'TEMPTATION_RESPOND' || action.type === 'PANIC_TRADE_RESPOND') && targetId !== null) {
      const threat = strategy.enemyScores.get(targetId) ?? 0;
      if (threat > 0.6 && STRONG_SUPPORT_CARDS.has(defId)) return -12;
      if (threat > 0.6 && !STRONG_SUPPORT_CARDS.has(defId)) return 3;
    }

    if ((action.type === 'PLAY_DEFENSE' || action.type === 'DECLINE_DEFENSE') && targetId !== null) {
      const threat = strategy.enemyScores.get(targetId) ?? 0;
      if (threat > 0.7) return 8;
    }
  }

  if (vs.myRole === 'thing') {
    // During safe period, suppress all infection-related strategic bonuses
    // so the evaluator's low score (4) actually keeps the Thing in stealth mode
    const inSafePeriod = memory.globalTurnCount < THING_SAFE_TURNS;

    if (defId === 'infected') {
      if (inSafePeriod) return -6; // Actively discourage infecting during safe period
      return targetId === strategy.infectTargetId ? 18 : 12;
    }

    if (action.type === 'PLAY_CARD') {
      if (defId === 'temptation' && strategy.infectTargetId !== null && !inSafePeriod) return 9;
      if (['swap_places', 'watch_your_back', 'you_better_run'].includes(defId) && strategy.infectTargetId !== null && !inSafePeriod) return 7;
      if (ATTACK_CARD_IDS.has(defId) && strategy.attackTargetId !== null) return 6;
      if (INSPECT_CARD_IDS.has(defId) && strategy.attackTargetId !== null) return 4;
    }

    if ((action.type === 'DISCARD_CARD' || action.type === 'FORGETFUL_DISCARD_PICK' || action.type === 'BLIND_DATE_PICK') && defId === 'infected') {
      if (inSafePeriod) return 0; // During safe period, it's okay to discard infected (avoid suspicion)
      return -18;
    }

    if ((action.type === 'PLAY_DEFENSE' || action.type === 'DECLINE_DEFENSE') && targetId !== null) {
      const danger = strategy.enemyScores.get(targetId) ?? 0;
      if (danger < 0.4) return -3;
    }
  }

  if (vs.myRole === 'infected') {
    if (action.type === 'PLAY_CARD') {
      if (ATTACK_CARD_IDS.has(defId) && strategy.attackTargetId !== null) return 6;
      if (CONTAIN_CARD_IDS.has(defId) && strategy.attackTargetId !== null) return 5;
      if (strategy.supportThingTargetId !== null && ['no_barbecue', 'anti_analysis', 'fear', 'no_thanks'].includes(defId)) return 5;
    }

    if ((action.type === 'RESPOND_TRADE' || action.type === 'TEMPTATION_RESPOND' || action.type === 'PANIC_TRADE_RESPOND') && targetId === strategy.supportThingTargetId) {
      if (vs.myInfectedCount >= 3) return -18;
      if (STRONG_SUPPORT_CARDS.has(defId)) return 6;
      if (defId === 'infected') return -5;
    }

    if ((action.type === 'PLAY_DEFENSE' || action.type === 'DECLINE_DEFENSE') && targetId === strategy.supportThingTargetId && vs.myInfectedCount >= 3) {
      return 18;
    }
  }

  if (stage === 'late' && action.type === 'END_TURN') {
    return -2;
  }

  return 0;
}

export function applyStrategicBias(
  actions: ScoredAction[],
  vs: BotVisibleState,
  memory: BotMemory,
  stage: GameStage,
): void {
  const strategy = buildStrategyProfile(vs, memory);
  const pendingAction = vs.pendingAction;

  for (const entry of actions) {
    const defId = getCardDefIdFromAction(vs, entry.action);
    const targetId = getActionTargetId(vs, entry.action, pendingAction);
    const cardOrPendingDefId =
      defId ??
      (pendingAction?.type === 'choose_target' ? pendingAction.cardDefId : null) ??
      (pendingAction?.type === 'panic_choose_target' ? pendingAction.panicDefId : null);

    entry.score += strategicCardBonus(vs, strategy, entry.action, cardOrPendingDefId, targetId, stage, memory);
    entry.score += strategicTargetBonus(targetId, strategy, cardOrPendingDefId, pendingAction, vs, memory);
  }
}
