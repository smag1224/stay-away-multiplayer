import fs from 'node:fs/promises';
import path from 'node:path';
import { createInitialState, gameReducer } from '../src/gameLogic/index.ts';
import type { GameAction, GameState, PendingAction, Role } from '../src/types.ts';
import { decideBotAction, clearRoomMemory } from '../server/bot/index.ts';

type Winner = NonNullable<GameState['winner']>;

type GameMode = 'standard' | 'anomaly' | 'thing_in_deck';

type CliOptions = {
  games: number;
  players: number[];
  maxActions: number;
  jsonOut: string;
  markdownOut: string;
  verbose: boolean;
  mode: GameMode;
};

type SimulationGameResult = {
  gameIndex: number;
  playerCount: number;
  winner: Winner;
  steps: number;
  initialRoles: Array<{ playerId: number; role: Role }>;
  finalRoles: Array<{ playerId: number; role: Role }>;
  winnerPlayerIds: number[];
  friendlyFireCount: number;
  /** How many infected players were alive at game end */
  infectedAtEnd: number;
  /** Did the Thing player survive to the end? */
  thingSurvived: boolean;
  /** Global turn when Thing infected the first human (null = never infected anyone) */
  firstInfectionTurn: number | null;
  /** How many flamethrowers/necros were played by Thing team */
  thingTeamAttacks: number;
  /** How many flamethrowers/necros were played by humans */
  humanAttacks: number;
  /** How many anti_analysis defenses were used by Thing team */
  thingTeamAntiAnalysis: number;
  /** Cards played per role: map of defId → count */
  cardsByRole: Record<string, Record<string, number>>;
};

type AggregateStats = {
  totalGames: number;
  totalSteps: number;
  averageSteps: number;
  totalFriendlyFire: number;
  averageFriendlyFire: number;
  byWinner: Record<Winner, { wins: number; rate: number }>;
  byPlayerCount: Record<string, Record<Winner, number>>;
  roleWinRates: Record<Role, { wins: number; total: number; rate: number }>;
};

function parseArgs(argv: string[]): CliOptions {
  const value = (flag: string): string | undefined => {
    const exactIndex = argv.indexOf(flag);
    if (exactIndex >= 0) return argv[exactIndex + 1];
    const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
    return inline ? inline.slice(flag.length + 1) : undefined;
  };

  const games = Number.parseInt(value('--games') ?? '120', 10);
  const players = (value('--players') ?? '6,7,9')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((count) => Number.isFinite(count) && count >= 4 && count <= 12);
  const maxActions = Number.parseInt(value('--max-actions') ?? '4000', 10);
  const jsonOut = value('--json-out') ?? 'reports/bot-balance-latest.json';
  const markdownOut = value('--markdown-out') ?? 'reports/bot-balance-latest.md';
  const verbose = argv.includes('--verbose');
  const modeRaw = value('--mode') ?? 'standard';
  const mode: GameMode = (modeRaw === 'anomaly' || modeRaw === 'thing_in_deck') ? modeRaw : 'standard';

  if (!Number.isFinite(games) || games <= 0) {
    throw new Error(`Invalid --games value: ${games}`);
  }
  if (players.length === 0) {
    throw new Error('No valid player counts were provided. Example: --players=6,7,9');
  }
  if (!Number.isFinite(maxActions) || maxActions <= 0) {
    throw new Error(`Invalid --max-actions value: ${maxActions}`);
  }

  return {
    games,
    players,
    maxActions,
    jsonOut,
    markdownOut,
    verbose,
    mode,
  };
}

function startBotOnlyGame(playerCount: number, mode: GameMode = 'standard'): GameState {
  const playerNames = Array.from({ length: playerCount }, (_, index) => `Bot ${index + 1}`);
  const started = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames,
    chaosMode: mode === 'anomaly',
    thingInDeck: mode === 'thing_in_deck',
  });

  return {
    ...started,
    phase: 'playing',
    revealingPlayer: playerCount - 1,
  };
}

