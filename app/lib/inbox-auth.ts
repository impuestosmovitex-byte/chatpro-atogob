export const INBOX_SESSION_COOKIE = 'chatpro_inbox_session';
export const INBOX_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ChatProSession = {
  type: 'user' | 'bootstrap';
  userId: string | null;
  companyId: string;
  companySlug: string;
  companyName: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  expiresAt: number;
};

type SessionPayload = Omit<ChatProSession, 'expiresAt'> & {
  v: 2;
  exp: number;
};

function getSessionSecret(): string {
  const secret = process.env.CHATPRO_INBOX_SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error('Falta CHATPRO_INBOX_SESSION_SECRET.');
  }

  return secret;
}

function getInboxPassword(): string {
  const password = process.env.CHATPRO_INBOX_PASSWORD?.trim();

  if (!password) {
    throw new Error('Falta CHATPRO_INBOX_PASSWORD.');
  }

  return password;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  );
}

export async function passwordMatches(value: string): Promise<boolean> {
  const expected = await digest(getInboxPassword());
  const received = await digest(value);

  if (expected.length !== received.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ received[index];
  }

  return difference === 0;
}

export async function createInboxSessionToken(
  session: Omit<ChatProSession, 'expiresAt'>,
): Promise<string> {
  const expiresAt = Date.now() + INBOX_SESSION_MAX_AGE_SECONDS * 1000;
  const payload: SessionPayload = { v: 2, exp: expiresAt, ...session };
  const encodedPayload = toBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const signedValue = `v2.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    encoder.encode(signedValue),
  );

  return `${signedValue}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function getInboxSession(
  token: string | null | undefined,
): Promise<ChatProSession | null> {
  if (!token) {
    return null;
  }

  const parts = token.split('.');

  if (parts.length !== 3 || parts[0] !== 'v2') {
    return null;
  }

  const signature = fromBase64Url(parts[2]);

  if (!signature) {
    return null;
  }

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(),
      signature.buffer.slice(
        signature.byteOffset,
        signature.byteOffset + signature.byteLength,
      ) as ArrayBuffer,
      encoder.encode(`v2.${parts[1]}`),
    );

    if (!valid) {
      return null;
    }

    const encoded = fromBase64Url(parts[1]);

    if (!encoded) {
      return null;
    }

    const payload = JSON.parse(decoder.decode(encoded)) as SessionPayload;

    if (
      payload.v !== 2 ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Date.now() ||
      (payload.type !== 'user' && payload.type !== 'bootstrap') ||
      typeof payload.companyId !== 'string' ||
      typeof payload.companySlug !== 'string' ||
      typeof payload.companyName !== 'string' ||
      typeof payload.fullName !== 'string' ||
      typeof payload.roleKey !== 'string' ||
      typeof payload.roleName !== 'string' ||
      (payload.userId !== null && typeof payload.userId !== 'string')
    ) {
      return null;
    }

    return {
      type: payload.type,
      userId: payload.userId,
      companyId: payload.companyId,
      companySlug: payload.companySlug,
      companyName: payload.companyName,
      fullName: payload.fullName,
      roleKey: payload.roleKey,
      roleName: payload.roleName,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export async function isInboxSessionValid(
  token: string | null | undefined,
): Promise<boolean> {
  return Boolean(await getInboxSession(token));
}
