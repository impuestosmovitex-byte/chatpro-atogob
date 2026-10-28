import { createHmac, timingSafeEqual } from 'node:crypto';

export function validMetaSignature(body: Buffer, header: string | undefined, secret: string | undefined): boolean {
  if (!Buffer.isBuffer(body) || !secret || secret.length < 16 || !header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(header.substring(7), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
