import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { BetterChatConfig } from './config';

const SESSION_COOKIE_VERSION = 'v1';
const SESSION_COOKIE_IV_BYTES = 12;

type SessionCookiePayload = {
  authToken: string;
  displayName: string;
  exp: number;
  iat: number;
  userId: string;
  username: string;
  v: 1;
};

export type UpstreamSession = {
  authToken: string;
  createdAt: string;
  displayName: string;
  expiresAt: string;
  userId: string;
  username: string;
};

type SessionInput = Omit<UpstreamSession, 'createdAt' | 'expiresAt'>;

const encodeBase64Url = (value: Buffer): string => value.toString('base64url');
const decodeBase64Url = (value: string): Buffer => Buffer.from(value, 'base64url');

const sessionKeyMaterial = (secret: string): Buffer =>
  createHash('sha256').update(`betterchat-session:${secret}`).digest();

const toPayload = (session: UpstreamSession): SessionCookiePayload => ({
  v: 1,
  iat: Math.floor(Date.parse(session.createdAt) / 1_000),
  exp: Math.floor(Date.parse(session.expiresAt) / 1_000),
  userId: session.userId,
  authToken: session.authToken,
  username: session.username,
  displayName: session.displayName,
});

const fromPayload = (payload: SessionCookiePayload): UpstreamSession => ({
  userId: payload.userId,
  authToken: payload.authToken,
  username: payload.username,
  displayName: payload.displayName,
  createdAt: new Date(payload.iat * 1_000).toISOString(),
  expiresAt: new Date(payload.exp * 1_000).toISOString(),
});

const parsePayload = (input: unknown): SessionCookiePayload | undefined => {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  if (
    !('v' in input)
    || input.v !== 1
    || !('iat' in input)
    || typeof input.iat !== 'number'
    || !Number.isFinite(input.iat)
    || !('exp' in input)
    || typeof input.exp !== 'number'
    || !Number.isFinite(input.exp)
    || !('userId' in input)
    || typeof input.userId !== 'string'
    || input.userId.length === 0
    || !('authToken' in input)
    || typeof input.authToken !== 'string'
    || input.authToken.length === 0
    || !('username' in input)
    || typeof input.username !== 'string'
    || input.username.length === 0
    || !('displayName' in input)
    || typeof input.displayName !== 'string'
    || input.displayName.length === 0
  ) {
    return undefined;
  }

  return input as SessionCookiePayload;
};

export const buildSession = (
  config: BetterChatConfig,
  input: SessionInput,
  now: Date = new Date(),
): UpstreamSession => ({
  ...input,
  createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + config.sessionTtlSeconds * 1_000).toISOString(),
});

export const serializeSessionCookie = (config: BetterChatConfig, session: UpstreamSession): string => {
  const iv = randomBytes(SESSION_COOKIE_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', sessionKeyMaterial(config.sessionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(toPayload(session)), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [SESSION_COOKIE_VERSION, encodeBase64Url(iv), encodeBase64Url(ciphertext), encodeBase64Url(authTag)].join('.');
};

export const deserializeSessionCookie = (
  config: BetterChatConfig,
  cookieValue: string | undefined,
  now: Date = new Date(),
): UpstreamSession | undefined => {
  if (!cookieValue) {
    return undefined;
  }

  const [version, encodedIv, encodedCiphertext, encodedAuthTag, ...rest] = cookieValue.split('.');
  if (
    version !== SESSION_COOKIE_VERSION
    || !encodedIv
    || !encodedCiphertext
    || !encodedAuthTag
    || rest.length > 0
  ) {
    return undefined;
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', sessionKeyMaterial(config.sessionSecret), decodeBase64Url(encodedIv));
    decipher.setAuthTag(decodeBase64Url(encodedAuthTag));
    const plaintext = Buffer.concat([decipher.update(decodeBase64Url(encodedCiphertext)), decipher.final()]);
    const payload = parsePayload(JSON.parse(plaintext.toString('utf8')));

    if (!payload || payload.exp * 1_000 <= now.getTime()) {
      return undefined;
    }

    return fromPayload(payload);
  } catch {
    return undefined;
  }
};

export const sessionKeyFrom = (session: Pick<UpstreamSession, 'authToken'>): string =>
  createHash('sha256').update(`betterchat-realtime:${session.authToken}`).digest('hex').slice(0, 32);
