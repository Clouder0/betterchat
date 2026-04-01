export type BetterChatConfig = {
  host: string;
  port: number;
  upstreamUrl: string;
  upstreamRequestTimeoutMs: number;
  upstreamMediaTimeoutMs: number;
  sessionCookieName: string;
  sessionCookieSecure: boolean;
  sessionSecret: string;
  sessionTtlSeconds: number;
  defaultMessagePageSize: number;
  maxUploadBytes: number;
  staticDir: string | null;
};

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3200;
const DEFAULT_UPSTREAM_URL = 'http://127.0.0.1:3100';
const DEFAULT_SESSION_COOKIE_NAME = 'betterchat_session';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_UPSTREAM_MEDIA_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const parsePositiveInteger = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean, name: string): boolean => {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
};

const requireString = (value: string | undefined, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
};

const validatedUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BETTERCHAT_UPSTREAM_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BETTERCHAT_UPSTREAM_URL must use http or https');
  }

  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

export const getConfig = (env: NodeJS.ProcessEnv = process.env): BetterChatConfig => {
  const host = (env.BETTERCHAT_HOST || DEFAULT_HOST).trim();
  if (!host) {
    throw new Error('BETTERCHAT_HOST must not be empty');
  }

  return {
    host,
    port: parsePositiveInteger(env.BETTERCHAT_PORT, DEFAULT_PORT, 'BETTERCHAT_PORT'),
    upstreamUrl: validatedUrl(env.BETTERCHAT_UPSTREAM_URL || DEFAULT_UPSTREAM_URL),
    upstreamRequestTimeoutMs: parsePositiveInteger(
      env.BETTERCHAT_UPSTREAM_REQUEST_TIMEOUT_MS,
      DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS,
      'BETTERCHAT_UPSTREAM_REQUEST_TIMEOUT_MS',
    ),
    upstreamMediaTimeoutMs: parsePositiveInteger(
      env.BETTERCHAT_UPSTREAM_MEDIA_TIMEOUT_MS,
      DEFAULT_UPSTREAM_MEDIA_TIMEOUT_MS,
      'BETTERCHAT_UPSTREAM_MEDIA_TIMEOUT_MS',
    ),
    sessionCookieName: env.BETTERCHAT_SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME,
    sessionCookieSecure: parseBoolean(env.BETTERCHAT_SESSION_COOKIE_SECURE, false, 'BETTERCHAT_SESSION_COOKIE_SECURE'),
    sessionSecret: requireString(env.BETTERCHAT_SESSION_SECRET, 'BETTERCHAT_SESSION_SECRET'),
    sessionTtlSeconds: parsePositiveInteger(env.BETTERCHAT_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS, 'BETTERCHAT_SESSION_TTL_SECONDS'),
    defaultMessagePageSize: parsePositiveInteger(
      env.BETTERCHAT_DEFAULT_MESSAGE_PAGE_SIZE,
      DEFAULT_MESSAGE_PAGE_SIZE,
      'BETTERCHAT_DEFAULT_MESSAGE_PAGE_SIZE',
    ),
    maxUploadBytes: parsePositiveInteger(env.BETTERCHAT_MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES, 'BETTERCHAT_MAX_UPLOAD_BYTES'),
    staticDir: env.BETTERCHAT_STATIC_DIR?.trim() || null,
  };
};
