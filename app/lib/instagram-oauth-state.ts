import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type InstagramState = {
  companyId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
};

function secret(): string {
  const value = process.env.MW1_INSTAGRAM_OAUTH_STATE_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error('Falta una clave segura para el estado OAuth de Instagram.');
  }
  return value;
}

export function createInstagramOAuthState(companyId: string, userId: string): string {
  if (!companyId || !userId) throw new Error('Sesión incompleta.');
  const payload: InstagramState = {
    companyId,
    userId,
    nonce: randomBytes(24).toString('base64url'),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret()).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

export function verifyInstagramOAuthState(
  token: string,
  companyId: string,
  userId: string,
  maxAgeMs = 10 * 60 * 1000,
): InstagramState | null {
  const pieces = token.split('.');
  if (pieces.length !== 2 || token.length > 2048) return null;
  const [encoded, supplied] = pieces;
  if (!encoded || !supplied) return null;
  const expected = createHmac('sha256', secret()).update(encoded).digest();
  let provided: Buffer;
  try { provided = Buffer.from(supplied, 'base64url'); }
  catch { return null; }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as InstagramState;
  if (state.companyId !== companyId || state.userId !== userId ||
      typeof state.nonce !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(state.nonce) ||
      !Number.isSafeInteger(state.issuedAt) ||
      state.issuedAt > Date.now() || Date.now() - state.issuedAt > maxAgeMs) return null;
  return state;
}
