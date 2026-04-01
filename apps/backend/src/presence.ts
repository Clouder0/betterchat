import type { PresenceState } from '@betterchat/contracts';

import { toAppError } from './errors';
import type { UpstreamSession } from './session';
import type { RocketChatClient } from './upstream';

const uniqueUserIdsFrom = (userIds: string[]): string[] => [...new Set(userIds.filter((userId) => userId.length > 0))];

export const presenceStateFromStatus = (status: string | undefined): PresenceState => {
  switch (status) {
    case 'online':
    case 'away':
    case 'busy':
      return status;
    default:
      return 'offline';
  }
};

export const loadBestEffortPresenceByUserId = async (
  client: RocketChatClient,
  session: UpstreamSession,
  userIds: string[],
  fallbackStatusByUserId: ReadonlyMap<string, string | undefined> = new Map(),
): Promise<Map<string, PresenceState>> => {
  const uniqueUserIds = uniqueUserIdsFrom(userIds);
  const presenceByUserId = new Map<string, PresenceState>(
    uniqueUserIds.map((userId) => [userId, presenceStateFromStatus(fallbackStatusByUserId.get(userId))]),
  );

  if (uniqueUserIds.length === 0) {
    return presenceByUserId;
  }

  try {
    const response = await client.getUsersPresence(session, uniqueUserIds);
    for (const user of response.users) {
      presenceByUserId.set(user._id, presenceStateFromStatus(user.status));
    }
  } catch (error) {
    const appError = toAppError(error);
    if (appError.status === 401 || appError.code === 'UNAUTHENTICATED') {
      throw appError;
    }
  }

  return presenceByUserId;
};
