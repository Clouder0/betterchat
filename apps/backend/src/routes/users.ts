import type { Hono } from 'hono';

import { ensureDirectConversation, lookupDirectConversation } from '../direct-conversations';
import { toAppError } from '../errors';
import type { AppServices } from '../http-context';
import { ensureAuthenticated, normalizeAuthFailure } from '../session-boundary';

export const installUserRoutes = (app: Hono, services: AppServices): void => {
  const { client, config, snapshotService } = services;

  app.get('/api/users/:userId/direct-conversation', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const userId = c.req.param('userId');

    try {
      return c.json({
        ok: true,
        data: await lookupDirectConversation(client, snapshotService, session, userId),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.put('/api/users/:userId/direct-conversation', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const userId = c.req.param('userId');

    try {
      return c.json({
        ok: true,
        data: await ensureDirectConversation(client, snapshotService, session, userId),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });
};
