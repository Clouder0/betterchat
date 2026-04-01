import type { Hono } from 'hono';

import { normalizePublicBootstrap } from '../normalize';
import type { AppServices } from '../http-context';

const PUBLIC_SETTING_IDS = ['Site_Name', 'Organization_Name', 'Accounts_RegistrationForm', 'Accounts_ShowFormLogin'];

export const installOperationalRoutes = (app: Hono, services: AppServices): void => {
  const { client } = services;

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
    const [info, settingsResponse, oauthResponse] = await Promise.all([
      client.getPublicInfo(),
      client.getPublicSettings(PUBLIC_SETTING_IDS),
      client.getOauthSettings(),
    ]);

    return c.json({
      ok: true,
      data: normalizePublicBootstrap(info, settingsResponse, oauthResponse),
    });
  });
};
