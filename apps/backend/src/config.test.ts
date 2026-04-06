import { describe, expect, test } from 'bun:test';

import { getConfig } from './config';

describe('config', () => {
  test('uses the 50 MiB upload limit by default', () => {
    const config = getConfig({
      BETTERCHAT_SESSION_SECRET: 'secret',
    });

    expect(config.maxUploadBytes).toBe(50 * 1024 * 1024);
    expect(config.stateDir).toBe('.runtime');
  });

  test('normalizes a valid upstream url and keeps explicit values', () => {
    const config = getConfig({
      BETTERCHAT_HOST: '127.0.0.1',
      BETTERCHAT_PORT: '3200',
      BETTERCHAT_STATE_DIR: '/tmp/betterchat-state',
      BETTERCHAT_UPSTREAM_URL: 'http://127.0.0.1:3100/',
      BETTERCHAT_SESSION_SECRET: 'secret',
      BETTERCHAT_SESSION_TTL_SECONDS: '60',
      BETTERCHAT_DEFAULT_MESSAGE_PAGE_SIZE: '25',
      BETTERCHAT_MAX_UPLOAD_BYTES: '1024',
      BETTERCHAT_UPSTREAM_REQUEST_TIMEOUT_MS: '5000',
      BETTERCHAT_UPSTREAM_MEDIA_TIMEOUT_MS: '7000',
    });

    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 3200,
      stateDir: '/tmp/betterchat-state',
      upstreamUrl: 'http://127.0.0.1:3100',
      sessionSecret: 'secret',
      sessionTtlSeconds: 60,
      defaultMessagePageSize: 25,
      maxUploadBytes: 1024,
      upstreamRequestTimeoutMs: 5000,
      upstreamMediaTimeoutMs: 7000,
    });
  });

  test('fails fast on invalid positive integers', () => {
    expect(() =>
      getConfig({
        BETTERCHAT_SESSION_SECRET: 'secret',
        BETTERCHAT_PORT: '0',
      }),
    ).toThrow('BETTERCHAT_PORT must be a positive integer');
  });

  test('fails fast on malformed integer strings instead of truncating them', () => {
    expect(() =>
      getConfig({
        BETTERCHAT_SESSION_SECRET: 'secret',
        BETTERCHAT_PORT: '3200abc',
      }),
    ).toThrow('BETTERCHAT_PORT must be a positive integer');
  });

  test('fails fast on invalid upstream urls', () => {
    expect(() =>
      getConfig({
        BETTERCHAT_SESSION_SECRET: 'secret',
        BETTERCHAT_UPSTREAM_URL: 'ftp://example.com',
      }),
    ).toThrow('BETTERCHAT_UPSTREAM_URL must use http or https');
  });

  test('fails fast on malformed booleans', () => {
    expect(() =>
      getConfig({
        BETTERCHAT_SESSION_SECRET: 'secret',
        BETTERCHAT_SESSION_COOKIE_SECURE: 'truEish',
      }),
    ).toThrow('BETTERCHAT_SESSION_COOKIE_SECURE must be "true" or "false"');
  });
});
