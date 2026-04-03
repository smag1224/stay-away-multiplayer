# Claude Context

## Package Manager
- Use `npm`
- Core commands: `npm test`, `npm run build`, `npm run bot:simulate`, `npx playwright test`

## Project Map
- Frontend: `src/` (React 19 + TypeScript + Vite)
- Server: `server/server.ts`
- Game reducer/state: `server/game/`
- Bot AI: `server/bot/`
- Reports/harness: `reports/`, `scripts/simulate_bot_games.ts`

## Session Context (2026-04-04)
- Phase 3 E2E is in place with Playwright for connect/lobby flows, spectator join, room cleanup, and full-game API scenarios for 6/7/9 players.
- CI/E2E scaffolding exists in `.github/`, `e2e/`, and `playwright.config.ts`.
- Phase 4 WebSockets is done: room sync now uses `ws` on `/api/rooms/{CODE}/ws?sessionId=...` with reconnect and HTTP fallback.
- WebSocket-related code lives in `server/server.ts`, `src/App.tsx`, `src/appHelpers.ts`, `package.json`, and `package-lock.json`.
- `PLAN.md` already marks WebSockets complete.

## Bot AI Work Done Today
- Added offline bot simulation harness: `npm run bot:simulate`
- Reports are written to `reports/bot-balance-latest.json` and `reports/bot-balance-latest.md`
- Added strategic bot layer in `server/bot/strategy.ts`
- Integrated strategic bias into `server/bot/evaluator.ts`
- Expanded bot tests in `server/bot/__tests__/evaluatorDecision.test.ts`
- Updated `server/bot/config.ts` to remove early Thing passivity:
  - `THING_SAFE_TURNS = 0`
  - `THING_AGGRESSIVE_TURNS = 6`
- Important user preference: `thing` should infect as soon as it reasonably can, not wait for the "best" hidden timing
- Human bots were also improved so they do not prefer empty repositioning over direct attack on a confirmed enemy

## Current Bot State
- Intelligence work is preferred over forced win-rate balance
- Latest verified simulation after the strategic-layer changes:
  - 30 games, 6/7/9 players
  - Humans 86.7%
  - Thing team 13.3%
  - Thing solo 0.0%
- This is imbalanced, but matches the current priority: smarter behavior first

## Verified Today
- `npm test` -> 95 passed
- `npm run build` passed earlier in this session
- `npx playwright test --reporter=line` passed earlier in this session

## Next Logical Step
- Continue Phase 4 with Ranked Games
- If focusing on bots again, strengthen Thing decision quality without reintroducing "wait to infect" behavior

## Working Notes
- The git worktree is already dirty; do not revert unrelated user changes
- Ignore `tmp_pptx/` unless the user explicitly asks about it
