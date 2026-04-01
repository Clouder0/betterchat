import type { BetterChatConfig } from './config';
import type { BetterChatLogger } from './observability';
import type { SnapshotService } from './snapshot-service';
import type { RocketChatClient } from './upstream';

export type AppServices = {
  config: BetterChatConfig;
  client: RocketChatClient;
  logger: BetterChatLogger;
  snapshotService: SnapshotService;
};