function getPendingCandidates(state: GameState, pendingAction: PendingAction): number[] {
  switch (pendingAction.type) {
    case 'trade_defense':
      return [pendingAction.defenderId];
    case 'view_hand':
    case 'view_card':
    case 'whisky_reveal':
      return [pendingAction.viewerPlayerId];
    case 'show_hand_confirm':
      return [pendingAction.playerId];
    case 'suspicion_pick':
      return [pendingAction.viewerPlayerId];
    case 'party_pass':
      return [...pendingAction.pendingPlayerIds];
    case 'just_between_us_pick':
      return [pendingAction.playerA, pendingAction.playerB];
    case 'revelations_round':
      return [pendingAction.revealOrder[pendingAction.currentRevealerIdx]];
    case 'temptation_response':
    case 'trade_offer':
    case 'panic_trade_response':
      return [pendingAction.toId];
    case 'choose_target':
    case 'choose_card_to_give':
    case 'choose_card_to_discard':
    case 'persistence_pick':
    case 'declare_victory':
    case 'just_between_us':
    case 'panic_choose_target':
    case 'blind_date_swap':
    case 'forgetful_discard':
    case 'panic_trade':
    case 'axe_choice':
    case 'panic_effect':
      return [state.players[state.currentPlayerIndex]?.id].filter((id): id is number => typeof id === 'number');
    default:
      return [];
  }
}

function getCandidateActorIds(state: GameState): number[] {
  if (!state.pendingAction) {
    const currentId = state.players[state.currentPlayerIndex]?.id;
    return typeof currentId === 'number' ? [currentId] : [];
  }

  const candidates = getPendingCandidates(state, state.pendingAction);
  const seen = new Set<number>();
  const uniqueCandidates = candidates.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (uniqueCandidates.length > 0) return uniqueCandidates;

  return state.players.filter((player) => player.isAlive).map((player) => player.id);
}

function getFallbackAction(state: GameState): GameAction | null {
  if (state.pendingAction) return null;

  switch (state.step) {
    case 'draw':
      return { type: 'DRAW_CARD' };
    case 'end_turn':
      return { type: 'END_TURN' };
    default:
      return null;
  }
}

function chooseAction(state: GameState, roomCode: string): GameAction {
  for (const actorId of getCandidateActorIds(state)) {
    const action = decideBotAction(state, actorId, roomCode);
    if (action) return action;
  }

  const fallback = getFallbackAction(state);
  if (fallback) return fallback;

  throw new Error(
    `No bot action available for state step=${state.step}, pending=${state.pendingAction?.type ?? 'none'}, currentPlayer=${state.players[state.currentPlayerIndex]?.id ?? 'n/a'}`,
  );
}

function didRoleWin(role: Role, winner: Winner): boolean {
  if (winner === 'humans') return role === 'human';
  if (winner === 'thing') return role === 'thing' || role === 'infected';
  return role === 'thing';
}

