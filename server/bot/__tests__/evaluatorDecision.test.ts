import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInitialState } from '../../../src/gameLogic.ts';
import type { CardInstance, GameState, PendingAction, Player } from '../../../src/types.ts';
import { evaluateActions, getIncomingTradeRisk } from '../evaluator.ts';
import { adjustSuspicion, createBotMemory, recordSeenCards, setKnownRole } from '../memory.ts';
import { buildVisibleState } from '../visibleState.ts';

function card(defId: string, uid: string): CardInstance {
  return { defId, uid };
}

function player(id: number, role: Player['role'], position: number, hand: CardInstance[]): Player {
  return {
    id,
    name: `P${id + 1}`,
    role,
    avatarId: `avatar_${id}`,
    hand,
    isAlive: true,
    inQuarantine: false,
    quarantineTurnsLeft: 0,
    position,
  };
}

function makeState(pendingAction: PendingAction | null): GameState {
  return {
    ...createInitialState(),
    phase: 'playing',
    step: 'play_or_discard',
    currentPlayerIndex: 0,
    players: [
      player(0, 'human', 0, [card('suspicion', 'my_suspicion'), card('axe', 'my_axe')]),
      player(1, 'human', 1, [card('whisky', 'known_uid'), card('infected', 'unknown_uid')]),
      player(2, 'human', 2, [card('analysis', 'p2_a'), card('fear', 'p2_b')]),
      player(3, 'human', 3, [card('quarantine', 'p3_a'), card('miss', 'p3_b')]),
    ],
    seats: [0, 1, 2, 3],
    pendingAction,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bot evaluator tactical pending decisions', () => {
  it('prefers unseen card uids during suspicion pick', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState({
      type: 'suspicion_pick',
      targetPlayerId: 1,
      viewerPlayerId: 0,
      selectableCardUids: ['known_uid', 'unknown_uid'],
      previewCardUid: null,
    });

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    recordSeenCards(memory, 1, [state.players[1].hand[0]], 0, false);

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'SUSPICION_PREVIEW_CARD',
      cardUid: 'unknown_uid',
    });
  });

  it('uses panicDefId-specific target logic instead of one generic panic heuristic', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memory, 1, 0.45);
    adjustSuspicion(memory, 2, -0.2);

    const cantBeFriends = makeState({
      type: 'panic_choose_target',
      panicDefId: 'cant_be_friends',
      targets: [1, 2],
    });

    const betweenUs = makeState({
      type: 'panic_choose_target',
      panicDefId: 'panic_between_us',
      targets: [1, 2],
    });

    const cantBeFriendsActions = evaluateActions(buildVisibleState(cantBeFriends, 0), memory);
    const betweenUsActions = evaluateActions(buildVisibleState(betweenUs, 0), memory);

    expect(cantBeFriendsActions[0].action).toEqual({
      type: 'PANIC_SELECT_TARGET',
      targetPlayerId: 1,
    });
    expect(betweenUsActions[0].action).toEqual({
      type: 'PANIC_SELECT_TARGET',
      targetPlayerId: 2,
    });
  });

  it('prefers freeing a known infected ally from quarantine with axe choice', () => {
    const state = makeState({
      type: 'axe_choice',
      targetPlayerId: 1,
      canRemoveQuarantine: true,
      canRemoveDoor: true,
    });

    state.players[0].role = 'thing';
    state.players[1].role = 'infected';
    state.players[1].inQuarantine = true;
    state.doors = [{ between: [0, 1] }];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    setKnownRole(memory, 1, 'infected');

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'AXE_CHOOSE_EFFECT',
      targetPlayerId: 1,
      choice: 'quarantine',
    });
  });

  it('uses infected_only during revelations when a human bot holds an infection card', () => {
    const state = makeState({
      type: 'revelations_round',
      currentRevealerIdx: 0,
      revealOrder: [0, 1, 2, 3],
    });

    state.players[0].role = 'human';
    state.players[0].hand = [card('infected', 'my_infected'), card('axe', 'my_axe')];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'REVELATIONS_RESPOND',
      show: true,
      mode: 'infected_only',
    });
  });

  it('values watch_your_back higher when reversing leads to a safer trade partner', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const betterState = makeState(null);
    betterState.players[0].hand = [card('watch_your_back', 'wyb')];

    const betterMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(betterMemory, 1, 0.8);
    adjustSuspicion(betterMemory, 3, -0.35);

    const worseState = makeState(null);
    worseState.players[0].hand = [card('watch_your_back', 'wyb')];

    const worseMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(worseMemory, 1, -0.35);
    adjustSuspicion(worseMemory, 3, 0.8);

    const betterScore = evaluateActions(buildVisibleState(betterState, 0), betterMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const worseScore = evaluateActions(buildVisibleState(worseState, 0), worseMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(betterScore).toBeDefined();
    expect(worseScore).toBeDefined();
    expect(betterScore!).toBeGreaterThan(worseScore!);
  });

  it('values watch_your_back even more when reverse also protects a strong future trade card', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const strongHandState = makeState(null);
    strongHandState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
    ];

    const weakHandState = makeState(null);
    weakHandState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const strongHandMemory = createBotMemory(0, [0, 1, 2, 3]);
    const weakHandMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(strongHandMemory, 1, 0.8);
    adjustSuspicion(strongHandMemory, 3, -0.35);
    adjustSuspicion(weakHandMemory, 1, 0.8);
    adjustSuspicion(weakHandMemory, 3, -0.35);

    const strongScore = evaluateActions(buildVisibleState(strongHandState, 0), strongHandMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const weakScore = evaluateActions(buildVisibleState(weakHandState, 0), weakHandMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(strongScore).toBeDefined();
    expect(weakScore).toBeDefined();
    expect(strongScore!).toBeGreaterThan(weakScore!);
  });

  it('devalues watch_your_back when reversed trade partner was seen holding infected', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const safeState = makeState(null);
    safeState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const dangerState = makeState(null);
    dangerState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const safeMemory = createBotMemory(0, [0, 1, 2, 3]);
    const dangerMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(safeMemory, 1, 0.8);
    adjustSuspicion(safeMemory, 3, -0.35);
    adjustSuspicion(dangerMemory, 1, 0.8);
    adjustSuspicion(dangerMemory, 3, -0.35);
    recordSeenCards(dangerMemory, 3, [card('infected', 'seen_infected')], 0, false);

    const safeScore = evaluateActions(buildVisibleState(safeState, 0), safeMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const dangerScore = evaluateActions(buildVisibleState(dangerState, 0), dangerMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(safeScore).toBeDefined();
    expect(dangerScore).toBeDefined();
    expect(safeScore!).toBeGreaterThan(dangerScore!);
  });

  it('treats seen infected risk as stale after the partner hand changed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const freshRiskState = makeState(null);
    freshRiskState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const staleRiskState = makeState(null);
    staleRiskState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const freshRiskMemory = createBotMemory(0, [0, 1, 2, 3]);
    const staleRiskMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(freshRiskMemory, 1, 0.8);
    adjustSuspicion(freshRiskMemory, 3, -0.35);
    adjustSuspicion(staleRiskMemory, 1, 0.8);
    adjustSuspicion(staleRiskMemory, 3, -0.35);

    recordSeenCards(freshRiskMemory, 3, [card('infected', 'seen_infected')], 5, false);
    recordSeenCards(staleRiskMemory, 3, [card('infected', 'seen_infected')], 5, false);
    staleRiskMemory.observations.get(3)!.lastHandChangeTurn = 6;

    const freshRiskScore = evaluateActions(buildVisibleState(freshRiskState, 0), freshRiskMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const staleRiskScore = evaluateActions(buildVisibleState(staleRiskState, 0), staleRiskMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(freshRiskScore).toBeDefined();
    expect(staleRiskScore).toBeDefined();
    expect(staleRiskScore!).toBeGreaterThan(freshRiskScore!);
  });

  it('devalues watch_your_back more when reversed trade partner was seen holding multiple infected cards', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const singleRiskState = makeState(null);
    singleRiskState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const stackedRiskState = makeState(null);
    stackedRiskState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const singleRiskMemory = createBotMemory(0, [0, 1, 2, 3]);
    const stackedRiskMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(singleRiskMemory, 1, 0.8);
    adjustSuspicion(singleRiskMemory, 3, -0.35);
    adjustSuspicion(stackedRiskMemory, 1, 0.8);
    adjustSuspicion(stackedRiskMemory, 3, -0.35);

    recordSeenCards(singleRiskMemory, 3, [card('infected', 'seen_infected_1')], 5, false);
    recordSeenCards(stackedRiskMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('infected', 'seen_infected_2'),
    ], 5, false);

    const singleRiskScore = evaluateActions(buildVisibleState(singleRiskState, 0), singleRiskMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const stackedRiskScore = evaluateActions(buildVisibleState(stackedRiskState, 0), stackedRiskMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(singleRiskScore).toBeDefined();
    expect(stackedRiskScore).toBeDefined();
    expect(singleRiskScore!).toBeGreaterThan(stackedRiskScore!);
  });

  it('treats a mixed seen hand as less dangerous than a forced infected trade', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const forcedRiskState = makeState(null);
    forcedRiskState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const mixedRiskState = makeState(null);
    mixedRiskState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const forcedRiskMemory = createBotMemory(0, [0, 1, 2, 3]);
    const mixedRiskMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(forcedRiskMemory, 1, 0.8);
    adjustSuspicion(forcedRiskMemory, 3, -0.35);
    adjustSuspicion(mixedRiskMemory, 1, 0.8);
    adjustSuspicion(mixedRiskMemory, 3, -0.35);

    recordSeenCards(forcedRiskMemory, 3, [card('infected', 'seen_infected_1')], 5, false);
    recordSeenCards(mixedRiskMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);

    const forcedRiskScore = evaluateActions(buildVisibleState(forcedRiskState, 0), forcedRiskMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const mixedRiskScore = evaluateActions(buildVisibleState(mixedRiskState, 0), mixedRiskMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(forcedRiskScore).toBeDefined();
    expect(mixedRiskScore).toBeDefined();
    expect(mixedRiskScore!).toBeGreaterThan(forcedRiskScore!);
  });

  it('treats a confirmed infected partner as more dangerous than an unknown mixed hand', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const unknownMixedState = makeState(null);
    unknownMixedState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const infectedMixedState = makeState(null);
    infectedMixedState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const unknownMixedMemory = createBotMemory(0, [0, 1, 2, 3]);
    const infectedMixedMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(unknownMixedMemory, 1, 0.8);
    adjustSuspicion(unknownMixedMemory, 3, -0.35);
    adjustSuspicion(infectedMixedMemory, 1, 0.8);
    adjustSuspicion(infectedMixedMemory, 3, -0.35);

    recordSeenCards(unknownMixedMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    recordSeenCards(infectedMixedMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    setKnownRole(infectedMixedMemory, 3, 'infected');

    const unknownMixedScore = evaluateActions(buildVisibleState(unknownMixedState, 0), unknownMixedMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const infectedMixedScore = evaluateActions(buildVisibleState(infectedMixedState, 0), infectedMixedMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(unknownMixedScore).toBeDefined();
    expect(infectedMixedScore).toBeDefined();
    expect(unknownMixedScore!).toBeGreaterThan(infectedMixedScore!);
  });

  it('treats infected plus a valuable keep-card as more dangerous than infected plus junk', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const junkAlternativeState = makeState(null);
    junkAlternativeState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const valuableAlternativeState = makeState(null);
    valuableAlternativeState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('quarantine', 'my_quarantine'),
    ];

    const junkAlternativeMemory = createBotMemory(0, [0, 1, 2, 3]);
    const valuableAlternativeMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(junkAlternativeMemory, 1, 0.8);
    adjustSuspicion(junkAlternativeMemory, 3, -0.35);
    adjustSuspicion(valuableAlternativeMemory, 1, 0.8);
    adjustSuspicion(valuableAlternativeMemory, 3, -0.35);

    recordSeenCards(junkAlternativeMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_junk_1'),
    ], 5, false);
    recordSeenCards(valuableAlternativeMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('flamethrower', 'seen_keep_1'),
    ], 5, false);

    const junkAlternativeScore = evaluateActions(buildVisibleState(junkAlternativeState, 0), junkAlternativeMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;
    const valuableAlternativeScore = evaluateActions(buildVisibleState(valuableAlternativeState, 0), valuableAlternativeMemory)
      .find(action => action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb')?.score;

    expect(junkAlternativeScore).toBeDefined();
    expect(valuableAlternativeScore).toBeDefined();
    expect(junkAlternativeScore!).toBeGreaterThan(valuableAlternativeScore!);
  });

  it('treats a confirmed thing as more dangerous than a confirmed infected with the same seen infected hand', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const infectedRoleState = makeState(null);
    infectedRoleState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
      card('quarantine', 'my_quarantine'),
    ];

    const thingRoleState = makeState(null);
    thingRoleState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
      card('quarantine', 'my_quarantine'),
    ];

    const infectedRoleMemory = createBotMemory(0, [0, 1, 2, 3]);
    const thingRoleMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(infectedRoleMemory, 1, 0.8);
    adjustSuspicion(infectedRoleMemory, 3, -0.35);
    adjustSuspicion(thingRoleMemory, 1, 0.8);
    adjustSuspicion(thingRoleMemory, 3, -0.35);

    recordSeenCards(infectedRoleMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    recordSeenCards(thingRoleMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    setKnownRole(infectedRoleMemory, 3, 'infected');
    setKnownRole(thingRoleMemory, 3, 'thing');

    const infectedRoleRisk = getIncomingTradeRisk(
      buildVisibleState(infectedRoleState, 0),
      infectedRoleMemory,
      3,
      'mid',
    );
    const thingRoleRisk = getIncomingTradeRisk(
      buildVisibleState(thingRoleState, 0),
      thingRoleMemory,
      3,
      'mid',
    );

    expect(infectedRoleRisk).toBeLessThan(thingRoleRisk);
  });

  it('ignores seen infected cards for a confirmed infected partner when the bot is human', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const infectedSeenState = makeState(null);
    infectedSeenState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
      card('quarantine', 'my_quarantine'),
    ];

    const safeOnlyState = makeState(null);
    safeOnlyState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
      card('quarantine', 'my_quarantine'),
    ];

    const infectedSeenMemory = createBotMemory(0, [0, 1, 2, 3]);
    const safeOnlyMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(infectedSeenMemory, 1, 0.8);
    adjustSuspicion(infectedSeenMemory, 3, -0.35);
    adjustSuspicion(safeOnlyMemory, 1, 0.8);
    adjustSuspicion(safeOnlyMemory, 3, -0.35);

    recordSeenCards(infectedSeenMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    recordSeenCards(safeOnlyMemory, 3, [
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    setKnownRole(infectedSeenMemory, 3, 'infected');
    setKnownRole(safeOnlyMemory, 3, 'infected');

    const infectedSeenRisk = getIncomingTradeRisk(
      buildVisibleState(infectedSeenState, 0),
      infectedSeenMemory,
      3,
      'mid',
    );
    const safeOnlyRisk = getIncomingTradeRisk(
      buildVisibleState(safeOnlyState, 0),
      safeOnlyMemory,
      3,
      'mid',
    );

    expect(infectedSeenRisk).toBe(safeOnlyRisk);
  });

  it('treats a partner who has already attacked the bot as more dangerous for future trade', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const neutralState = makeState(null);
    neutralState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
      card('quarantine', 'my_quarantine'),
    ];

    const hostileState = makeState(null);
    hostileState.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('flamethrower', 'my_flamethrower'),
      card('quarantine', 'my_quarantine'),
    ];

    const neutralMemory = createBotMemory(0, [0, 1, 2, 3]);
    const hostileMemory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(neutralMemory, 1, 0.8);
    adjustSuspicion(neutralMemory, 3, -0.35);
    adjustSuspicion(hostileMemory, 1, 0.8);
    adjustSuspicion(hostileMemory, 3, -0.35);

    recordSeenCards(neutralMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    recordSeenCards(hostileMemory, 3, [
      card('infected', 'seen_infected_1'),
      card('whisky', 'seen_safe_1'),
    ], 5, false);
    setKnownRole(neutralMemory, 3, 'thing');
    setKnownRole(hostileMemory, 3, 'thing');
    hostileMemory.observations.get(3)!.attackedPlayers.push(0, 0);

    const neutralRisk = getIncomingTradeRisk(
      buildVisibleState(neutralState, 0),
      neutralMemory,
      3,
      'mid',
    );
    const hostileRisk = getIncomingTradeRisk(
      buildVisibleState(hostileState, 0),
      hostileMemory,
      3,
      'mid',
    );

    expect(hostileRisk).toBeGreaterThan(neutralRisk);
  });

  it('defends instead of accepting a lethal fourth infection from a known Thing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState({
      type: 'trade_defense',
      defenderId: 0,
      fromId: 1,
      offeredCardUid: 'thing_offer',
      reason: 'trade',
    });

    state.players[0].role = 'infected';
    state.players[0].hand = [
      card('fear', 'my_fear'),
      card('infected', 'my_infected_1'),
      card('infected', 'my_infected_2'),
      card('infected', 'my_infected_3'),
    ];
    state.players[1].role = 'thing';

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    setKnownRole(memory, 1, 'thing');

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'PLAY_DEFENSE',
      cardUid: 'my_fear',
    });
  });

  it('refuses to keep another infected card when already at three infections', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState({
      type: 'persistence_pick',
      drawnCards: [
        card('infected', 'drawn_infected'),
        card('axe', 'drawn_axe'),
      ],
    });

    state.players[0].role = 'infected';
    state.players[0].hand = [
      card('infected', 'my_infected_1'),
      card('infected', 'my_infected_2'),
      card('infected', 'my_infected_3'),
      card('fear', 'my_fear'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'PERSISTENCE_PICK',
      keepUid: 'drawn_axe',
      discardUids: ['drawn_infected'],
    });
  });

  it('does not try to give infected to a human target just because the current trade partner is Thing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState({
      type: 'choose_card_to_give',
      targetPlayerId: 2,
    });

    state.step = 'play_or_discard';
    state.currentPlayerIndex = 0;
    state.players[0].role = 'infected';
    state.players[0].hand = [
      card('infected', 'my_infected_1'),
      card('infected', 'my_infected_2'),
      card('infected', 'my_infected_3'),
      card('flamethrower', 'my_flamethrower'),
    ];
    state.players[1].role = 'thing';
    state.players[2].role = 'human';

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'TEMPTATION_SELECT',
      targetPlayerId: 2,
      cardUid: 'my_flamethrower',
    });
  });

  it('prefers the move card with the better full play-target-trade line', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState(null);
    state.players[0].hand = [
      card('watch_your_back', 'wyb'),
      card('swap_places', 'my_swap'),
      card('quarantine', 'my_quarantine'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memory, 1, -0.4);
    adjustSuspicion(memory, 2, 0.2);
    adjustSuspicion(memory, 3, 0.2);

    const actions = evaluateActions(buildVisibleState(state, 0), memory);
    const watchScore = actions.find(action =>
      action.action.type === 'PLAY_CARD' && action.action.cardUid === 'wyb'
    )?.score;
    const swapScore = actions.find(action =>
      action.action.type === 'PLAY_CARD' && action.action.cardUid === 'my_swap'
    )?.score;

    expect(watchScore).toBeDefined();
    expect(swapScore).toBeDefined();
    expect(swapScore!).toBeGreaterThan(watchScore!);
  });

  it('prefers a swap target that leaves a safer next trade partner', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState({
      type: 'choose_target',
      cardUid: 'my_swap',
      cardDefId: 'swap_places',
      targets: [1, 3],
    });

    state.players[0].hand = [card('swap_places', 'my_swap'), card('axe', 'my_axe')];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memory, 1, -0.2);
    adjustSuspicion(memory, 2, -0.45);
    adjustSuspicion(memory, 3, 0.85);

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'SELECT_TARGET',
      targetPlayerId: 1,
    });
  });

  it('makes Thing push infection immediately when a legal trade target exists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState(null);
    state.step = 'trade';
    state.players[0].role = 'thing';
    state.players[0].hand = [
      card('infected', 'thing_infected'),
      card('flamethrower', 'thing_fire'),
    ];
    state.players[1].role = 'human';

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memory, 1, -0.25);

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'OFFER_TRADE',
      cardUid: 'thing_infected',
    });
  });

  it('makes a human prioritize burning a confirmed enemy over pure repositioning', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState(null);
    state.players[0].hand = [
      card('flamethrower', 'my_flamethrower'),
      card('watch_your_back', 'my_watch'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    setKnownRole(memory, 1, 'thing');

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    expect(actions[0].action).toEqual({
      type: 'PLAY_CARD',
      cardUid: 'my_flamethrower',
    });
  });
});

