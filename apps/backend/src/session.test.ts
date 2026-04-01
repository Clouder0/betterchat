import { describe, expect, test } from 'bun:test';

import type { BetterChatConfig } from './config';
import { buildSession, deserializeSessionCookie, serializeSessionCookie, sessionKeyFrom } from './session';

const config: BetterChatConfig = {
  host: '127.0.0.1',
  port: 3200,
  upstreamUrl: 'http://127.0.0.1:3100',
  upstreamRequestTimeoutMs: 15_000,
  upstreamMediaTimeoutMs: 30_000,
  sessionCookieName: 'betterchat_session',
  sessionCookieSecure: false,
  sessionSecret: 'betterchat-test-secret',
  sessionTtlSeconds: 60,
  defaultMessagePageSize: 50,
  maxUploadBytes: 10 * 1024 * 1024,
};

describe('session cookie helpers', () => {
  test('round-trips encrypted BetterChat session cookies', () => {
    const now = new Date('2026-03-25T10:00:00.000Z');
    const session = buildSession(
      config,
      {
        userId: 'alice-id',
        authToken: 'rocket-chat-auth-token',
        username: 'alice',
        displayName: 'Alice Example',
      },
      now,
    );

    const cookie = serializeSessionCookie(config, session);
    const decoded = deserializeSessionCookie(config, cookie, new Date('2026-03-25T10:00:30.000Z'));

    expect(decoded).toEqual(session);
  });

  test('rejects tampered session cookies', () => {
    const session = buildSession(config, {
      userId: 'alice-id',
      authToken: 'rocket-chat-auth-token',
      username: 'alice',
      displayName: 'Alice Example',
    });

    const cookie = serializeSessionCookie(config, session);
    const tampered = `${cookie}tampered`;

    expect(deserializeSessionCookie(config, tampered)).toBeUndefined();
  });

  test('rejects expired session cookies', () => {
    const session = buildSession(
      { ...config, sessionTtlSeconds: 1 },
      {
        userId: 'alice-id',
        authToken: 'rocket-chat-auth-token',
        username: 'alice',
        displayName: 'Alice Example',
      },
      new Date('2026-03-25T10:00:00.000Z'),
    );

    const cookie = serializeSessionCookie({ ...config, sessionTtlSeconds: 1 }, session);

    expect(deserializeSessionCookie(config, cookie, new Date('2026-03-25T10:00:02.000Z'))).toBeUndefined();
  });

  test('derives a stable realtime session key from the upstream auth token', () => {
    expect(sessionKeyFrom({ authToken: 'token-a' })).toBe(sessionKeyFrom({ authToken: 'token-a' }));
    expect(sessionKeyFrom({ authToken: 'token-a' })).not.toBe(sessionKeyFrom({ authToken: 'token-b' }));
  });
});
