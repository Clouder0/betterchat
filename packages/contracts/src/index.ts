export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REJECTED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNSUPPORTED_UPSTREAM_BEHAVIOR';

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};

export type ApiResult<T> = ApiSuccess<T> | ApiError;

export type PresenceState = 'online' | 'away' | 'busy' | 'offline';

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status?: string;
};

export type PublicBootstrap = {
  server: {
    version: string;
    siteName?: string;
  };
  login: {
    passwordEnabled: boolean;
    registeredProviders: Array<{
      name: string;
      label: string;
    }>;
  };
  features: {
    registerEnabled: boolean;
  };
};

export type LoginRequest = {
  login: string;
  password: string;
  code?: string;
};

export type LoginResponse = {
  user: SessionUser;
};

export type WorkspaceBootstrap = {
  currentUser: SessionUser;
  workspace: {
    name: string;
    version: string;
  };
  capabilities: {
    canSendMessages: boolean;
    canUploadImages: boolean;
    canUploadImagesInDirectMessages?: boolean;
    realtimeEnabled: boolean;
  };
};

export type ConversationKind =
  | {
      mode: 'direct';
    }
  | {
      mode: 'group';
      privacy: 'public' | 'private';
    };

export type MembershipListing = 'listed' | 'hidden';

export type MembershipInbox = {
  unreadMessages: number;
  mentionCount: number;
  replyCount: number;
  hasThreadActivity: boolean;
  hasUncountedActivity: boolean;
};

export type MembershipSummary = {
  listing: MembershipListing;
  starred: boolean;
  inbox: MembershipInbox;
};

export type ConversationLiveState = {
  counterpartPresence?: PresenceState;
};

export type ConversationPreview = {
  id: string;
  kind: ConversationKind;
  title: string;
  handle?: string;
  avatarUrl?: string;
  lastActivityAt?: string;
};

export type DirectoryEntry = {
  conversation: ConversationPreview;
  membership: MembershipSummary;
  live?: ConversationLiveState;
};

export type DirectorySnapshot = {
  version: string;
  entries: DirectoryEntry[];
};

export type ConversationMutationCapabilities = {
  conversation: boolean;
  conversationReply: boolean;
  thread: boolean;
  threadEchoToConversation: boolean;
};

export type ConversationCapabilities = {
  star: boolean;
  hide: boolean;
  markRead: boolean;
  markUnread: boolean;
  react: boolean;
  messageMutations: ConversationMutationCapabilities;
  mediaMutations: ConversationMutationCapabilities;
};

export type ConversationSnapshot = {
  version: string;
  conversation: ConversationPreview & {
    topic?: string;
    description?: string;
    announcement?: string;
    memberCount?: number;
  };
  membership: MembershipSummary;
  live?: ConversationLiveState;
  capabilities: ConversationCapabilities;
};

export type ConversationParticipant = {
  user: UserSummary;
  self: boolean;
};

export type ConversationParticipantsPage = {
  conversationId: string;
  entries: ConversationParticipant[];
  nextCursor?: string;
};

export type ConversationMentionCandidate =
  | {
      kind: 'user';
      user: UserSummary;
      insertText: string;
    }
  | {
      kind: 'special';
      key: 'all' | 'here';
      label: string;
      insertText: string;
    };

export type ConversationMentionCandidatesResponse = {
  conversationId: string;
  query: string;
  entries: ConversationMentionCandidate[];
};

export type ConversationUserSummary = {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
};

export type UserSummary = {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
  presence?: PresenceState;
};

export type DirectConversationLookup = {
  user: UserSummary;
  conversation:
    | {
        state: 'none';
      }
    | {
        state: MembershipListing;
        conversationId: string;
      };
};

export type EnsureDirectConversationResponse = {
  user: UserSummary;
  conversationId: string;
  disposition: 'existing-listed' | 'existing-hidden-opened' | 'created';
  sync: SnapshotSyncState;
};

export type ConversationMessageReference = {
  messageId: string;
  authorName: string;
  excerpt: string;
  long: boolean;
};

export type ConversationMessageThread = {
  rootMessageId: string;
  replyCount: number;
  lastReplyAt?: string;
};

export type ConversationImageAsset = {
  url: string;
  width?: number;
  height?: number;
};

export type ConversationAttachment =
  | {
      kind: 'image';
      id: string;
      title?: string;
      preview: ConversationImageAsset;
      source: ConversationImageAsset;
    };

export type ConversationReaction = {
  emoji: string;
  count: number;
  reacted: boolean;
};

export type ConversationMessageActions = {
  edit: boolean;
  delete: boolean;
};