// ── Bug fix: infected bot flamethrower vs Thing ───────────────────────────────

describe('infected bot flamethrower safety guard', () => {
  it('infected bot scores flamethrower lower against known Thing than against a suspicious human', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // Scenario A: only adjacent target is the Thing (should have low or no flamethrower score)
    const stateThingOnly = makeState(null);
    stateThingOnly.players[0].role = 'infected';
    stateThingOnly.players[0].hand = [card('flamethrower', 'my_flame')];
    // Make player 1 the only adjacent target — endgame check won't fire for it (knownRole=thing)
    stateThingOnly.players[2].isAlive = false; // remove from play
    stateThingOnly.players[3].isAlive = false;

    const memoryThingOnly = createBotMemory(0, [0, 1, 2, 3]);
    setKnownRole(memoryThingOnly, 1, 'thing');

    const actionsThingOnly = evaluateActions(buildVisibleState(stateThingOnly, 0), memoryThingOnly);
    const flameThingOnly = actionsThingOnly.find(a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_flame');

    // Scenario B: adjacent target is a suspicious human (should have high flamethrower score)
    const stateHuman = makeState(null);
    stateHuman.players[0].role = 'infected';
    stateHuman.players[0].hand = [card('flamethrower', 'my_flame')];
    stateHuman.players[2].isAlive = false;
    stateHuman.players[3].isAlive = false;

    const memoryHuman = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memoryHuman, 1, 0.9);
    memoryHuman.observations.get(1)!.confirmedInfected = true; // human bot sees confirmed infected target

    const actionsHuman = evaluateActions(buildVisibleState(stateHuman, 0), memoryHuman);
    const flameHuman = actionsHuman.find(a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_flame');

    // Flamethrower should score the same or lower when target is the Thing
    const thingScore = flameThingOnly?.score ?? 0;
    const humanScore = flameHuman?.score ?? 0;
    expect(humanScore).toBeGreaterThanOrEqual(thingScore);
  });

  it('infected bot CAN flamethrower humans in mid/late game endgame conditions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // 4 players alive (<=endgameThreshold), so endgame check fires
    const state = makeState(null);
    state.players[0].role = 'infected';
    state.players[0].hand = [card('flamethrower', 'my_flame')];
    // All others are human (default from makeState)

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    // No one is confirmed infected — so infected bot sees humans as targets

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    // In endgame (4 alive = endgameThreshold), infected bot should generate flamethrower action
    const flameAction = actions.find(
      a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_flame',
    );
    expect(flameAction).toBeDefined();
    expect(flameAction!.score).toBeGreaterThan(0);
  });
});

