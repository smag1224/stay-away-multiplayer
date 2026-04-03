import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-in-prod';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ── Password ────────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const derived = scryptSync(password, salt, 64);
  return hashBuf.length === derived.length && timingSafeEqual(hashBuf, derived);
}

// ── Token ────────────────────────────────────────────────────────────────────

export function signToken(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { userId: number } | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { userId: number; exp: number };
    if (Date.now() > exp) return null;
    return { userId };
  } catch {
    return null;
  }
}

// ── ELO ─────────────────────────────────────────────────────────────────────

const K = 32;

export function calcElo(myElo: number, opponentAvgElo: number, won: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (opponentAvgElo - myElo) / 400));
  return Math.round(myElo + K * ((won ? 1 : 0) - expected));
}
