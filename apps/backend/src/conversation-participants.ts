import type {
  ConversationMentionCandidate,
  ConversationMentionCandidatesResponse,
  ConversationParticipantsPage,
} from '@betterchat/contracts';

import type { ConversationAuthorizationContext } from './conversation-authorization';
import { isOneToOneDirectConversation } from './conversation-domain';
import { nextCursorFrom, type PaginationRequest } from './pagination';
import { normalizeUserSummary } from './normalize';
import type { UpstreamSession } from './session';
import type { RocketChatClient } from './upstream';

const normalizeParticipantSearchQuery = (query: string | undefined): string | undefined => {
  const normalized = query?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const normalizeMentionSearchValue = (value: string): string =>
  value.trim().replace(/^@+/, '').replace(/[\s._-]+/g, '').toLowerCase();

const memberSearchQueryFromMentionInput = (value: string): string | undefined => {
  const normalized = value.trim().replace(/^@+/, '');
  return normalized.length > 0 ? normalized : undefined;
};

const scoreMentionCandidate = (
  candidate: ReturnType<typeof normalizeUserSummary>,
  normalizedQuery: string,
): number => {
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedUsername = normalizeMentionSearchValue(candidate.username ?? '');
  const normalizedDisplayName = normalizeMentionSearchValue(candidate.displayName);
  let bestScore = Number.NEGATIVE_INFINITY;

  if (normalizedUsername) {
    if (normalizedUsername === normalizedQuery) {
      bestScore = Math.max(bestScore, 520);
    } else if (normalizedUsername.startsWith(normalizedQuery)) {
      bestScore = Math.max(bestScore, 460 - Math.max(normalizedUsername.length - normalizedQuery.length, 0));
    } else if (normalizedUsername.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 300 - normalizedUsername.indexOf(normalizedQuery));
    }
  }

  if (normalizedDisplayName) {
    if (normalizedDisplayName === normalizedQuery) {
      bestScore = Math.max(bestScore, 420);
    } else if (normalizedDisplayName.startsWith(normalizedQuery)) {
      bestScore = Math.max(bestScore, 360 - Math.max(normalizedDisplayName.length - normalizedQuery.length, 0));
    } else if (normalizedDisplayName.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 240 - normalizedDisplayName.indexOf(normalizedQuery));
    }
  }

  return bestScore;
};

const specialMentionCandidatesFrom = (
  context: Pick<ConversationAuthorizationContext, 'room' | 'subscription'>,
  query: string,
): ConversationMentionCandidate[] => {
  if (isOneToOneDirectConversation(context.room, context.subscription)) {
    return [];
  }

  const candidates = [
    {
      kind: 'special' as const,
      key: 'all' as const,
      label: 'Notify everyone in this conversation',
      insertText: '@all',
    },
    {
      kind: 'special' as const,
      key: 'here' as const,
      label: 'Notify active members in this conversation',
      insertText: '@here',
    },
  ];

  if (!query) {
    return candidates;
  }

  return candidates.filter((candidate) => candidate.key.startsWith(query));
};

const userMentionCandidateFrom = (
  candidate: ReturnType<typeof normalizeUserSummary>,
): ConversationMentionCandidate | undefined => {
  const insertIdentity = candidate.username?.trim() || candidate.displayName.trim();
  if (!insertIdentity) {
    return undefined;
  }

  return {
    kind: 'user',
    user: candidate,
    insertText: `@${insertIdentity}`,
  };
};

export const buildConversationParticipantsPage = async (
  client: RocketChatClient,
  session: UpstreamSession,
  context: Pick<ConversationAuthorizationContext, 'currentUserId' | 'room'>,
  page: PaginationRequest,
  query?: string,
): Promise<ConversationParticipantsPage> => {
  const response = await client.getConversationMembers(session, {
    roomId: context.room._id,
    roomType: context.room.t,
    count: page.limit,
    offset: page.offset,
    ...(normalizeParticipantSearchQuery(query) ? { filter: normalizeParticipantSearchQuery(query) } : {}),
  });
  const nextCursor = nextCursorFrom(response);

  return {
    conversationId: context.room._id,
    entries: response.members.map((member) => ({
      user: normalizeUserSummary(member),
      self: member._id === context.currentUserId,
    })),
    ...(nextCursor ? { nextCursor } : {}),
  };
};

export const buildConversationMentionCandidates = async (
  client: RocketChatClient,
  session: UpstreamSession,
  context: Pick<ConversationAuthorizationContext, 'currentUserId' | 'room' | 'subscription'>,
  query: string,
  limit: number,
): Promise<ConversationMentionCandidatesResponse> => {
  const memberSearchQuery = memberSearchQueryFromMentionInput(query);
  const normalizedQuery = normalizeMentionSearchValue(query);
  const specialCandidates = specialMentionCandidatesFrom(context, normalizedQuery);
  if (limit <= specialCandidates.length) {
    return {
      conversationId: context.room._id,
      query: normalizedQuery,
      entries: specialCandidates.slice(0, limit),
    };
  }

  const userLimit = Math.max(limit - specialCandidates.length, 0);
  const page = await buildConversationParticipantsPage(
    client,
    session,
    context,
    {
      offset: 0,
      limit: normalizedQuery ? Math.min(Math.max(userLimit * 4, 25), 100) : userLimit,
    },
    memberSearchQuery,
  );

  const rankedUsers = page.entries
    .filter((entry) => !entry.self)
    .map((entry, index) => ({
      candidate: userMentionCandidateFrom(entry.user),
      index,
      score: scoreMentionCandidate(entry.user, normalizedQuery),
    }))
    .filter(
      (entry): entry is {
        candidate: NonNullable<typeof entry.candidate>;
        index: number;
        score: number;
      } => entry.candidate !== undefined && (normalizedQuery.length === 0 || Number.isFinite(entry.score)),
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    })
    .slice(0, userLimit)
    .map((entry) => entry.candidate);

  return {
    conversationId: context.room._id,
    query: normalizedQuery,
    entries: [...rankedUsers, ...specialCandidates],
  };
};
