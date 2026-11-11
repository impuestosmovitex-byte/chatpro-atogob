import { createHmac } from 'node:crypto';

/**
 * Server-to-server assertion for read-only statistics requests.
 * This must never be imported by a Client Component or sent to browsers.
 */
export type StatisticsContext = {
  v: 1;
  companyId: string;
  userId: string;
  from: string;
  to: string;
  timezone: string;
  bucket: string;
  issuedAt: number;
};

export function createStatisticsContext(
  fields: Omit<StatisticsContext, 'v' | 'issuedAt'>,
  secret: string,
  issuedAt = Date.now(),
): string {
  if (secret.trim().length < 32) {
    throw new Error('Falta MW1_STATS_CONTEXT_SECRET (32 caracteres o más).');
  }
  const payload: StatisticsContext = { v: 1, ...fields, issuedAt };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