function buildSummary(results: SimulationGameResult[]): AggregateStats {
  const byWinner = {
    humans: { wins: 0, rate: 0 },
    thing: { wins: 0, rate: 0 },
    thing_solo: { wins: 0, rate: 0 },
  } satisfies Record<Winner, { wins: number; rate: number }>;

  const byPlayerCount: Record<string, Record<Winner, number>> = {};
  const roleWinRates = {
    human: { wins: 0, total: 0, rate: 0 },
    thing: { wins: 0, total: 0, rate: 0 },
    infected: { wins: 0, total: 0, rate: 0 },
  } satisfies Record<Role, { wins: number; total: number; rate: number }>;

  let totalSteps = 0;
  let totalFriendlyFire = 0;

  for (const result of results) {
    byWinner[result.winner].wins += 1;
    totalSteps += result.steps;
    totalFriendlyFire += result.friendlyFireCount;

    const playerCountKey = String(result.playerCount);
    byPlayerCount[playerCountKey] ??= { humans: 0, thing: 0, thing_solo: 0 };
    byPlayerCount[playerCountKey][result.winner] += 1;

    for (const roleInfo of result.finalRoles) {
      roleWinRates[roleInfo.role].total += 1;
      if (didRoleWin(roleInfo.role, result.winner)) {
        roleWinRates[roleInfo.role].wins += 1;
      }
    }
  }

  const totalGames = results.length;
  for (const winner of Object.keys(byWinner) as Winner[]) {
    byWinner[winner].rate = totalGames === 0 ? 0 : byWinner[winner].wins / totalGames;
  }
  for (const role of Object.keys(roleWinRates) as Role[]) {
    const roleStats = roleWinRates[role];
    roleStats.rate = roleStats.total === 0 ? 0 : roleStats.wins / roleStats.total;
  }

  return {
    totalGames,
    totalSteps,
    averageSteps: totalGames === 0 ? 0 : totalSteps / totalGames,
    totalFriendlyFire,
    averageFriendlyFire: totalGames === 0 ? 0 : totalFriendlyFire / totalGames,
    byWinner,
    byPlayerCount,
    roleWinRates,
  };
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function correlationAnalysis(results: SimulationGameResult[]): string[] {
  const wins = results.filter((r) => r.winner === 'thing' || r.winner === 'thing_solo');
  const losses = results.filter((r) => r.winner === 'humans');

  const lines: string[] = ['', '=== Correlation Analysis (Thing team wins vs losses) ===', ''];

  // 1. Infected at end
  const avgInfectedWin = avg(wins.map((r) => r.infectedAtEnd));
  const avgInfectedLoss = avg(losses.map((r) => r.infectedAtEnd));
  lines.push(`Infected alive at end: ${avgInfectedWin.toFixed(2)} (wins) vs ${avgInfectedLoss.toFixed(2)} (losses)`);

  // 2. Thing survived
  const thingSurvivedWin = wins.filter((r) => r.thingSurvived).length / (wins.length || 1);
  const thingSurvivedLoss = losses.filter((r) => r.thingSurvived).length / (losses.length || 1);
  lines.push(`Thing survived: ${percent(thingSurvivedWin)} (wins) vs ${percent(thingSurvivedLoss)} (losses)`);

  // 3. First infection turn
  const winWithInfection = wins.filter((r) => r.firstInfectionTurn !== null);
  const lossWithInfection = losses.filter((r) => r.firstInfectionTurn !== null);
  const avgFirstInfWin = avg(winWithInfection.map((r) => r.firstInfectionTurn!));
  const avgFirstInfLoss = avg(lossWithInfection.map((r) => r.firstInfectionTurn!));
  const neverInfectedLoss = losses.filter((r) => r.firstInfectionTurn === null).length;
  lines.push(`First infection turn: ${avgFirstInfWin.toFixed(1)} (wins) vs ${avgFirstInfLoss.toFixed(1)} (losses) [${neverInfectedLoss} losses with 0 infections]`);

  // 4. Thing team attacks (flamethrower/necronomicon)
  const avgAttacksWin = avg(wins.map((r) => r.thingTeamAttacks));
  const avgAttacksLoss = avg(losses.map((r) => r.thingTeamAttacks));
  lines.push(`Thing team attacks (flame/necro): ${avgAttacksWin.toFixed(2)} (wins) vs ${avgAttacksLoss.toFixed(2)} (losses)`);

  // 5. Human attacks
  const avgHumanAttacksWin = avg(wins.map((r) => r.humanAttacks));
  const avgHumanAttacksLoss = avg(losses.map((r) => r.humanAttacks));
  lines.push(`Human attacks (flame/necro): ${avgHumanAttacksWin.toFixed(2)} (wins) vs ${avgHumanAttacksLoss.toFixed(2)} (losses)`);

  // 6. Anti-analysis uses
  const avgAntiAnalysisWin = avg(wins.map((r) => r.thingTeamAntiAnalysis));
  const avgAntiAnalysisLoss = avg(losses.map((r) => r.thingTeamAntiAnalysis));
  lines.push(`Thing team anti-analysis used: ${avgAntiAnalysisWin.toFixed(2)} (wins) vs ${avgAntiAnalysisLoss.toFixed(2)} (losses)`);

  // 7. Game length
  const avgStepsWin = avg(wins.map((r) => r.steps));
  const avgStepsLoss = avg(losses.map((r) => r.steps));
  lines.push(`Avg game length (steps): ${avgStepsWin.toFixed(0)} (wins) vs ${avgStepsLoss.toFixed(0)} (losses)`);

  // 8. Win rate breakdown by infected count at end (for losses)
  lines.push('');
  lines.push('Loss breakdown by infected alive at end:');
  for (let n = 0; n <= 5; n++) {
    const count = losses.filter((r) => r.infectedAtEnd === n).length;
    if (count > 0) lines.push(`  ${n} infected alive: ${count} losses`);
  }

  // 9. Card usage correlation by role
  function mergeCards(games: SimulationGameResult[], role: string): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const g of games) {
      for (const [defId, count] of Object.entries(g.cardsByRole[role] ?? {})) {
        totals[defId] = (totals[defId] ?? 0) + count;
      }
    }
    return totals;
  }

  function avgCards(games: SimulationGameResult[], role: string): Record<string, number> {
    const totals = mergeCards(games, role);
    const n = games.length || 1;
    return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / n]));
  }

  for (const role of ['thing', 'infected', 'human'] as const) {
    const winCards = avgCards(wins, role);
    const lossCards = avgCards(losses, role);
    const allKeys = new Set([...Object.keys(winCards), ...Object.keys(lossCards)]);

    // Sort by absolute difference descending
    const sorted = [...allKeys].sort((a, b) => {
      const diffA = Math.abs((winCards[a] ?? 0) - (lossCards[a] ?? 0));
      const diffB = Math.abs((winCards[b] ?? 0) - (lossCards[b] ?? 0));
      return diffB - diffA;
    });

    lines.push('');
    lines.push(`Card usage by [${role}] — avg per game (wins → losses, Δ):`);
    for (const key of sorted.slice(0, 12)) {
      const w = winCards[key] ?? 0;
      const l = lossCards[key] ?? 0;
      const delta = w - l;
      const arrow = delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '=';
      lines.push(`  ${key.padEnd(18)} ${w.toFixed(2)} → ${l.toFixed(2)}  ${arrow} ${delta > 0 ? '+' : ''}${delta.toFixed(2)}`);
    }
  }

  return lines;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toMarkdown(summary: AggregateStats, results: SimulationGameResult[], options: CliOptions): string {
  const lines: string[] = [
    '# Bot Balance Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Games: ${summary.totalGames}`,
    `- Player counts: ${options.players.join(', ')}`,
    `- Game mode: ${options.mode}`,
    `- Avg. actions per game: ${summary.averageSteps.toFixed(1)}`,
    `- Friendly fire events: ${summary.totalFriendlyFire} total (${summary.averageFriendlyFire.toFixed(2)} per game)`,
    '',
    '## Winner Distribution',
    '',
    '| Winner | Wins | Rate |',
    '| --- | ---: | ---: |',
    `| Humans | ${summary.byWinner.humans.wins} | ${percent(summary.byWinner.humans.rate)} |`,
    `| Thing team | ${summary.byWinner.thing.wins} | ${percent(summary.byWinner.thing.rate)} |`,
    `| Thing solo | ${summary.byWinner.thing_solo.wins} | ${percent(summary.byWinner.thing_solo.rate)} |`,
    '',
    '## Final Role Seat Win Rates',
    '',
    '| Final role | Wins | Total seats | Rate |',
    '| --- | ---: | ---: | ---: |',
    `| Human | ${summary.roleWinRates.human.wins} | ${summary.roleWinRates.human.total} | ${percent(summary.roleWinRates.human.rate)} |`,
    `| Thing | ${summary.roleWinRates.thing.wins} | ${summary.roleWinRates.thing.total} | ${percent(summary.roleWinRates.thing.rate)} |`,
    `| Infected | ${summary.roleWinRates.infected.wins} | ${summary.roleWinRates.infected.total} | ${percent(summary.roleWinRates.infected.rate)} |`,
    '',
    '## By Player Count',
    '',
    '| Players | Humans | Thing team | Thing solo |',
    '| --- | ---: | ---: | ---: |',
  ];

  for (const playerCount of Object.keys(summary.byPlayerCount).sort((left, right) => Number(left) - Number(right))) {
    const row = summary.byPlayerCount[playerCount];
    lines.push(`| ${playerCount} | ${row.humans} | ${row.thing} | ${row.thing_solo} |`);
  }

  lines.push('', '## Last 10 Games', '', '| # | Players | Winner | Steps |', '| --- | ---: | --- | ---: |');

  for (const result of results.slice(-10)) {
    lines.push(`| ${result.gameIndex + 1} | ${result.playerCount} | ${result.winner} | ${result.steps} |`);
  }

  return `${lines.join('\n')}\n`;
}

