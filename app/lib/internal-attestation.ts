import { createHash, randomBytes, sign } from 'node:crypto';

/** The private key lives ONLY in the web server environment. Never expose it
 * via NEXT_PUBLIC, logs or client-side bundles. */
export type InternalAction = {
  kind: 'user' | 'platform';
  userId: string;
  companyId: string;
  companySlug: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
};
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).filter(k => obj[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}
export function signInternalAttestation(action: InternalAction, now: number = Date.now()): string {
  const privateKey = process.env.MW1_INTERNAL_ATTESTATION_PRIVATE_KEY;
  if (!privateKey) throw new Error('Falta la clave privada de identidad entre servicios.');
  const iat = Math.floor(now / 1000);
  const { body, ...details } = action;
  const signed = {
    v: 1 as const, ...details, iat, exp: iat + 20,
    nonce: randomBytes(16).toString('hex'),
    bodyHash: createHash('sha256').update(canonical(body ?? null)).digest('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(signed)).toString('base64url');
  return encoded + '.' + sign(null, Buffer.from(encoded), privateKey).toString('base64url');
}
