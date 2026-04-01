import type { PresenceState } from '@betterchat/contracts';

import {
  projectMembershipInboxProjection,
  type MembershipInboxProjection,
  type MembershipInboxProjectionMode,
} from './inbox-projector';
import { loadBestEffortPresenceByUserId } from './presence';
import type { UpstreamSession } from './session';
import type {
  RocketChatClient,
  UpstreamMeResponse,
  UpstreamPermissionDefinition,
  UpstreamRoom,
  UpstreamRoomInfoResponse,
  UpstreamRoomsResponse,
  UpstreamSetting,
  UpstreamSubscription,
  UpstreamSubscriptionResponse,
  UpstreamSubscriptionsResponse,
} from './upstream';

const settingsCacheKeyFrom = (settingIds: string[]): string => [...new Set(settingIds)].sort().join(',');

const presenceCacheKeyFrom = (userIds: string[]): string => [...new Set(userIds)].sort().join(',');

const inboxProjectionCacheKeyFrom = (conversationId: string, mode: MembershipInboxProjectionMode): string =>
  `${conversationId}:${mode}`;

const roomMapFrom = (roomsResponse: UpstreamRoomsResponse): Map<string, UpstreamRoom> =>
  new Map(roomsResponse.update.map((room) => [room._id, room]));

const subscriptionMapFrom = (subscriptionsResponse: UpstreamSubscriptionsResponse): Map<string, UpstreamSubscription> =>
  new Map(subscriptionsResponse.update.map((subscription) => [subscription.rid, subscription]));

export class SnapshotFactCache {
  private inboxProjectionByKey = new Map<string, Promise<MembershipInboxProjection>>();
  private mePromise?: Promise<UpstreamMeResponse>;
  private permissionDefinitionsPromise?: Promise<UpstreamPermissionDefinition[]>;
  private presenceByKey = new Map<string, Promise<Map<string, PresenceState>>>();
  private publicSettingsByKey = new Map<string, Promise<UpstreamSetting[]>>();
  private roomInfoByConversationId = new Map<string, Promise<UpstreamRoomInfoResponse>>();
  private roomsMapPromise?: Promise<Map<string, UpstreamRoom>>;
  private subscriptionByConversationId = new Map<string, Promise<UpstreamSubscription | undefined>>();
  private subscriptionsMapPromise?: Promise<Map<string, UpstreamSubscription>>;

  getMembershipInboxProjection(
    client: RocketChatClient,
    session: UpstreamSession,
    subscription: UpstreamSubscription,
    options: {
      mode?: MembershipInboxProjectionMode;
    } = {},
  ): Promise<MembershipInboxProjection> {
    const requestedMode = options.mode ?? 'exact';
    const candidateKeys = [
      inboxProjectionCacheKeyFrom(subscription.rid, 'exact'),
      inboxProjectionCacheKeyFrom(subscription.rid, 'directory'),
    ];

    for (const candidateKey of candidateKeys) {
      const existing = this.inboxProjectionByKey.get(candidateKey);
      if (existing) {
        return existing;
      }
    }

    const created = projectMembershipInboxProjection(client, session, subscription, options);
    this.inboxProjectionByKey.set(inboxProjectionCacheKeyFrom(subscription.rid, requestedMode), created);
    return created;
  }

  getPublicSettings(
    client: RocketChatClient,
    settingIds: string[],
  ): Promise<UpstreamSetting[]> {
    const key = settingsCacheKeyFrom(settingIds);
    const existing = this.publicSettingsByKey.get(key);
    if (existing) {
      return existing;
    }

    const created = client.getPublicSettings([...new Set(settingIds)]).then((response) => response.settings);
    this.publicSettingsByKey.set(key, created);
    return created;
  }

  getMe(
    client: RocketChatClient,
    session: UpstreamSession,
  ): Promise<UpstreamMeResponse> {
    if (!this.mePromise) {
      this.mePromise = client.getMe(session);
    }

    return this.mePromise;
  }

