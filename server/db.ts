import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'rooms.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    elo           INTEGER NOT NULL DEFAULT 1000,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    room_code    TEXT NOT NULL,
    role         TEXT NOT NULL,
    result       TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    elo_before   INTEGER NOT NULL,
    elo_after    INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_results_user ON game_results(user_id);
`);

// ── Rooms ────────────────────────────────────────────────────────────────────

const stmtRoomUpsert = db.prepare(`
  INSERT INTO rooms (code, data, updated_at)
  VALUES (@code, @data, @updatedAt)
  ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
const stmtRoomDelete = db.prepare(`DELETE FROM rooms WHERE code = ?`);
const stmtRoomAll    = db.prepare(`SELECT data FROM rooms`);

export function saveRoom(room: { code: string; updatedAt: number }): void {
  try {
    stmtRoomUpsert.run({ code: room.code, data: JSON.stringify(room), updatedAt: room.updatedAt });
  } catch (err) {
    console.error(`[db] Failed to save room ${room.code}:`, err);
  }
}

export function deleteRoom(code: string): void {
  try {
    stmtRoomDelete.run(code);
  } catch (err) {
    console.error(`[db] Failed to delete room ${code}:`, err);
  }
}

export function loadAllRooms<T>(): T[] {
  try {
    return (stmtRoomAll.all() as { data: string }[]).map(row => JSON.parse(row.data) as T);
  } catch (err) {
    console.error('[db] Failed to load rooms:', err);
    return [];
  }
}

// ── Users ────────────────────────────────────────────────────────────────────

export type DbUser = {
  id: number;
  username: string;
  password_hash: string;
  elo: number;
  created_at: number;
};

const stmtUserInsert    = db.prepare(`INSERT INTO users (username, password_hash, elo, created_at) VALUES (@username, @password_hash, 1000, @created_at)`);
const stmtUserById      = db.prepare(`SELECT * FROM users WHERE id = ?`);
const stmtUserByName    = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`);
const stmtUserUpdateElo = db.prepare(`UPDATE users SET elo = ? WHERE id = ?`);

export function createUser(username: string, passwordHash: string): DbUser {
  const info = stmtUserInsert.run({ username, password_hash: passwordHash, created_at: Date.now() });
  return stmtUserById.get(info.lastInsertRowid) as DbUser;
}

export function getUserById(id: number): DbUser | null {
  return (stmtUserById.get(id) as DbUser | undefined) ?? null;
}

export function getUserByName(username: string): DbUser | null {
  return (stmtUserByName.get(username) as DbUser | undefined) ?? null;
}

export function updateUserElo(userId: number, elo: number): void {
  stmtUserUpdateElo.run(elo, userId);
}

// ── Game Results ─────────────────────────────────────────────────────────────

export type DbGameResult = {
  id: number;
  user_id: number;
  room_code: string;
  role: string;
  result: string;
  player_count: number;
  elo_before: number;
  elo_after: number;
  created_at: number;
};

export type UserStats = {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  elo: number;
  byRole: {
    human:   { played: number; wins: number };
    thing:   { played: number; wins: number };
    infected:{ played: number; wins: number };
  };
  recentGames: Array<{ role: string; result: string; playerCount: number; eloChange: number; createdAt: number }>;
};

const stmtResultInsert = db.prepare(`
  INSERT INTO game_results (user_id, room_code, role, result, player_count, elo_before, elo_after, created_at)
  VALUES (@user_id, @room_code, @role, @result, @player_count, @elo_before, @elo_after, @created_at)
`);

const stmtResultsByUser = db.prepare(`
  SELECT * FROM game_results WHERE user_id = ? ORDER BY created_at DESC
`);

export function recordGameResult(params: {
  userId: number;
  roomCode: string;
  role: string;
  result: 'win' | 'loss';
  playerCount: number;
  eloBefore: number;
  eloAfter: number;
}): void {
  stmtResultInsert.run({
    user_id: params.userId,
    room_code: params.roomCode,
    role: params.role,
    result: params.result,
    player_count: params.playerCount,
    elo_before: params.eloBefore,
    elo_after: params.eloAfter,
    created_at: Date.now(),
  });
}

export function getUserStats(userId: number, currentElo: number): UserStats {
  const rows = stmtResultsByUser.all(userId) as DbGameResult[];
  const byRole = {
    human:    { played: 0, wins: 0 },
    thing:    { played: 0, wins: 0 },
    infected: { played: 0, wins: 0 },
  };
  let wins = 0;
  for (const r of rows) {
    if (r.result === 'win') wins++;
    const key = r.role as keyof typeof byRole;
    if (byRole[key]) {
      byRole[key].played++;
      if (r.result === 'win') byRole[key].wins++;
    }
  }
  return {
    gamesPlayed: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: rows.length ? wins / rows.length : 0,
    elo: currentElo,
    byRole,
    recentGames: rows.slice(0, 10).map(r => ({
      role: r.role,
      result: r.result,
      playerCount: r.player_count,
      eloChange: r.elo_after - r.elo_before,
      createdAt: r.created_at,
    })),
  };
}

export function getCompactStats(userId: number, elo: number): { elo: number; winRate: number; gamesPlayed: number } {
  const rows = stmtResultsByUser.all(userId) as DbGameResult[];
  const wins = rows.filter(r => r.result === 'win').length;
  return { elo, winRate: rows.length ? wins / rows.length : 0, gamesPlayed: rows.length };
}
