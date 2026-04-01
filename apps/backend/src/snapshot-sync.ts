import type { MembershipListing, SnapshotSyncState } from '@betterchat/contracts';

import { toAppError } from './errors';
import { type UpstreamSession } from './session';
import { createSnapshotReadScope, type SnapshotService } from './snapshot-service';
import { getRoomSubscription } from './snapshots';
import type { RocketChatClient } from './upstream';

export type ConversationSnapshotSyncSelection = {
  includeDirectory?: boolean;
  includeConversation?: boolean;
  includeTimeline?: boolean;
  threadId?: string;
};

const listingFromOpen = (open: boolean): MembershipListing => (open ? 'listed' : 'hidden');

export const buildConversationSnapshotSync = async (
  snapshotService: SnapshotService,
  session: UpstreamSession,
  conversationId: string,
  options: ConversationSnapshotSyncSelection,
): Promise<SnapshotSyncState> => {
  const scope = createSnapshotReadScope();
  const [directory, conversation, timeline, thread] = await Promise.all([
    options.includeDirectory ? snapshotService.directory(session, scope) : Promise.resolve(undefined),
    options.includeConversation ? snapshotService.conversation(session, conversationId, scope) : Promise.resolve(undefined),
    options.includeTimeline ? snapshotService.conversationTimeline(session, conversationId, undefined, scope) : Promise.resolve(undefined),
    options.threadId
      ? snapshotService.threadConversationTimeline(session, conversationId, options.threadId, undefined, scope).catch((error) => {
          const appError = toAppError(error);
          if (appError.status === 404) {
            return undefined;
          }

          throw appError;
        })
      : Promise.resolve(undefined),
  ]);

  return {
    ...(directory ? { directoryVersion: directory.version } : {}),
    ...(conversation ? { conversationVersion: conversation.version } : {}),
    ...(timeline ? { timelineVersion: timeline.version } : {}),
    ...(thread ? { threadVersion: thread.version } : {}),
  };
};

export const invalidateConversationSnapshotSync = (
  snapshotService: SnapshotService,
  session: UpstreamSession,
  conversationId: string,
  options: ConversationSnapshotSyncSelection,
): void => {
  if (options.includeDirectory) {
    snapshotService.invalidateDirectory(session);
  }

  if (options.includeConversation || options.includeTimeline || options.threadId) {
    snapshotService.invalidateConversation(session, conversationId);
  }

  if (options.threadId) {
    snapshotService.invalidateThread(session, conversationId, options.threadId);
  }
};

export const buildFreshConversationSnapshotSync = async (
  snapshotService: SnapshotService,
  session: UpstreamSession,
  conversationId: string,
  options: ConversationSnapshotSyncSelection,
): Promise<SnapshotSyncState> => {
  invalidateConversationSnapshotSync(snapshotService, session, conversationId, options);
  return buildConversationSnapshotSync(snapshotService, session, conversationId, options);
};

export const buildConversationListingMutationResponse = async (
  snapshotService: SnapshotService,
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  listing: MembershipListing,
): Promise<{
  conversationId: string;
  listing: MembershipListing;
  sync: SnapshotSyncState;
}> => {
  const subscription = await getRoomSubscription(client, session, conversationId);
  const desiredOpen = listing === 'listed';
  if (subscription.open !== desiredOpen) {
    if (desiredOpen) {
      await client.openRoom(session, conversationId);
    } else {
      await client.hideRoom(session, conversationId);
    }
  }

  const [refreshedSubscription, sync] = await Promise.all([
    getRoomSubscription(client, session, conversationId),
    buildFreshConversationSnapshotSync(snapshotService, session, conversationId, {
      includeDirectory: true,
      includeConversation: true,
      includeTimeline: true,
    }),
  ]);

  return {
    conversationId,
    listing: listingFromOpen(refreshedSubscription.open),
    sync,
  };
};