function formatSummary(summary: AggregateStats): string {
  return [
    `Games: ${summary.totalGames}`,
    `Average actions: ${summary.averageSteps.toFixed(1)}`,
    `Humans: ${summary.byWinner.humans.wins} (${percent(summary.byWinner.humans.rate)})`,
    `Thing team: ${summary.byWinner.thing.wins} (${percent(summary.byWinner.thing.rate)})`,
    `Thing solo: ${summary.byWinner.thing_solo.wins} (${percent(summary.byWinner.thing_solo.rate)})`,
    `Role win rates: human ${percent(summary.roleWinRates.human.rate)}, thing ${percent(summary.roleWinRates.thing.rate)}, infected ${percent(summary.roleWinRates.infected.rate)}`,
    `Friendly fire: ${summary.totalFriendlyFire} total (${summary.averageFriendlyFire.toFixed(2)} per game)`,
  ].join('\n');
}

function runSingleSimulation(playerCount: number, gameIndex: number, maxActions: number, mode: GameMode = 'standard'): SimulationGameResult {
  const roomCode = `sim_${playerCount}_${gameIndex}`;
  let state = startBotOnlyGame(playerCount, mode);
  const initialRoles = state.players.map((player) => ({ playerId: player.id, role: player.role }));
  let friendlyFireCount = 0;
  let thingTeamAttacks = 0;
  let humanAttacks = 0;
  let thingTeamAntiAnalysis = 0;
  let firstInfectionTurn: number | null = null;
  const cardsByRole: Record<string, Record<string, number>> = {
    thing: {}, infected: {}, human: {},
  };
  let globalTurn = 0;
  let lastCurrentPlayerIndex = state.currentPlayerIndex;
  // Log uses unshift (newest-first). Track by entry ID to find new entries.
  let lastSeenLogId = state.log[0]?.id ?? 0;

  try {
    for (let step = 0; step < maxActions; step++) {
      if (state.phase === 'game_over' && state.winner) {
        const finalRoles = state.players.map((p) => ({ playerId: p.id, role: p.role }));
        const thingPlayer = state.players.find((p) => initialRoles.find((r) => r.playerId === p.id)?.role === 'thing');
        const infectedAtEnd = finalRoles.filter((r) => r.role === 'infected').length;
        const thingSurvived = thingPlayer?.isAlive ?? false;
        return {
          gameIndex,
          playerCount,
          winner: state.winner,
          steps: step,
          initialRoles,
          finalRoles,
          winnerPlayerIds: [...state.winnerPlayerIds],
          friendlyFireCount,
          infectedAtEnd,
          thingSurvived,
          firstInfectionTurn,
          thingTeamAttacks,
          humanAttacks,
          thingTeamAntiAnalysis,
          cardsByRole,
        };
      }

      const action = chooseAction(state, roomCode);
      const nextState = gameReducer(state, action);

      if (nextState === state) {
        throw new Error(`Reducer rejected action ${JSON.stringify(action)} at step=${state.step}, pending=${state.pendingAction?.type ?? 'none'}`);
      }

      // Track global turn increments
      if (nextState.currentPlayerIndex !== lastCurrentPlayerIndex) {
        globalTurn++;
        lastCurrentPlayerIndex = nextState.currentPlayerIndex;
      }

      // Detect first infection by comparing roles (infection happens on trade, not a played card)
      if (firstInfectionTurn === null) {
        const prevInfectedIds = new Set(state.players.filter((p) => p.role === 'infected').map((p) => p.id));
        const newlyInfected = nextState.players.find((p) => p.role === 'infected' && !prevInfectedIds.has(p.id));
        if (newlyInfected) firstInfectionTurn = globalTurn;
      }

      // Scan new log entries for attacks and defense events
      for (const entry of nextState.log) {
        if (entry.id <= lastSeenLogId) break;

        if (entry.fromPlayerId !== undefined) {
          const attacker = state.players.find((p) => p.id === entry.fromPlayerId);
          const attackerRole = attacker?.role ?? 'human';
          const isThingTeam = attackerRole === 'thing' || attackerRole === 'infected';

          if (entry.cardDefId === 'flamethrower' || entry.cardDefId === 'necronomicon') {
            if (entry.targetPlayerId !== undefined) {
              const target = state.players.find((p) => p.id === entry.targetPlayerId);
              if (isThingTeam) {
                thingTeamAttacks++;
              } else {
                humanAttacks++;
                if (target?.role === 'human') friendlyFireCount++;
              }
            }
          }

          if (entry.cardDefId === 'anti_analysis' && isThingTeam) {
            thingTeamAntiAnalysis++;
          }

          // Per-card tracking by role
          if (entry.cardDefId) {
            const roleKey = attackerRole === 'thing' || attackerRole === 'infected' ? attackerRole : 'human';
            cardsByRole[roleKey][entry.cardDefId] = (cardsByRole[roleKey][entry.cardDefId] ?? 0) + 1;
          }
        }
      }
      lastSeenLogId = nextState.log[0]?.id ?? lastSeenLogId;

      state = nextState;
    }

    throw new Error(`Simulation exceeded max actions (${maxActions})`);
  } finally {
    clearRoomMemory(roomCode);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const results: SimulationGameResult[] = [];
  const reportDirSet = new Set([
    path.dirname(options.jsonOut),
    path.dirname(options.markdownOut),
  ]);

  for (const reportDir of reportDirSet) {
    await fs.mkdir(reportDir, { recursive: true });
  }

  const originalConsoleLog = console.log;
  if (!options.verbose) {
    console.log = () => undefined;
  }

  try {
    for (let gameIndex = 0; gameIndex < options.games; gameIndex++) {
      const playerCount = options.players[gameIndex % options.players.length];
      const result = runSingleSimulation(playerCount, gameIndex, options.maxActions, options.mode);
      results.push(result);

      if (originalConsoleLog && ((gameIndex + 1) % 10 === 0 || gameIndex === options.games - 1)) {
        originalConsoleLog(`[bot-sim] completed ${gameIndex + 1}/${options.games} games`);
      }
    }
  } finally {
    console.log = originalConsoleLog;
  }

  const summary = buildSummary(results);
  const payload = {
    generatedAt: new Date().toISOString(),
    options,
    summary,
    results,
  };

  await fs.writeFile(options.jsonOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(options.markdownOut, toMarkdown(summary, results, options), 'utf8');

  originalConsoleLog(formatSummary(summary));
  for (const line of correlationAnalysis(results)) {
    originalConsoleLog(line);
  }
  originalConsoleLog(`JSON report: ${options.jsonOut}`);
  originalConsoleLog(`Markdown report: ${options.markdownOut}`);
}

await main();
