import { authorizationSnapshotFrom, type AuthorizationSnapshot } from './authorization';
import { CONVERSATION_SETTING_IDS } from './capabilities';
import { AppError } from './errors';
import type { SnapshotFactCache } from './snapshot-facts';
import type { UpstreamSession } from './session';
import { getRoomSubscription } from './snapshots';
import type { RocketChatClient, UpstreamRoom, UpstreamSetting, UpstreamSubscription } from './upstream';

export type ConversationAuthorizationContext = {
  authorization: AuthorizationSnapshot;
  currentUserId: string;
  currentUsername: string;
  room: UpstreamRoom;
  settings: UpstreamSetting[];
  subscription: UpstreamSubscription;
};

export const loadConversationAuthorizationContext = async (
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  facts?: SnapshotFactCache,
): Promise<ConversationAuthorizationContext> => {
  const [subscription, roomInfoResponse, settings, meResponse, permissionsResponse] = await Promise.all([
    getRoomSubscription(client, session, conversationId, facts),
    facts ? facts.getRoomInfo(client, session, conversationId) : client.getRoomInfo(session, conversationId),
    facts
      ? facts.getPublicSettings(client, [...CONVERSATION_SETTING_IDS])
      : client.getPublicSettings([...CONVERSATION_SETTING_IDS]).then((response) => response.settings),
    facts ? facts.getMe(client, session) : client.getMe(session),
    facts ? facts.getPermissionDefinitions(client, session) : client.getPermissionDefinitions(session).then((response) => response.update),
  ]);

  if (!roomInfoResponse.room) {
    throw new AppError('NOT_FOUND', 'Conversation not found', 404, { conversationId });
  }

  return {
    authorization: authorizationSnapshotFrom(meResponse, subscription, permissionsResponse),
    currentUserId: meResponse._id,
    currentUsername: meResponse.username,
    room: roomInfoResponse.room,
    settings,
    subscription,
  };
};