export type ConversationMessage = {
  id: string;
  submissionId?: string;
  conversationId: string;
  authoredAt: string;
  updatedAt?: string;
  author: ConversationUserSummary;
  content: {
    format: 'markdown';
    text: string;
  };
  state: {
    edited: boolean;
    deleted: boolean;
  };
  replyTo?: ConversationMessageReference;
  thread?: ConversationMessageThread;
  attachments?: ConversationAttachment[];
  reactions?: ConversationReaction[];
  actions?: ConversationMessageActions;
};

export type TimelineScope =
  | {
      kind: 'conversation';
      conversationId: string;
    }
  | {
      kind: 'thread';
      conversationId: string;
      threadId: string;
    };

export type ConversationTimelineSnapshot = {
  version: string;
  scope: TimelineScope;
  threadRoot?: ConversationMessage;
  messages: ConversationMessage[];
  nextCursor?: string;
  unreadAnchorMessageId?: string;
};

export type ConversationMessageContextSnapshot = {
  version: string;
  conversationId: string;
  anchorMessageId: string;
  anchorIndex: number;
  messages: ConversationMessage[];
  hasBefore: boolean;
  hasAfter: boolean;
};

export type SnapshotSyncState = {
  directoryVersion?: string;
  conversationVersion?: string;
  timelineVersion?: string;
  threadVersion?: string;
};

export type MembershipCommandRequest =
  | {
      type: 'set-starred';
      value: boolean;
    }
  | {
      type: 'set-listing';
      value: MembershipListing;
    }
  | {
      type: 'mark-read';
      includeThreads?: boolean;
    }
  | {
      type: 'mark-unread';
      fromMessageId?: string;
    };

export type MembershipCommandResponse = {
  conversationId: string;
  sync: SnapshotSyncState;
};

export type CreateConversationMessageRequest = {
  submissionId?: string;
  target:
    | {
        kind: 'conversation';
        replyToMessageId?: string;
      }
    | {
        kind: 'thread';
        threadId: string;
        echoToConversation?: boolean;
      };
  content: {
    format: 'markdown';
    text: string;
  };
};

export type CreateConversationMessageResponse = {
  message: ConversationMessage;
  sync?: SnapshotSyncState;
};

export type UpdateMessageRequest = {
  text: string;
  replyToMessageId?: string | null;
};

export type UpdateMessageResponse = {
  message: ConversationMessage;
  sync: SnapshotSyncState;
};

export type DeleteMessageResponse = {
  messageId: string;
  sync: SnapshotSyncState;
};

export type SetReactionRequest = {
  emoji: string;
  shouldReact?: boolean;
};

export type SetReactionResponse = {
  messageId: string;
  reactions?: ConversationReaction[];
  sync: SnapshotSyncState;
};

export type ConversationStreamClientCommand =
  | {
      type: 'watch-directory';
      directoryVersion?: string;
    }
  | {
      type: 'unwatch-directory';
    }
  | {
      type: 'watch-conversation';
      conversationId: string;
      conversationVersion?: string;
      timelineVersion?: string;
    }
  | {
      type: 'unwatch-conversation';
      conversationId: string;
    }
  | {
      type: 'watch-thread';
      conversationId: string;
      threadId: string;
      threadVersion?: string;
    }
  | {
      type: 'unwatch-thread';
      conversationId: string;
      threadId: string;
    }
  | {
      type: 'ping';
    }
  | {
      type: 'set-typing';
      conversationId: string;
      typing: boolean;
    };

export type ConversationStreamServerEvent =
  | {
      type: 'ready';
      mode: 'push';
      protocol: 'conversation-stream.v1';
    }
  | {
      type: 'pong';
    }
  | {
      type: 'directory.resynced';
      snapshot: DirectorySnapshot;
    }
  | {
      type: 'directory.entry.upsert';
      version: string;
      entry: DirectoryEntry;
    }
  | {
      type: 'directory.entry.remove';
      version: string;
      conversationId: string;
    }
  | {
      type: 'conversation.resynced';
      snapshot: ConversationSnapshot;
    }
  | {
      type: 'conversation.updated';
      snapshot: ConversationSnapshot;
    }
  | {
      type: 'timeline.resynced';
      snapshot: ConversationTimelineSnapshot;
    }
  | {
      type: 'thread.resynced';
      snapshot: ConversationTimelineSnapshot;
    }
  | {
      type: 'presence.updated';
      conversationId: string;
      presence: PresenceState;
    }
  | {
      type: 'typing.updated';
      conversationId: string;
      participants: string[];
    }
  | {
      type: 'resync.required';
      scope: 'directory' | 'conversation' | 'thread';
      conversationId?: string;
      threadId?: string;
    }
  | {
      type: 'session.invalidated';
    }
  | {
      type: 'error';
      code: 'VALIDATION_ERROR' | 'UPSTREAM_UNAVAILABLE' | 'UNSUPPORTED_UPSTREAM_BEHAVIOR';
      message: string;
    };
