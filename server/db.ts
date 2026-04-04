import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { supabase } from './supabase.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'rooms.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// ── Rooms (SQLite — local, ephemeral, high-frequency writes) ─────────────────

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

// ── Users (Supabase PostgreSQL — persistent, cross-deployment) ───────────────

export type DbUser = {
  id: number;
  username: string;
  password_hash: string;
  elo: number;
  created_at: number;
};

export async function createUser(username: string, passwordHash: string): Promise<DbUser> {
  const { data, error } = await supabase
    .from('users')
    .insert({ username, password_hash: passwordHash, elo: 1000, created_at: Date.now() })
    .select()
    .single();
  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return data as DbUser;
}

export async function getUserById(id: number): Promise<DbUser | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as DbUser | null) ?? null;
}

export async function getUserByName(username: string): Promise<DbUser | null> {
  // citext column handles case-insensitive comparison natively
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();
  return (data as DbUser | null) ?? null;
}

export async function updateUserElo(userId: number, elo: number): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ elo })
    .eq('id', userId);
  if (error) console.error('[db] Failed to update elo:', error.message);
}

// ── Game Results (Supabase PostgreSQL) ───────────────────────────────────────

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
    human:    { played: number; wins: number };
    thing:    { played: number; wins: number };
    infected: { played: number; wins: number };
  };
  recentGames: Array<{ role: string; result: string; playerCount: number; eloChange: number; createdAt: number }>;
};

export async function recordGameResult(params: {
  userId: number;
  roomCode: string;
  role: string;
  result: 'win' | 'loss';
  playerCount: number;
  eloBefore: number;
  eloAfter: number;
}): Promise<void> {
  const { error } = await supabase.from('game_results').insert({
    user_id: params.userId,
    room_code: params.roomCode,
    role: params.role,
    result: params.result,
    player_count: params.playerCount,
    elo_before: params.eloBefore,
    elo_after: params.eloAfter,
    created_at: Date.now(),
  });
  if (error) console.error('[db] Failed to record game result:', error.message);
}

export async function getUserStats(userId: number, currentElo: number): Promise<UserStats> {
  const { data, error } = await supabase
    .from('game_results')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch stats: ${error.message}`);
  const rows = (data ?? []) as DbGameResult[];

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

export async function getCompactStats(userId: number, elo: number): Promise<{ elo: number; winRate: number; gamesPlayed: number }> {
  const { data } = await supabase
    .from('game_results')
    .select('result')
    .eq('user_id', userId);
  const rows = (data ?? []) as { result: string }[];
  const wins = rows.filter(r => r.result === 'win').length;
  return { elo, winRate: rows.length ? wins / rows.length : 0, gamesPlayed: rows.length };
}
