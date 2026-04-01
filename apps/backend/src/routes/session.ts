import type { LoginRequest } from '@betterchat/contracts';
import type { Hono } from 'hono';
import { setCookie } from 'hono/cookie';

import { WORKSPACE_SETTING_IDS, workspaceBootstrapCapabilitiesFrom } from '../capabilities';
import { readJsonBody, parseLoginRequest } from '../http-helpers';
import type { AppServices } from '../http-context';
import { normalizeSessionUser, normalizeWorkspaceBootstrap } from '../normalize';
import { buildSession, serializeSessionCookie, sessionKeyFrom } from '../session';
import { ensureAuthenticated, invalidateAndClearSession, invalidateSessionState, normalizeAuthFailure, sessionFromRequest } from '../session-boundary';
import { toAppError } from '../errors';

export const installSessionRoutes = (app: Hono, services: AppServices): void => {
  const { client, config, snapshotService } = services;

  app.post('/api/session/login', async (c) => {
    const previousSession = sessionFromRequest(config, c.req.raw);
    const body = parseLoginRequest(await readJsonBody<LoginRequest>(c.req.raw));
    const loginResponse = await client.login(body);
    const session = buildSession(config, {
      userId: loginResponse.data.userId,
      authToken: loginResponse.data.authToken,
      username: loginResponse.data.me.username,
      displayName: loginResponse.data.me.name || loginResponse.data.me.username,
    });

    setCookie(c, config.sessionCookieName, serializeSessionCookie(config, session), {
      httpOnly: true,
      maxAge: config.sessionTtlSeconds,
      sameSite: 'Lax',
      path: '/',
      secure: config.sessionCookieSecure,
    });

    if (previousSession && sessionKeyFrom(previousSession) !== sessionKeyFrom(session)) {
      invalidateSessionState(snapshotService, previousSession);
      try {
        await client.logout(previousSession);
      } catch {
        // Successful BetterChat login should still switch the local session even if upstream revocation fails.
      }
    }

    return c.json({
        ok: true,
        data: {
          user: normalizeSessionUser(loginResponse.data.me),
        },
      });
  });

  app.post('/api/session/logout', async (c) => {
    const session = sessionFromRequest(config, c.req.raw);
    invalidateAndClearSession(c, config, snapshotService, session);

    if (session) {
      try {
        await client.logout(session);
      } catch {
        // BetterChat owns the browser session boundary, so local logout remains authoritative here.
      }
    }

    return c.json({ ok: true, data: {} });
  });

  app.get('/api/workspace', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);

    try {
      const [meResponse, info, settingsResponse] = await Promise.all([
        client.getMe(session),
        client.getPublicInfo(session),
        client.getPublicSettings([...WORKSPACE_SETTING_IDS]),
      ]);

      return c.json({
        ok: true,
        data: normalizeWorkspaceBootstrap(meResponse, info, settingsResponse, {
          ...workspaceBootstrapCapabilitiesFrom(settingsResponse.settings),
        }),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });
};
