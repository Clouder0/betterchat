import type {
  ConversationCapabilities,
  ConversationMutationCapabilities,
  MembershipInbox,
} from '@betterchat/contracts';

export const emptyMembershipInbox: MembershipInbox = {
  unreadMessages: 0,
  mentionCount: 0,
  replyCount: 0,
  hasThreadActivity: false,
  hasUncountedActivity: false,
};

export const conversationMutationCapabilitiesFixture = (
  overrides: Partial<ConversationMutationCapabilities> = {},
): ConversationMutationCapabilities => ({
  conversation: true,
  conversationReply: true,
  thread: true,
  threadEchoToConversation: true,
  ...overrides,
});

export const conversationCapabilitiesFixture = ({
  messageMutations,
  mediaMutations,
  ...overrides
}: Partial<Omit<ConversationCapabilities, 'messageMutations' | 'mediaMutations'>> & {
  messageMutations?: Partial<ConversationMutationCapabilities>;
  mediaMutations?: Partial<ConversationMutationCapabilities>;
} = {}): ConversationCapabilities => ({
  star: true,
  hide: true,
  markRead: true,
  markUnread: true,
  react: true,
  messageMutations: conversationMutationCapabilitiesFixture(messageMutations),
  mediaMutations: conversationMutationCapabilitiesFixture({
    threadEchoToConversation: false,
    ...mediaMutations,
  }),
  ...overrides,
});