// ── Bug fix: infected bot quarantine excludes Thing ───────────────────────────

describe('infected bot quarantine guard against Thing', () => {
  it('infected bot scores quarantine much lower when all remaining targets are the Thing or allies', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // Infected bot with only ally targets (Thing + confirmed infected) — quarantine should be low value
    const state = {
      ...makeState(null),
      players: [
        player(0, 'infected', 0, [card('quarantine', 'my_quarantine'), card('whisky', 'my_whisky')]),
        player(1, 'thing', 1, [card('the_thing', 'thing_card')]),
        player(2, 'infected', 2, [card('infected', 'inf_card')]),
        player(3, 'infected', 3, [card('infected', 'inf2')]),
      ],
      seats: [0, 1, 2, 3],
    };

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    setKnownRole(memory, 1, 'thing');
    memory.observations.get(2)!.confirmedInfected = true;
    memory.observations.get(3)!.confirmedInfected = true;

    const actionsAllAllies = evaluateActions(buildVisibleState(state, 0), memory);

    // Compare with a state where there's a human target available
    const stateWithHuman = makeState(null);
    stateWithHuman.players[0].role = 'infected';
    stateWithHuman.players[0].hand = [card('quarantine', 'my_quarantine'), card('whisky', 'my_whisky')];

    const memoryWithHuman = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memoryWithHuman, 1, 0.6);

    const actionsWithHuman = evaluateActions(buildVisibleState(stateWithHuman, 0), memoryWithHuman);

    const quarantineScoreAllAllies = actionsAllAllies.find(
      a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_quarantine',
    )?.score ?? 0;

    const quarantineScoreWithHuman = actionsWithHuman.find(
      a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_quarantine',
    )?.score ?? 0;

    // Having a human target should produce higher quarantine score
    expect(quarantineScoreWithHuman).toBeGreaterThanOrEqual(quarantineScoreAllAllies);
  });

  it('infected bot CAN quarantine players who are not the Thing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState(null);
    state.players[0].role = 'infected';
    state.players[0].hand = [card('quarantine', 'my_quarantine')];
    // Players 1-3 are all human — none are the Thing

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    adjustSuspicion(memory, 1, 0.6);
    adjustSuspicion(memory, 2, 0.5);

    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    // Some quarantine action targeting a non-Thing player should be generated
    const anyQuarantine = actions.find(
      a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_quarantine',
    );
    expect(anyQuarantine).toBeDefined();
  });
});

