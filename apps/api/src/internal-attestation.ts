import { createHash, verify } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

/** SEG-003C. Verification only: private signing key must NEVER be on the API.
 * This adds an independent proof of a verified web session to the shared
 * internal key. Requires a separately provisioned Ed25519 key pair.
 */
export type InternalPrincipal = {
  kind: 'user' | 'platform';
  userId: string;
  companyId: string;
  companySlug: string;
};
export type InternalAction = InternalPrincipal & {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
};
type Assertion = Omit<InternalAction, 'body'> & {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
  bodyHash: string;
};
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).filter(k => obj[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}
const hash = (body: unknown) =>
  createHash('sha256').update(canonical(body ?? null)).digest('hex');

export function verifyInternalAttestation(
  assertion: string | undefined,
  expected: InternalAction,
  now: number = Date.now(),
): void {
  const publicKey = process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
  if (!publicKey || !assertion || assertion.length > 8192)
    throw new UnauthorizedException('Falta la autenticación de servicio.');
  const parts = assertion.split('.');
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p)))
    throw new UnauthorizedException('Autenticación de servicio inválida.');
  let signed: Assertion;
  try {
    const bytes = Buffer.from(parts[0], 'base64url');
    if (bytes.length > 4096) throw new Error('claim too large');
    signed = JSON.parse(bytes.toString('utf8'));
    const valid = verify(null, Buffer.from(parts[0]), publicKey,
      Buffer.from(parts[1], 'base64url'));
    if (!valid) throw new Error('invalid signature');
  } catch {
    throw new UnauthorizedException('Firma de servicio inválida.');
  }
  const timestamp = Math.floor(now / 1000);
  if (!signed || signed.v !== 1 ||
    !Number.isInteger(signed.iat) || !Number.isInteger(signed.exp) ||
    signed.iat > timestamp + 5 || signed.iat < timestamp - 30 ||
    signed.exp <= timestamp || signed.exp > signed.iat + 20 ||
    !/^[a-f0-9]{32}$/.test(signed.nonce) ||
    (signed.kind !== 'user' && signed.kind !== 'platform') ||
    !signed.userId || !signed.path || !signed.bodyHash)
    throw new UnauthorizedException('Afirmación de servicio vencida o inválida.');
  const required = {
    kind: expected.kind, userId: expected.userId,
    companyId: expected.companyId, companySlug: expected.companySlug,
    method: expected.method, path: expected.path, bodyHash: hash(expected.body),
  };
  for (const [key, val] of Object.entries(required))
    if (signed[key as keyof Assertion] !== val)
      throw new UnauthorizedException('La afirmación no corresponde a esta solicitud.');
}
