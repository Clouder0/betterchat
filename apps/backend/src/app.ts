import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

import type { BetterChatConfig } from './config';
import { getConfig } from './config';
import { AppError, jsonError, toAppError } from './errors';
import { abortUnreadRequestBody } from './http-helpers';
import type { AppServices } from './http-context';
import { applyRequestId, consoleLogger, logRequestError, requestIdFrom, type BetterChatLogger } from './observability';
import { installConversationRoutes } from './routes/conversations';
import { installMediaRoutes } from './routes/media';
import { installOperationalRoutes } from './routes/operational';
import { installSessionRoutes } from './routes/session';
import { installUserRoutes } from './routes/users';
import { createSnapshotService, type SnapshotService } from './snapshot-service';
import { invalidateAndClearSession, sessionFromRequest } from './session-boundary';
import { RocketChatClient } from './upstream';

export type CreateAppDependencies = {
  client?: RocketChatClient;
  logger?: BetterChatLogger;
  snapshotService?: SnapshotService;
};

export const createApp = (
  config: BetterChatConfig = getConfig(),
  dependencies: CreateAppDependencies = {},
): Hono => {
  const app = new Hono();
  const requestStartedAtMs = new WeakMap<Request, number>();
  const client = dependencies.client ?? new RocketChatClient(config.upstreamUrl, {
    requestTimeoutMs: config.upstreamRequestTimeoutMs,
    mediaTimeoutMs: config.upstreamMediaTimeoutMs,
  });
  const snapshotService = dependencies.snapshotService ?? createSnapshotService(config, client);
  const logger = dependencies.logger ?? consoleLogger;
  const services: AppServices = {
    client,
    config,
    logger,
    snapshotService,
  };

  app.use('*', async (c, next) => {
    requestIdFrom(c.req.raw);
    requestStartedAtMs.set(c.req.raw, performance.now());
    await next();
    applyRequestId(c.res, c.req.raw);
  });

  app.onError((error, c) => {
    const appError = toAppError(error);
    if (appError.code === 'UNAUTHENTICATED') {
      invalidateAndClearSession(c, config, snapshotService, sessionFromRequest(config, c.req.raw));
    }

    const response = jsonError(c, appError);
    if (!c.req.raw.bodyUsed && c.req.raw.body !== null) {
      abortUnreadRequestBody(c.req.raw);
      response.headers.set('connection', 'close');
    }

    applyRequestId(response, c.req.raw);
    logRequestError(
      logger,
      c.req.raw,
      appError,
      Math.round(performance.now() - (requestStartedAtMs.get(c.req.raw) ?? performance.now())),
    );

    return response;
  });

  installOperationalRoutes(app, services);
  installSessionRoutes(app, services);
  installUserRoutes(app, services);
  installConversationRoutes(app, services);
  installMediaRoutes(app, services);

  if (config.staticDir) {
    app.use('*', serveStatic({ root: config.staticDir }));

    app.notFound(async (c) => {
      if (c.req.path.startsWith('/api/')) {
        return jsonError(c, new AppError('NOT_FOUND', 'Route not found', 404, { path: c.req.path }));
      }
      const file = Bun.file(`${config.staticDir}/index.html`);
      return new Response(file, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  } else {
    app.notFound((c) => jsonError(c, new AppError('NOT_FOUND', 'Route not found', 404, { path: c.req.path })));
  }

  return app;
};
