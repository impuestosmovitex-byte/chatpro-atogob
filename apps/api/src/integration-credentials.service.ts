import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

type JsonObject = Record<string, unknown>;

@Injectable()
export class IntegrationCredentialsService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyEnvName = 'CHATPRO_INTEGRATIONS_ENCRYPTION_KEY';

  encrypt(value: JsonObject): string {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, key, iv);
    const plainText = Buffer.from(JSON.stringify(value), 'utf8');

    const encrypted = Buffer.concat([
      cipher.update(plainText),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string): JsonObject {
    const parts = value.trim().split('.');

    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('El formato de credenciales cifradas no es válido.');
    }

    const [, ivValue, tagValue, encryptedValue] = parts;
    const key = this.getKey();
    const decipher = createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

    const decoded = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    const parsed: unknown = JSON.parse(decoded);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Las credenciales descifradas no tienen un formato válido.');
    }

    return parsed as JsonObject;
  }

  private getKey(): Buffer {
    const raw = process.env[this.keyEnvName]?.trim();

    if (!raw) {
      throw new Error(
        `Falta ${this.keyEnvName} en Railway para guardar credenciales de integraciones.`,
      );
    }

    let key: Buffer;

    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      throw new Error(
        `${this.keyEnvName} debe estar codificada en base64.`,
      );
    }

    if (key.length !== 32) {
      throw new Error(
        `${this.keyEnvName} debe contener exactamente 32 bytes en base64.`,
      );
    }

    return key;
  }
}
