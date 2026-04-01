import type { Hono } from 'hono';

import { toAppError } from '../errors';
import { mediaProxyRequestHeaders, proxyHeaders } from '../http-helpers';
import type { AppServices } from '../http-context';
import { toUpstreamMediaPath } from '../media-proxy';
import { normalizeAuthFailure, sessionFromRequest } from '../session-boundary';

export const installMediaRoutes = (app: Hono, services: AppServices): void => {
  const { client, config } = services;

  app.on(['GET', 'HEAD'], '/api/media/*', async (c) => {
    try {
      const upstreamPath = toUpstreamMediaPath(c.req.url, c.req.path);
      const session = sessionFromRequest(config, c.req.raw);
      const response = await client.fetchMedia(
        upstreamPath,
        session,
        mediaProxyRequestHeaders(c.req.raw.headers),
        c.req.method === 'HEAD' ? 'HEAD' : 'GET',
      );

      return new Response(response.body, {
        status: response.status,
        headers: proxyHeaders(response.headers),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });
};
