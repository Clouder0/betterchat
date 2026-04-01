import type { Context } from 'hono';
import { deleteCookie } from 'hono/cookie';

import type { BetterChatConfig } from './config';
import { AppError } from './errors';
import { realtimeSessionRegistry } from './realtime-session-registry';
import { getSessionFromRequest } from './session-auth';
import { sessionKeyFrom, type UpstreamSession } from './session';
import type { SnapshotService } from './snapshot-service';

const clearSessionCookie = (c: Context, config: BetterChatConfig): void => {
  deleteCookie(c, config.sessionCookieName, {
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Lax',
    path: '/',
    secure: config.sessionCookieSecure,
  });
};

export const invalidateSessionState = (
  snapshotService: SnapshotService,
  session: UpstreamSession | undefined,
): void => {
  if (!session) {
    return;
  }

  snapshotService.clearSession(session);
  realtimeSessionRegistry.invalidate(sessionKeyFrom(session));
};

export const invalidateAndClearSession = (
  c: Context,
  config: BetterChatConfig,
  snapshotService: SnapshotService,
  session: UpstreamSession | undefined,
): void => {
  invalidateSessionState(snapshotService, session);
  clearSessionCookie(c, config);
};

export const ensureAuthenticated = (config: BetterChatConfig, request: Request): UpstreamSession => {
  const session = getSessionFromRequest(config, request);
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required', 401);
  }

  return session;
};

export const normalizeAuthFailure = (error: AppError): AppError => {
  if (error.status === 401) {
    return new AppError('UNAUTHENTICATED', 'BetterChat session is no longer valid', 401);
  }

  return error;
};

export const sessionFromRequest = (config: BetterChatConfig, request: Request): UpstreamSession | undefined =>
  getSessionFromRequest(config, request);
