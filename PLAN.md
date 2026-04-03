# Stay Away! — Development Plan

This file tracks the full development roadmap. Check off items as they are completed.
Intended to be readable by any AI assistant (Claude, Codex, etc.) picking up this work.

---

## Phase 1 — Stability

### 1. Room Cleanup (TTL for empty rooms)
- [ ] Add idle/empty room expiration (e.g. 1 hour after all players leave)
- [ ] Periodic cleanup loop on the server (every 10–15 minutes)
- [ ] Log when a room is cleaned up

### 2. Restart Without Losing State
- [ ] Persist room state to disk (JSON file or SQLite) on every state change
- [ ] Load persisted state on server startup
- [ ] Handle schema version mismatches gracefully (ignore stale/incompatible saves)

### 3. Spectator Mode
- [ ] Add `spectator` role to RoomMember (cannot act, sees full table)
- [ ] Separate spectator join endpoint or flag on `/join`
- [ ] RoomView for spectators: show all hands face-down (or face-up post-game)
- [ ] UI: spectator badge, separate list from active players
- [ ] Spectators do not count toward player count or win conditions

---

## Phase 2 — Database & Accounts

### 4. Database (PostgreSQL or SQLite)
- [ ] Choose and set up DB (SQLite for simplicity, Postgres for production)
- [ ] Schema: rooms, players, sessions, games, game_events
- [ ] Migrate in-memory room state to DB-backed storage
- [ ] Connection pool + graceful shutdown

### 5. Player Accounts
- [ ] Registration / login (username + password, bcrypt)
- [ ] JWT or session-cookie auth
- [ ] Guest mode (no account, no stats tracked)
- [ ] Profile page (avatar, display name)

### 6. Player Statistics
- [ ] Track per-account: games played, wins, losses, by role (human / thing / infected)
- [ ] Track: cards played, eliminations, times eliminated
- [ ] Stats API endpoint
- [ ] Stats display in UI (profile screen)

---

## Phase 3 — Quality

### 7. E2E Tests (Playwright, 6–9 bots)
- [ ] Set up Playwright in the project
- [ ] Test: full game with 6 bots (human wins)
- [ ] Test: full game with 7 bots (thing wins)
- [ ] Test: full game with 9 bots (mixed, goes to end)
- [ ] Test: spectator joins and sees game without acting
- [ ] Test: host disconnects, room cleans up correctly
- [ ] CI: run E2E on push to master

> Note: use 6–9 player counts — at 4 players many cards (panics, obstacles) are not in the deck.

### 8. Bot Balancing
- [ ] Run automated games (100+ games) via test harness, record win rates by role
- [ ] Tune weights in `server/bot/config.ts` based on results
- [ ] Target win rate: ~50% humans, ~35% thing, ~15% infected solo
- [ ] Document final weights and rationale

---

## Phase 4 — Scale

### 9. WebSockets
- [ ] Replace polling (`GET /api/rooms/{CODE}`) with WebSocket connection
- [ ] Server pushes state updates to all clients in the room on every change
- [ ] Keep REST fallback or remove polling entirely
- [ ] Update client to use WS connection (reconnect logic, heartbeat)
- [ ] Update bot scheduling to work with WS-based flow

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
- All room state is currently **in-memory only** — Phase 1 item 2 fixes this
- Tests: `npm test` runs Vitest unit tests; no E2E yet
- Deploy target: Render.com (see build logs in project history)
- Language: Russian UI + English UI (i18next), code is in English
- Start with Phase 1 items in order — they are prerequisites for everything else
