# Stay Away! — Development Plan

This file tracks the full development roadmap. Check off items as they are completed.
Intended to be readable by any AI assistant (Claude, Codex, etc.) picking up this work.

---

## Phase 1 — Stability

### 1. Room Cleanup (TTL for empty rooms) ✅
- [x] Add idle/empty room expiration (e.g. 1 hour after all players leave)
- [x] Periodic cleanup loop on the server (every 5 minutes)
- [x] Log when a room is cleaned up
- [x] Tiered TTL: 5m (0 members), 1h (0 connected), 12h (stale)

### 2. Restart Without Losing State ✅
- [x] Persist room state to SQLite (better-sqlite3, WAL mode) on every state change
- [x] Load persisted state on server startup
- [x] Errors are caught and logged — stale/corrupt rows are skipped silently
- [x] data/ excluded from git

### 3. Spectator Mode ✅
- [x] isSpectator flag on RoomMember (server) and RoomMemberView (client)
- [x] /join accepts spectator:true — bypasses game-running check
- [x] sanitizeGame reveals all cards + roles to watchers
- [x] /action blocked for spectators
- [x] 'Watch the game' button shown in ConnectScreen when join fails with 'already started'
- [x] Watcher uses sentinel me (id=-999), sees full GameScreen in read-only mode
- [x] Spectator banner shown (reuses existing UI)

---

## Phase 2 — Database & Accounts

### 4. Database (SQLite) ✅
- [x] SQLite via better-sqlite3, WAL mode
- [x] Tables: rooms, users, game_results

### 5. Player Accounts ✅
- [x] Register/login with scrypt password hashing + HMAC token (no deps)
- [x] 30-day token stored in localStorage
- [x] Guest mode fully preserved
- [x] /api/auth/register, /api/auth/login, /api/auth/me endpoints

### 6. Player Statistics ✅
- [x] Win/loss recorded per game per role
- [x] ELO updated after each game (team-based calc)
- [x] /api/users/:username/stats endpoint
- [x] Profile page: ELO, win rate, by-role bars, recent 10 games
- [x] Compact stats (ELO, winrate, games) shown in lobby next to player name

---

## Phase 3 — Quality

### 7. E2E Tests (Playwright, 6–9 bots)
- [x] Set up Playwright in the project
- [x] Test: full game with 6 players reaches `game_over`
- [x] Test: full game with 7 players reaches `game_over`
- [x] Test: full game with 9 players reaches `game_over`
- [x] Validate winner IDs and post-game room persistence in E2E
- [x] Test: spectator joins and sees game without acting
- [x] Test: host disconnects, room cleans up correctly
- [x] CI: run E2E on push to master

> Note: use 6–9 player counts — at 4 players many cards (panics, obstacles) are not in the deck.

### 8. Bot Balancing
- [x] Run automated games (100+ games) via test harness, record win rates by role
- [x] Tune weights in `server/bot/config.ts` based on results
- [ ] Target win rate: ~50% humans, ~35% thing, ~15% infected solo
- [x] Document final weights and rationale

> Current status (2026-04-04): offline harness added via `npm run bot:simulate`, reports written to `reports/bot-balance-latest.{json,md}`.
> Baseline after Codex changes (THING_SAFE_TURNS=0): Humans 86.7%, Thing team 13.3%, Thing solo 0.0%.
> After Claude intelligence improvements: Humans ~83-85%, Thing team ~15-17%, Thing solo 0.0% (120-game runs).
>
> Intelligence improvements made (2026-04-04):
> - **Critical fix**: Strategic bias layer was overriding Thing's safe period — `strategicCardBonus`/`strategicTargetBonus` now respect `THING_SAFE_TURNS` and actively suppress infection bonuses during stealth phase.
> - `THING_SAFE_TURNS = 3`, `THING_AGGRESSIVE_TURNS = 9` — Thing waits ~3 global turns before infecting, then escalates.
> - Higher base infection scores after safe period: 12 (transition) / 18 (aggressive phase).
> - Human analysis now scales with suspicion level: very suspicious players get +10 analysis score bonus.
> - Human flamethrower: +4 bonus vs high-suspicion uncleaned targets.
> - Depth-2 transitive infection chain tracking in memory.ts: if A→B→C and C confirmed infected, A also gets a suspicion bump.
> - Thing bluff weights tripled: `bluffAnalyzeInfected = 5`, `bluffFlamethrowerInfected = 6`, `bluffQuarantineAlly = 4`.
> - Thing quarantine now prioritizes dangerous humans with flamethrower/analysis cards.
> - `defendAntiAnalysis` raised: Thing=9, Infected=8 (was 7/6).
> - Infected reload: score for giving infected back to the Thing raised to 12 (was 3).
> - Thing's infection target scoring penalizes flamethrower holders and quarantined targets more precisely.
> - Depth-2 infection chain weights raised: `infectionChainPartner = 0.30`, `multipleInfectedPartners = 0.40`.
> - Human `playAnalysis = 14`, `playFlamethrower = 14` (was 12/12), `playQuarantine = 7` (was 6.5).

---

## Phase 4 — Scale

### 9. WebSockets
- [x] Replace polling (`GET /api/rooms/{CODE}`) with WebSocket connection
- [x] Server pushes state updates to all clients in the room on every change
- [x] Keep REST fallback or remove polling entirely
- [x] Update client to use WS connection (reconnect logic, heartbeat)
- [x] Update bot scheduling to work with WS-based flow

> Current status (2026-04-04): room sync now uses `ws` on `/api/rooms/{CODE}/ws?sessionId=...`, with client-side reconnect and HTTP fallback polling if the socket drops.
> Server broadcasts room snapshots on joins, leaves, kicks, actions, bot turns, and shout updates; heartbeat uses WebSocket ping/pong every 30s.

### 10. Ranked Games
- [ ] ELO rating system (separate rating per role or unified)
- [ ] Ranked vs. casual room toggle
- [ ] Leaderboard API + UI
- [ ] Match history (per account)

### 11. Mobile App
- [ ] Wrap frontend with Capacitor (iOS + Android)
- [ ] Handle touch UX differences (larger tap targets, swipe gestures)
- [ ] App store build pipeline
- [ ] Push notifications (your turn, game starting)

---

## Notes for the next AI picking this up

- Stack: React 19 + TypeScript + Vite (frontend), Node.js HTTP server (backend), no framework
- Game logic lives in `server/game/` — pure reducer pattern, immutable state
- Bot AI lives in `server/bot/` — fair bot (no cheating), heuristic-based
- Room state is persisted to SQLite via `better-sqlite3` (`data/rooms.db`)
- Tests: `npm test` runs Vitest unit tests, `npx playwright test` runs E2E
- Deploy target: Render.com (see build logs in project history)
- Language: Russian UI + English UI (i18next), code is in English
- Phase 3 E2E covers connect/lobby smoke, full-game API scenarios for 6/7/9 players, spectator join, lobby leave cleanup, and CI execution on push/PR
- Last verified locally on 2026-04-04: `npm test`, `npm run build`, and `npx playwright test --reporter=line`
