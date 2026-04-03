import fs from 'node:fs/promises';
import path from 'node:path';
import { createInitialState, gameReducer } from '../src/gameLogic/index.ts';
import type { GameAction, GameState, PendingAction, Role } from '../src/types.ts';
import { decideBotAction, clearRoomMemory } from '../server/bot/index.ts';

type Winner = NonNullable<GameState['winner']>;

type CliOptions = {
  games: number;
  players: number[];
  maxActions: number;
  jsonOut: string;
  markdownOut: string;
  verbose: boolean;
};

type SimulationGameResult = {
  gameIndex: number;
  playerCount: number;
  winner: Winner;
  steps: number;
  initialRoles: Array<{ playerId: number; role: Role }>;
  finalRoles: Array<{ playerId: number; role: Role }>;
  winnerPlayerIds: number[];
};

type AggregateStats = {
  totalGames: number;
  totalSteps: number;
  averageSteps: number;
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
  };
}

function startBotOnlyGame(playerCount: number): GameState {
  const playerNames = Array.from({ length: playerCount }, (_, index) => `Bot ${index + 1}`);
  const started = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames,
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

  for (const result of results) {
    byWinner[result.winner].wins += 1;
    totalSteps += result.steps;

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
    byWinner,
    byPlayerCount,
    roleWinRates,
  };
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
    `- Avg. actions per game: ${summary.averageSteps.toFixed(1)}`,
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
  ].join('\n');
}

function runSingleSimulation(playerCount: number, gameIndex: number, maxActions: number): SimulationGameResult {
  const roomCode = `sim_${playerCount}_${gameIndex}`;
  let state = startBotOnlyGame(playerCount);
  const initialRoles = state.players.map((player) => ({ playerId: player.id, role: player.role }));

  try {
    for (let step = 0; step < maxActions; step++) {
      if (state.phase === 'game_over' && state.winner) {
        return {
          gameIndex,
          playerCount,
          winner: state.winner,
          steps: step,
          initialRoles,
          finalRoles: state.players.map((player) => ({ playerId: player.id, role: player.role })),
          winnerPlayerIds: [...state.winnerPlayerIds],
        };
      }

      const action = chooseAction(state, roomCode);
      const nextState = gameReducer(state, action);

      if (nextState === state) {
        throw new Error(`Reducer rejected action ${JSON.stringify(action)} at step=${state.step}, pending=${state.pendingAction?.type ?? 'none'}`);
      }

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
      const result = runSingleSimulation(playerCount, gameIndex, options.maxActions);
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
  originalConsoleLog(`JSON report: ${options.jsonOut}`);
  originalConsoleLog(`Markdown report: ${options.markdownOut}`);
}

await main();
