import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifiedStatisticsContext = {
  v: 1;
  companyId: string;
  userId: string;
  from: string;
  to: string;
  timezone: string;
  bucket: string;
  issuedAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;

export function verifyStatisticsContext(
  token: string,
  secret: string | undefined,
  now = Date.now(),
): VerifiedStatisticsContext | null {
  if (!secret || secret.trim().length < 32 || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, suppliedSignature] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) {
    return null;
  }

  const expected = createHmac('sha256', secret).update(encoded).digest();
  const supplied = Buffer.from(suppliedSignature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as
      Partial<VerifiedStatisticsContext>;
    if (
      data.v !== 1 ||
      typeof data.companyId !== 'string' || !UUID.test(data.companyId) ||
      typeof data.userId !== 'string' || !UUID.test(data.userId) ||
      typeof data.from !== 'string' || data.from.length > 100 ||
      typeof data.to !== 'string' || data.to.length > 100 ||
      typeof data.timezone !== 'string' || data.timezone.length > 100 ||
      typeof data.bucket !== 'string' || data.bucket.length > 20 ||
      !Number.isSafeInteger(data.issuedAt) ||
      data.issuedAt! > now + MAX_FUTURE_SKEW_MS ||
      now - data.issuedAt! > MAX_AGE_MS
    ) return null;
    return data as VerifiedStatisticsContext;
  } catch {
    return null;
  }
}
