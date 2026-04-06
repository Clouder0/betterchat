import { createApp } from './app';
import { getConfig } from './config';
import { consoleLogger } from './observability';
import { createSnapshotService } from './snapshot-service';
import { BetterChatConversationStreamGateway, type ConversationStreamSocketData } from './stream';
import { RocketChatClient } from './upstream';

export const startServer = (): void => {
  const config = getConfig();
  const logger = consoleLogger;
  const client = new RocketChatClient(config.upstreamUrl, {
    requestTimeoutMs: config.upstreamRequestTimeoutMs,
    mediaTimeoutMs: config.upstreamMediaTimeoutMs,
  });
  const snapshotService = createSnapshotService(config, client);
  const app = createApp(config, {
    client,
    logger,
    snapshotService,
  });
  const streamGateway = new BetterChatConversationStreamGateway(config, {
    client,
    snapshotService,
  });

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch(request, server) {
      const streamResponse = streamGateway.maybeHandleRequest(request, server as Bun.Server<ConversationStreamSocketData>);
      if (streamResponse) {
        return streamResponse;
      }

      return app.fetch(request);
    },
    websocket: {
      open(ws) {
        streamGateway.open(ws as Bun.ServerWebSocket<ConversationStreamSocketData>);
      },

      message(ws, message) {
        streamGateway.message(ws as Bun.ServerWebSocket<ConversationStreamSocketData>, message);
      },

      close(ws) {
        streamGateway.close(ws as Bun.ServerWebSocket<ConversationStreamSocketData>);
      },
    } satisfies Bun.WebSocketHandler<ConversationStreamSocketData>,
  });

  logger.info('server_started', {
    host: config.host,
    port: config.port,
    url: `http://${config.host}:${config.port}`,
  });

  let shuttingDown = false;
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info('server_stopping', { signal });

    streamGateway.stop();
    snapshotService.close();
    server.stop(true);

    logger.info('server_stopped', { signal });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
};

if (import.meta.main) {
  startServer();
}
