import type { Hono } from 'hono';

import { toAppError } from '../errors';
import { normalizePublicBootstrap } from '../normalize';
import { invalidateAndClearSession, normalizeAuthFailure, sessionFromRequest } from '../session-boundary';
import type { AppServices } from '../http-context';

const PUBLIC_SETTING_IDS = ['Site_Name', 'Organization_Name', 'Accounts_RegistrationForm', 'Accounts_ShowFormLogin'];

export const installOperationalRoutes = (app: Hono, services: AppServices): void => {
  const { client, config, snapshotService } = services;

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      data: {
        status: 'ok',
      },
    }),
  );

  app.get('/readyz', async (c) => {
    await Promise.all([
      client.getPublicInfo(),
      client.probeRealtime(),
    ]);

    return c.json({
      ok: true,
      data: {
        status: 'ready',
      },
    });
  });

  app.get('/api/public/bootstrap', async (c) => {
    const session = sessionFromRequest(config, c.req.raw);
    const authenticatedPromise = session
      ? client.getMe(session)
        .then(() => true)
        .catch((error) => {
          const authError = normalizeAuthFailure(toAppError(error));
          if (authError.code === 'UNAUTHENTICATED') {
            invalidateAndClearSession(c, config, snapshotService, session);
            return false;
          }

          throw authError;
        })
      : Promise.resolve(false);

    const [info, settingsResponse, oauthResponse, authenticated] = await Promise.all([
      client.getPublicInfo(),
      client.getPublicSettings(PUBLIC_SETTING_IDS),
      client.getOauthSettings(),
      authenticatedPromise,
    ]);

    return c.json({
      ok: true,
      data: normalizePublicBootstrap(info, settingsResponse, oauthResponse, authenticated),
    });
  });
};
