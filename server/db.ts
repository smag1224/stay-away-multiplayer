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
  )
`);

const stmtUpsert = db.prepare(`
  INSERT INTO rooms (code, data, updated_at)
  VALUES (@code, @data, @updatedAt)
  ON CONFLICT(code) DO UPDATE SET
    data       = excluded.data,
    updated_at = excluded.updated_at
`);

const stmtDelete = db.prepare(`DELETE FROM rooms WHERE code = ?`);
const stmtAll    = db.prepare(`SELECT data FROM rooms`);

export function saveRoom(room: { code: string; updatedAt: number }): void {
  try {
    stmtUpsert.run({ code: room.code, data: JSON.stringify(room), updatedAt: room.updatedAt });
  } catch (err) {
    console.error(`[db] Failed to save room ${room.code}:`, err);
  }
}

export function deleteRoom(code: string): void {
  try {
    stmtDelete.run(code);
  } catch (err) {
    console.error(`[db] Failed to delete room ${code}:`, err);
  }
}

export function loadAllRooms<T>(): T[] {
  try {
    return (stmtAll.all() as { data: string }[]).map(row => JSON.parse(row.data) as T);
  } catch (err) {
    console.error('[db] Failed to load rooms:', err);
    return [];
  }
}