  getPermissionDefinitions(
    client: RocketChatClient,
    session: UpstreamSession,
  ): Promise<UpstreamPermissionDefinition[]> {
    if (!this.permissionDefinitionsPromise) {
      this.permissionDefinitionsPromise = client.getPermissionDefinitions(session).then((response) => response.update);
    }

    return this.permissionDefinitionsPromise;
  }

  async getRoomInfo(
    client: RocketChatClient,
    session: UpstreamSession,
    conversationId: string,
  ): Promise<UpstreamRoomInfoResponse> {
    if (this.roomsMapPromise) {
      const roomsMap = await this.getRoomsMap(client, session);
      const room = roomsMap.get(conversationId);
      if (room) {
        return {
          success: true,
          room,
        };
      }
    }

    const existing = this.roomInfoByConversationId.get(conversationId);
    if (existing) {
      return existing;
    }

    const created = client.getRoomInfo(session, conversationId);
    this.roomInfoByConversationId.set(conversationId, created);
    return created;
  }

  async getRoomSubscription(
    client: RocketChatClient,
    session: UpstreamSession,
    conversationId: string,
  ): Promise<UpstreamSubscriptionResponse> {
    if (this.subscriptionsMapPromise) {
      const subscriptionsMap = await this.getSubscriptionsMap(client, session);
      const cachedSubscription = subscriptionsMap.get(conversationId);
      if (cachedSubscription) {
        return {
          success: true,
          subscription: cachedSubscription,
        };
      }
    }

    const existing = this.subscriptionByConversationId.get(conversationId);
    if (existing) {
      return {
        success: true,
        subscription: await existing,
      };
    }

    const created = client.getSubscription(session, conversationId).then((response) => response.subscription);
    this.subscriptionByConversationId.set(conversationId, created);

    return {
      success: true,
      subscription: await created,
    };
  }

  getRooms(
    client: RocketChatClient,
    session: UpstreamSession,
  ): Promise<UpstreamRoomsResponse> {
    return this.getRoomsMap(client, session).then((roomsMap) => ({
      success: true,
      update: [...roomsMap.values()],
      remove: [],
    }));
  }

  getSubscriptions(
    client: RocketChatClient,
    session: UpstreamSession,
  ): Promise<UpstreamSubscriptionsResponse> {
    return this.getSubscriptionsMap(client, session).then((subscriptionsMap) => ({
      success: true,
      update: [...subscriptionsMap.values()],
      remove: [],
    }));
  }

  getUsersPresence(
    client: RocketChatClient,
    session: UpstreamSession,
    userIds: string[],
  ): Promise<Map<string, PresenceState>> {
    const uniqueUserIds = [...new Set(userIds)].filter((userId) => userId.length > 0);
    const key = presenceCacheKeyFrom(uniqueUserIds);

    if (key.length === 0) {
      return Promise.resolve(new Map());
    }

    const existing = this.presenceByKey.get(key);
    if (existing) {
      return existing;
    }

    const created = loadBestEffortPresenceByUserId(client, session, uniqueUserIds);
    this.presenceByKey.set(key, created);
    return created;
  }

  private getRoomsMap(
    client: RocketChatClient,
    session: UpstreamSession,
  ): Promise<Map<string, UpstreamRoom>> {
    if (!this.roomsMapPromise) {
      this.roomsMapPromise = client.getRooms(session).then(roomMapFrom);
    }

    return this.roomsMapPromise;
  }

  private getSubscriptionsMap(
    client: RocketChatClient,
    session: UpstreamSession,
  ): Promise<Map<string, UpstreamSubscription>> {
    if (!this.subscriptionsMapPromise) {
      this.subscriptionsMapPromise = client.getSubscriptions(session).then(subscriptionMapFrom);
    }

    return this.subscriptionsMapPromise;
  }
}