// ── Bug fix: Thing bot does not trade no_barbecue/anti_analysis ───────────────

describe('Thing bot trade hoarding (no_barbecue / anti_analysis)', () => {
  it('Thing bot scores no_barbecue near-zero when asked to give it in trade', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = {
      ...makeState({
        type: 'trade_defense',
        defenderId: 0,
        fromId: 1,
        reason: 'trade',
      } as PendingAction),
    };
    state.players[0].role = 'thing';
    state.players[0].hand = [
      card('no_barbecue', 'my_nob'),
      card('whisky', 'my_whisky'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    const giveNoBarbecue = actions.find(
      a => a.action.type === 'RESPOND_TRADE' && a.action.cardUid === 'my_nob',
    );
    const giveWhisky = actions.find(
      a => a.action.type === 'RESPOND_TRADE' && a.action.cardUid === 'my_whisky',
    );

    // Whisky should score higher than no_barbecue (Thing hoards defense cards)
    if (giveNoBarbecue && giveWhisky) {
      expect(giveWhisky.score).toBeGreaterThan(giveNoBarbecue.score);
    }
    // no_barbecue trade score should be blocked to near-zero
    expect(giveNoBarbecue?.score ?? 0).toBeLessThan(0.5);
  });

  it('Thing bot scores anti_analysis near-zero when asked to give it in trade', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = {
      ...makeState({
        type: 'trade_defense',
        defenderId: 0,
        fromId: 1,
        reason: 'trade',
      } as PendingAction),
    };
    state.players[0].role = 'thing';
    state.players[0].hand = [
      card('anti_analysis', 'my_aa'),
      card('whisky', 'my_whisky'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    const giveAntiAnalysis = actions.find(
      a => a.action.type === 'RESPOND_TRADE' && a.action.cardUid === 'my_aa',
    );
    const giveWhisky = actions.find(
      a => a.action.type === 'RESPOND_TRADE' && a.action.cardUid === 'my_whisky',
    );

    if (giveAntiAnalysis && giveWhisky) {
      expect(giveWhisky.score).toBeGreaterThan(giveAntiAnalysis.score);
    }
    // anti_analysis trade score should be blocked to near-zero
    expect(giveAntiAnalysis?.score ?? 0).toBeLessThan(0.5);
  });
});

// ── Persistence card scoring ──────────────────────────────────────────────────

describe('persistence card scoring', () => {
  it('human bot rates persistence higher than whisky when hand has no weapons', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState(null);
    state.players[0].role = 'human';
    state.players[0].hand = [
      card('persistence', 'my_persistence'),
      card('whisky', 'my_whisky'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    const playPersistence = actions.find(
      a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_persistence',
    );
    const playWhisky = actions.find(
      a => a.action.type === 'PLAY_CARD' && a.action.cardUid === 'my_whisky',
    );

    expect(playPersistence).toBeDefined();
    expect(playWhisky).toBeDefined();
    expect(playPersistence!.score).toBeGreaterThan(playWhisky!.score);
  });

  it('human bot does not discard persistence (very high discard penalty)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const state = makeState(null);
    state.players[0].role = 'human';
    state.players[0].hand = [
      card('persistence', 'my_persistence'),
      card('whisky', 'my_whisky'),
      card('miss', 'my_miss'),
    ];

    const memory = createBotMemory(0, [0, 1, 2, 3]);
    const actions = evaluateActions(buildVisibleState(state, 0), memory);

    const discardPersistence = actions.find(
      a => a.action.type === 'DISCARD_CARD' && a.action.cardUid === 'my_persistence',
    );
    const discardWhisky = actions.find(
      a => a.action.type === 'DISCARD_CARD' && a.action.cardUid === 'my_whisky',
    );

    if (discardPersistence && discardWhisky) {
      expect(discardWhisky.score).toBeGreaterThan(discardPersistence.score);
    }
  });
});
