import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

@Injectable()
export class AccessAuthService {
  hash(password: string): string {
    const salt = randomBytes(16).toString('base64url');
    const derived = scryptSync(password, salt, 64).toString('base64url');

    return `scrypt-v1:${salt}:${derived}`;
  }

  verify(password: string, storedHash: string): boolean {
    const [version, salt, encodedDigest] = storedHash.split(':');

    if (version !== 'scrypt-v1' || !salt || !encodedDigest) {
      return false;
    }

    try {
      const expected = Buffer.from(encodedDigest, 'base64url');
      const received = scryptSync(password, salt, expected.length);

      return (
        expected.length === received.length &&
        timingSafeEqual(expected, received)
      );
    } catch {
      return false;
    }
  }
}
