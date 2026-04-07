import { beforeAll, describe, expect, test } from 'bun:test';

import type {
  ConversationAttachment,
  ConversationMentionCandidatesResponse,
  ConversationMessageContextSnapshot,
  ConversationParticipantsPage,
  ConversationSnapshot,
  ConversationTimelineSnapshot,
  CreateConversationMessageResponse,
  DeleteMessageResponse,
  DirectConversationLookup,
  DirectorySnapshot,
  EnsureDirectConversationResponse,
  LoginResponse,
  MembershipCommandResponse,
  PublicBootstrap,
  SetReactionResponse,
  UpdateMessageResponse,
  WorkspaceBootstrap,
} from '../../packages/contracts/src';
import {
  BetterChatClient,
  BetterChatConversationStreamClient,
  adminFixture,
  type BetterChatConversationStreamEvent,
  fixtureHistoryMessages,
  fixtureMessages,
  fixturePresence,
  fixtureReactions,
  fixtureUsers,
  getIntegrationEnv,
  imageFixture,
  readSeedManifest,
  rocketChatMessagePermalinkFrom,
  RocketChatRestClient,
  type SeedManifest,
  waitFor,
  waitForBetterChat,
  waitForRocketChat,
} from '../../packages/test-utils/src';
import { restartBetterChatBackendService } from '../backend-stack-control.mjs';

type ApiErrorResponse = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

const env = getIntegrationEnv();
const adminUpstream = new RocketChatRestClient(env.upstreamUrl);
const aliceUpstream = new RocketChatRestClient(env.upstreamUrl);
const bobUpstream = new RocketChatRestClient(env.upstreamUrl);
const charlieUpstream = new RocketChatRestClient(env.upstreamUrl);
let seedManifest: SeedManifest;

const roomByKey = (roomKey: keyof SeedManifest['rooms']) => seedManifest.rooms[roomKey];
const messageByKey = (messageKey: keyof SeedManifest['messages']) => seedManifest.messages[messageKey];
const userByKey = (userKey: keyof SeedManifest['users']) => seedManifest.users[userKey];

const directoryEntryByKey = (snapshot: DirectorySnapshot, roomKey: keyof SeedManifest['rooms']) =>
  snapshot.entries.find((entry) => entry.conversation.id === roomByKey(roomKey).roomId);

const directoryEntryByConversationId = (snapshot: DirectorySnapshot, conversationId: string) =>
  snapshot.entries.find((entry) => entry.conversation.id === conversationId);

const conversationMessageByText = (snapshot: { messages: Array<{ content: { text: string } }> }, text: string) =>
  snapshot.messages.find((message) => message.content.text === text);

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const readPngDimensions = (bytes: ArrayBuffer): { width: number; height: number } | undefined => {
  const buffer = new Uint8Array(bytes);
  if (buffer.byteLength < 24) {
    return undefined;
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (buffer[index] !== PNG_SIGNATURE[index]) {
      return undefined;
    }
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return { width, height };
};

const expectImageAttachment = async (
  client: BetterChatClient,
  attachment: ConversationAttachment | undefined,
): Promise<{
  previewBytes: number;
  sourceBytes: number;
  previewDimensions?: { width: number; height: number };
  sourceDimensions?: { width: number; height: number };
}> => {
  expect(attachment?.kind).toBe('image');
  expect(attachment?.preview.url).toBeDefined();
  expect(attachment?.source.url).toBeDefined();

  const previewResponse = await client.getRaw(attachment!.preview.url);
  expect(previewResponse.status).toBe(200);
  expect(previewResponse.headers.get('content-type')).toContain('image');
  const previewPayload = await previewResponse.arrayBuffer();
  const previewBytes = previewPayload.byteLength;
  expect(previewBytes).toBeGreaterThan(0);

  const sourceResponse = await client.getRaw(attachment!.source.url);
  expect(sourceResponse.status).toBe(200);
  expect(sourceResponse.headers.get('content-type')).toContain('image');
  const sourcePayload = await sourceResponse.arrayBuffer();
  const sourceBytes = sourcePayload.byteLength;
  expect(sourceBytes).toBeGreaterThan(0);

  return {
    previewBytes,
    sourceBytes,
    previewDimensions: readPngDimensions(previewPayload),
    sourceDimensions: readPngDimensions(sourcePayload),
  };
};

const expectApiError = async (response: Response, expectedStatus: number, expectedCode: string) => {
  expect(response.status).toBe(expectedStatus);
  const payload = (await response.json()) as ApiErrorResponse;
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe(expectedCode);
  return payload.error;
};

const createClientForUser = async (username: string, password: string): Promise<BetterChatClient> => {
  const client = new BetterChatClient(env.backendUrl);
  await client.login(username, password);
  return client;
};

const createAliceClient = async (): Promise<BetterChatClient> =>
  createClientForUser(fixtureUsers.alice.username, fixtureUsers.alice.password);

const createConversationStreamForUser = async (
  username: string,
  password: string,
): Promise<{
  client: BetterChatClient;
  stream: BetterChatConversationStreamClient;
}> => {
  const client = await createClientForUser(username, password);
  const stream = new BetterChatConversationStreamClient(env.backendUrl);
  await stream.connect(client.cookieHeader());

  const ready = await stream.nextEvent(
    (event): event is Extract<BetterChatConversationStreamEvent, { type: 'ready' }> => event.type === 'ready',
  );
  expect(ready.mode).toBe('push');
  expect(ready.protocol).toBe('conversation-stream.v1');

  return { client, stream };
};

const createAliceConversationStreamClient = async (): Promise<{
  client: BetterChatClient;
  stream: BetterChatConversationStreamClient;
}> => createConversationStreamForUser(fixtureUsers.alice.username, fixtureUsers.alice.password);

const createUpstreamChannel = async (name: string, members: string[]): Promise<{ roomId: string; name: string }> => {
  const response = await adminUpstream.postJson<{ channel?: { _id: string; name: string } }>('/api/v1/channels.create', {
    name,
    members,
  });

  if (!response.channel) {
    throw new Error(`Failed to create upstream channel ${name}`);
  }

  return {
    roomId: response.channel._id,
    name: response.channel.name,
  };
};

const createUpstreamDirectGroup = async (usernames: string[]): Promise<{ roomId: string }> => {
  const response = await aliceUpstream.postJson<{ room?: { _id: string } }>('/api/v1/im.create', {
    usernames: usernames.join(','),
  });

  if (!response.room?._id) {
    throw new Error(`Failed to create upstream direct group for ${usernames.join(', ')}`);
  }

  return {
    roomId: response.room._id,
  };
};

const sendUpstreamConversationMessage = async (client: RocketChatRestClient, conversationId: string, text: string): Promise<string> => {
  const response = await client.postJson<{ message: { _id: string } }>('/api/v1/chat.sendMessage', {
    message: {
      rid: conversationId,
      msg: text,
    },
  });

  return response.message._id;
};

const sendUpstreamQuotedConversationReply = async (
  client: RocketChatRestClient,
  room: {
    kind: 'channel' | 'group' | 'dm';
    roomId: string;
    name?: string;
  },
  parentMessageId: string,
  text: string,
): Promise<string> => {
  const response = await client.postJson<{ message: { _id: string } }>('/api/v1/chat.sendMessage', {
    message: {
      rid: room.roomId,
      msg: [
        `[ ](${rocketChatMessagePermalinkFrom(env.upstreamUrl, room, parentMessageId)})`,
        text,
      ].join('\n'),
    },
  });

  return response.message._id;
};

const upstreamSubscriptionByRoomId = async (
  client: RocketChatRestClient,
  roomId: string,
): Promise<{ open?: boolean } | undefined> =>
  (await client.getJson<{ subscription?: { open?: boolean } }>(
    `/api/v1/subscriptions.getOne?roomId=${encodeURIComponent(roomId)}`,
  )).subscription;

const readRocketChatSettingValue = async (settingId: string): Promise<unknown> =>
  (await adminUpstream.getJson<{ _id: string; value?: unknown }>(`/api/v1/settings/${encodeURIComponent(settingId)}`)).value;

const writeRocketChatSettingValue = async (settingId: string, value: unknown): Promise<void> => {
  await adminUpstream.postJson(`/api/v1/settings/${encodeURIComponent(settingId)}`, { value });
};

const restartBetterChatBackend = async (): Promise<void> => {
  restartBetterChatBackendService();
  await waitForBetterChat(env.backendUrl);
};

const sendUpstreamThreadMessage = async (
  client: RocketChatRestClient,
  conversationId: string,
  threadId: string,
  text: string,
  echoToConversation = false,
): Promise<void> => {
  await client.postJson('/api/v1/chat.sendMessage', {
    message: {
      rid: conversationId,
      msg: text,
      tmid: threadId,
      ...(echoToConversation ? { tshow: true } : {}),
    },
  });
};

const setUpstreamOwnStatus = async (client: RocketChatRestClient, status: 'online' | 'away' | 'busy' | 'offline'): Promise<void> => {
  await client.postJson('/api/v1/users.setStatus', { status });
};

const imageFormData = (
  caption?: string,
  options?: {
    targetKind?: 'conversation' | 'thread';
    replyToMessageId?: string;
    threadId?: string;
    echoToConversation?: boolean;
  },
): FormData => {
  const formData = new FormData();
  formData.set('file', new File([Buffer.from(imageFixture.bytes)], imageFixture.fileName, { type: imageFixture.contentType }));
  if (caption) {
    formData.set('text', caption);
  }

  if (options?.targetKind === 'thread') {
    formData.set('targetKind', 'thread');
    if (options.threadId) {
      formData.set('threadId', options.threadId);
    }
    if (options.echoToConversation !== undefined) {
      formData.set('echoToConversation', String(options.echoToConversation));
    }
    return formData;
  }

  if (options?.replyToMessageId) {
    formData.set('replyToMessageId', options.replyToMessageId);
  }

  return formData;
};

beforeAll(async () => {
  await waitForRocketChat(env.upstreamUrl);
  await waitForBetterChat(env.backendUrl);
  seedManifest = readSeedManifest(env.seedManifestPath);

  await adminUpstream.login('admin', 'AdminPass123!');
  await aliceUpstream.login(fixtureUsers.alice.username, fixtureUsers.alice.password);
  await bobUpstream.login(fixtureUsers.bob.username, fixtureUsers.bob.password);
  await charlieUpstream.login(fixtureUsers.charlie.username, fixtureUsers.charlie.password);
});

describe('BetterChat backend integration', () => {
  test('serves public bootstrap and login/workspace/logout flow', async () => {
    const publicBootstrapResponse = await fetch(new URL('/api/public/bootstrap', env.backendUrl));
    expect(publicBootstrapResponse.status).toBe(200);
    const publicBootstrap = (await publicBootstrapResponse.json()) as { ok: true; data: PublicBootstrap };
    expect(publicBootstrap.data.server.siteName).toBe(seedManifest.workspace.siteName);
    expect(publicBootstrap.data.login.passwordEnabled).toBe(true);

    const client = new BetterChatClient(env.backendUrl);
    const loginResponse = await client.loginRaw(fixtureUsers.alice.username, fixtureUsers.alice.password);
    expect(loginResponse.status).toBe(200);
    const loginPayload = (await loginResponse.json()) as { ok: true; data: LoginResponse };
    expect(loginPayload.data.user.username).toBe(fixtureUsers.alice.username);
    expect(client.cookieHeader()).toBeDefined();

    const workspace = await client.get<WorkspaceBootstrap>('/api/workspace');
    expect(workspace.workspace.name).toBe(seedManifest.workspace.siteName);
    expect(workspace.currentUser.username).toBe(fixtureUsers.alice.username);
    expect(workspace.capabilities.canSendMessages).toBe(true);
    expect(workspace.capabilities.canUploadImages).toBe(true);
    expect(workspace.capabilities.realtimeEnabled).toBe(true);

    await client.logout();
    const workspaceAfterLogout = await client.getRaw('/api/workspace');
    await expectApiError(workspaceAfterLogout, 401, 'UNAUTHENTICATED');
  });

  test('returns seeded directory and conversation snapshots with canonical inbox semantics', async () => {
    const client = await createAliceClient();
    const directory = await client.get<DirectorySnapshot>('/api/directory');

    const publicMain = directoryEntryByKey(directory, 'publicMain');
    const publicQuiet = directoryEntryByKey(directory, 'publicQuiet');
    const publicEmpty = directoryEntryByKey(directory, 'publicEmpty');
    const publicReadonly = directoryEntryByKey(directory, 'publicReadonly');
    const privateHidden = directoryEntryByKey(directory, 'privateHidden');
    const dmBob = directoryEntryByKey(directory, 'dmBob');
    const dmCharlie = directoryEntryByKey(directory, 'dmCharlie');

    expect(publicMain?.membership.starred).toBe(true);
    expect(publicMain?.membership.inbox.unreadMessages).toBe(1);
    expect(publicMain?.membership.inbox.mentionCount).toBe(1);
    expect(publicMain?.membership.inbox.replyCount).toBe(1);
    expect(publicMain?.membership.inbox.hasThreadActivity).toBe(true);
    expect(publicMain?.membership.inbox.hasUncountedActivity).toBe(false);

    expect(publicQuiet?.membership.inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
    expect(publicEmpty?.membership.inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
    expect(publicReadonly?.membership.inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
    expect(privateHidden?.membership.listing).toBe('hidden');
    expect(dmBob?.membership.inbox.unreadMessages).toBe(1);
    expect(dmBob?.membership.inbox.mentionCount).toBe(0);
    expect(dmBob?.membership.inbox.replyCount).toBe(0);
    expect(dmBob?.live?.counterpartPresence).toBe(fixturePresence.bob);
    expect(dmCharlie?.live?.counterpartPresence).toBe(fixturePresence.charlie);

    const publicConversation = await client.get<ConversationSnapshot>(`/api/conversations/${roomByKey('publicMain').roomId}`);
    expect(publicConversation.conversation.title).toBe(roomByKey('publicMain').title);
    expect(publicConversation.conversation.topic).toBe(roomByKey('publicMain').topic);
    expect(publicConversation.conversation.description).toBe(roomByKey('publicMain').description);
    expect(publicConversation.conversation.announcement).toBe(roomByKey('publicMain').announcement);
    expect(publicConversation.membership.inbox.unreadMessages).toBe(1);
    expect(publicConversation.membership.inbox.mentionCount).toBe(1);
    expect(publicConversation.membership.inbox.replyCount).toBe(1);
    expect(publicConversation.membership.inbox.hasThreadActivity).toBe(true);
    expect(publicConversation.capabilities.messageMutations.conversation).toBe(true);
    expect(publicConversation.capabilities.messageMutations.conversationReply).toBe(true);
    expect(publicConversation.capabilities.messageMutations.thread).toBe(true);
    expect(publicConversation.capabilities.messageMutations.threadEchoToConversation).toBe(true);
    expect(publicConversation.capabilities.mediaMutations.conversation).toBe(true);
    expect(publicConversation.capabilities.mediaMutations.conversationReply).toBe(true);
    expect(publicConversation.capabilities.mediaMutations.thread).toBe(true);
    expect(publicConversation.capabilities.mediaMutations.threadEchoToConversation).toBe(false);

    const readonlyConversation = await client.get<ConversationSnapshot>(`/api/conversations/${roomByKey('publicReadonly').roomId}`);
    expect(readonlyConversation.conversation.title).toBe(roomByKey('publicReadonly').title);
    expect(readonlyConversation.capabilities.messageMutations.conversation).toBe(false);
    expect(readonlyConversation.capabilities.messageMutations.conversationReply).toBe(false);
    expect(readonlyConversation.capabilities.messageMutations.thread).toBe(false);
    expect(readonlyConversation.capabilities.mediaMutations.conversation).toBe(false);
    expect(readonlyConversation.capabilities.mediaMutations.conversationReply).toBe(false);
    expect(readonlyConversation.capabilities.mediaMutations.thread).toBe(false);
    expect(readonlyConversation.capabilities.react).toBe(false);

    const dmConversation = await client.get<ConversationSnapshot>(`/api/conversations/${roomByKey('dmBob').roomId}`);
    expect(dmConversation.conversation.kind).toEqual({ mode: 'direct' });
    expect(dmConversation.live?.counterpartPresence).toBe(fixturePresence.bob);
  });

  test('lists authoritative conversation participants and room-scoped mention candidates', async () => {
    const client = await createAliceClient();
    const publicConversationId = roomByKey('publicMain').roomId;
    const dmConversationId = roomByKey('dmBob').roomId;

    const firstParticipantsPage = await client.get<ConversationParticipantsPage>(
      `/api/conversations/${publicConversationId}/participants?limit=2`,
    );
    expect(firstParticipantsPage.entries).toHaveLength(2);
    expect(firstParticipantsPage.nextCursor).toBeDefined();

    const secondParticipantsPage = await client.get<ConversationParticipantsPage>(
      `/api/conversations/${publicConversationId}/participants?limit=2&cursor=${encodeURIComponent(firstParticipantsPage.nextCursor!)}`,
    );
    expect(secondParticipantsPage.nextCursor).toBeUndefined();

    const participantUsernames = [...firstParticipantsPage.entries, ...secondParticipantsPage.entries]
      .map((entry) => entry.user.username)
      .sort();
    expect(participantUsernames).toEqual(expect.arrayContaining(['alice', 'bob', 'charlie']));
    expect(new Set(participantUsernames).size).toBeGreaterThanOrEqual(3);
    expect([...firstParticipantsPage.entries, ...secondParticipantsPage.entries].some((entry) => entry.self && entry.user.username === 'alice'))
      .toBe(true);

    const filteredParticipants = await client.get<ConversationParticipantsPage>(
      `/api/conversations/${publicConversationId}/participants?q=bo`,
    );
    expect(filteredParticipants.entries.map((entry) => entry.user.username)).toEqual(['bob']);

    const publicMentions = await client.get<ConversationMentionCandidatesResponse>(
      `/api/conversations/${publicConversationId}/mention-candidates?q=bo`,
    );
    expect(publicMentions.query).toBe('bo');
    expect(publicMentions.entries).toEqual([
      {
        kind: 'user',
        user: {
          id: userByKey('bob').userId,
          username: fixtureUsers.bob.username,
          displayName: fixtureUsers.bob.displayName,
          avatarUrl: `/api/media/avatar/${encodeURIComponent(fixtureUsers.bob.username)}`,
          presence: fixturePresence.bob,
        },
        insertText: '@bob',
      },
    ]);

    const publicMentionsWithExplicitMarker = await client.get<ConversationMentionCandidatesResponse>(
      `/api/conversations/${publicConversationId}/mention-candidates?q=${encodeURIComponent('@bo')}`,
    );
    expect(publicMentionsWithExplicitMarker.query).toBe('bo');
    expect(publicMentionsWithExplicitMarker.entries).toEqual(publicMentions.entries);

    const publicMentionsWithSpecials = await client.get<ConversationMentionCandidatesResponse>(
      `/api/conversations/${publicConversationId}/mention-candidates`,
    );
    expect(publicMentionsWithSpecials.entries.some((entry) => entry.kind === 'special' && entry.key === 'all')).toBe(true);
    expect(publicMentionsWithSpecials.entries.some((entry) => entry.kind === 'special' && entry.key === 'here')).toBe(true);

    const directMentions = await client.get<ConversationMentionCandidatesResponse>(
      `/api/conversations/${dmConversationId}/mention-candidates`,
    );
    expect(directMentions.entries.some((entry) => entry.kind === 'special')).toBe(false);
    expect(directMentions.entries).toEqual([
      {
        kind: 'user',
        user: {
          id: userByKey('bob').userId,
          username: fixtureUsers.bob.username,
          displayName: fixtureUsers.bob.displayName,
          avatarUrl: `/api/media/avatar/${encodeURIComponent(fixtureUsers.bob.username)}`,
          presence: fixturePresence.bob,
        },
        insertText: '@bob',
      },
    ]);
  });

  test('projects exact per-message actions for foreign and self-authored main-timeline messages', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicQuiet').roomId;
    const foreignText = `[betterchat] foreign action projection ${Date.now()}`;
    const ownText = `[betterchat] own action projection ${Date.now()}`;

    const foreignMessageId = await sendUpstreamConversationMessage(bobUpstream, conversationId, foreignText);

    await waitFor('foreign message becomes visible with no self-owned actions', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const foreignMessage = timeline.messages.find((message) => message.id === foreignMessageId);

      expect(foreignMessage?.actions).toEqual({
        edit: false,
        delete: false,
      });
    }, 20_000, 500);

    const ownMessage = await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text: ownText,
      },
    });

    expect(ownMessage.message.actions).toEqual({
      edit: true,
      delete: true,
    });

    await waitFor('own message is projected with self-owned actions in the timeline', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const message = timeline.messages.find((entry) => entry.id === ownMessage.message.id);

      expect(message?.actions).toEqual({
        edit: true,
        delete: true,
      });
    }, 20_000, 500);
  });

  test('projects readonly capabilities from Rocket.Chat authorization for privileged admins', { timeout: 30_000 }, async () => {
    const adminClient = await createClientForUser(adminFixture.username, adminFixture.password);
    const room = await createUpstreamChannel(`betterchat-admin-readonly-${Date.now()}`, ['alice']);
    const aliceMessageId = await sendUpstreamConversationMessage(
      aliceUpstream,
      room.roomId,
      `[betterchat] admin readonly foreign message ${Date.now()}`,
    );

    await adminUpstream.postJson('/api/v1/channels.setReadOnly', {
      roomId: room.roomId,
      readOnly: true,
    });

    const snapshot = await adminClient.get<ConversationSnapshot>(`/api/conversations/${room.roomId}`);
    expect(snapshot.capabilities.messageMutations.conversation).toBe(true);
    expect(snapshot.capabilities.messageMutations.threadEchoToConversation).toBe(true);
    expect(snapshot.capabilities.mediaMutations.conversation).toBe(true);
    expect(snapshot.capabilities.react).toBe(true);

    await waitFor('admin timeline projects delete permission for foreign readonly messages', async () => {
      const timeline = await adminClient.get<ConversationTimelineSnapshot>(`/api/conversations/${room.roomId}/timeline`);
      const foreignMessage = timeline.messages.find((message) => message.id === aliceMessageId);

      expect(foreignMessage?.actions?.delete).toBe(true);
    }, 20_000, 500);

    const sent = await adminClient.post<CreateConversationMessageResponse>(`/api/conversations/${room.roomId}/messages`, {
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text: `[betterchat] admin readonly send ${Date.now()}`,
      },
    });
    expect(sent.message.content.text).toContain('[betterchat] admin readonly send');

    const deleted = await adminClient.delete<DeleteMessageResponse>(
      `/api/conversations/${room.roomId}/messages/${aliceMessageId}`,
    );
    expect(deleted.messageId).toBe(aliceMessageId);
  });

  test('looks up and ensures direct conversations by stable user id', async () => {
    const client = await createAliceClient();

    const bobLookup = await client.get<DirectConversationLookup>(
      `/api/users/${userByKey('bob').userId}/direct-conversation`,
    );
    expect(bobLookup.user.id).toBe(userByKey('bob').userId);
    expect(bobLookup.user.username).toBe(fixtureUsers.bob.username);
    expect(bobLookup.user.displayName).toBe(fixtureUsers.bob.displayName);
    expect(bobLookup.user.avatarUrl).toBe('/api/media/avatar/bob');
    expect(bobLookup.user.presence).toBe(fixturePresence.bob);
    expect(bobLookup.conversation).toEqual({
      state: 'listed',
      conversationId: roomByKey('dmBob').roomId,
    });

    await client.post<MembershipCommandResponse>(
      `/api/conversations/${roomByKey('dmCharlie').roomId}/membership/commands`,
      {
        type: 'set-listing',
        value: 'hidden',
      },
    );

    const hiddenLookup = await client.get<DirectConversationLookup>(
      `/api/users/${userByKey('charlie').userId}/direct-conversation`,
    );
    expect(hiddenLookup.conversation).toEqual({
      state: 'hidden',
      conversationId: roomByKey('dmCharlie').roomId,
    });

    const reopened = await client.put<EnsureDirectConversationResponse>(
      `/api/users/${userByKey('charlie').userId}/direct-conversation`,
      {},
    );
    expect(reopened.conversationId).toBe(roomByKey('dmCharlie').roomId);
    expect(reopened.disposition).toBe('existing-hidden-opened');
    expect(reopened.sync.directoryVersion).toBeDefined();
    expect(reopened.sync.conversationVersion).toBeDefined();
    expect(reopened.sync.timelineVersion).toBeDefined();

    await waitFor('reopened direct conversation returns to listed state', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directoryEntryByConversationId(directory, roomByKey('dmCharlie').roomId);
      expect(entry?.membership.listing).toBe('listed');
    }, 20_000, 500);

    const danaLookup = await client.get<DirectConversationLookup>(
      `/api/users/${userByKey('dana').userId}/direct-conversation`,
    );
    expect(danaLookup.user.id).toBe(userByKey('dana').userId);
    expect(danaLookup.user.username).toBe(fixtureUsers.dana.username);
    expect(danaLookup.user.displayName).toBe(fixtureUsers.dana.displayName);
    expect(danaLookup.conversation).toEqual({
      state: 'none',
    });

    const ensuredDana = await client.put<EnsureDirectConversationResponse>(
      `/api/users/${userByKey('dana').userId}/direct-conversation`,
      {},
    );
    expect(ensuredDana.disposition).toBe('created');
    expect(ensuredDana.user.id).toBe(userByKey('dana').userId);
    expect(ensuredDana.sync.directoryVersion).toBeDefined();
    expect(ensuredDana.sync.conversationVersion).toBeDefined();
    expect(ensuredDana.sync.timelineVersion).toBeDefined();

    await waitFor('created direct conversation is listed in the directory', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directoryEntryByConversationId(directory, ensuredDana.conversationId);
      expect(entry?.conversation.kind).toEqual({ mode: 'direct' });
      expect(entry?.conversation.title).toBe(fixtureUsers.dana.displayName);
      expect(entry?.conversation.handle).toBe(fixtureUsers.dana.username);
      expect(entry?.membership.listing).toBe('listed');
    }, 20_000, 500);

    const danaConversation = await client.get<ConversationSnapshot>(
      `/api/conversations/${ensuredDana.conversationId}`,
    );
    expect(danaConversation.conversation.kind).toEqual({ mode: 'direct' });
    expect(danaConversation.conversation.title).toBe(fixtureUsers.dana.displayName);

    await createUpstreamDirectGroup([fixtureUsers.bob.username, fixtureUsers.charlie.username]);
    const bobLookupAfterGroupDm = await client.get<DirectConversationLookup>(
      `/api/users/${userByKey('bob').userId}/direct-conversation`,
    );
    expect(bobLookupAfterGroupDm.conversation).toEqual({
      state: 'listed',
      conversationId: roomByKey('dmBob').roomId,
    });
  });

  test('returns canonical timelines, pagination, thread timelines, and message context', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const threadRootId = messageByKey('publicThreadParent').messageId!;

    const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
    expect(timeline.scope).toEqual({
      kind: 'conversation',
      conversationId,
    });
    expect(timeline.unreadAnchorMessageId).toBe(messageByKey('publicUnreadMention').messageId);
    expect(conversationMessageByText(timeline, fixtureMessages.publicWelcome)).toBeDefined();
    expect(conversationMessageByText(timeline, fixtureMessages.publicEditedFinal)?.state.edited).toBe(true);
    expect(conversationMessageByText(timeline, fixtureMessages.publicThreadReplyHidden)).toBeUndefined();
    expect(conversationMessageByText(timeline, fixtureMessages.publicWelcome)?.reactions).toContainEqual({
      emoji: fixtureReactions.publicWelcome,
      count: 1,
      reacted: false,
    });

    const quietConversationId = roomByKey('publicQuiet').roomId;
    const firstPage = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${quietConversationId}/timeline?limit=3`);
    expect(firstPage.messages).toHaveLength(3);
    expect(firstPage.nextCursor).toBeDefined();

    const texts = [...firstPage.messages.map((message) => message.content.text)];
    let nextCursor = firstPage.nextCursor;
    while (nextCursor) {
      const page = await client.get<ConversationTimelineSnapshot>(
        `/api/conversations/${quietConversationId}/timeline?limit=3&cursor=${encodeURIComponent(nextCursor)}`,
      );
      texts.push(...page.messages.map((message) => message.content.text));
      nextCursor = page.nextCursor;
    }
    expect(texts).toEqual(expect.arrayContaining(fixtureHistoryMessages.publicQuiet));

    const thread = await client.get<ConversationTimelineSnapshot>(
      `/api/conversations/${conversationId}/threads/${threadRootId}/timeline`,
    );
    expect(thread.scope).toEqual({
      kind: 'thread',
      conversationId,
      threadId: threadRootId,
    });
    expect(thread.threadRoot?.id).toBe(threadRootId);
    expect(conversationMessageByText(thread, fixtureMessages.publicThreadReply)).toBeDefined();
    expect(conversationMessageByText(thread, fixtureMessages.publicThreadReplyHidden)).toBeDefined();

    const context = await client.get<ConversationMessageContextSnapshot>(
      `/api/conversations/${conversationId}/messages/${threadRootId}/context?before=1&after=1`,
    );
    expect(context.conversationId).toBe(conversationId);
    expect(context.anchorMessageId).toBe(threadRootId);
    expect(context.messages[context.anchorIndex]?.id).toBe(threadRootId);
  });

  test('refreshes plain HTTP snapshots within the same session after upstream changes', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicQuiet').roomId;

    await client.post<MembershipCommandResponse>(
      `/api/conversations/${conversationId}/membership/commands`,
      {
        type: 'mark-read',
        includeThreads: true,
      },
    );

    const baselineConversation = await client.get<ConversationSnapshot>(`/api/conversations/${conversationId}`);
    const baselineDirectory = await client.get<DirectorySnapshot>('/api/directory');
    expect(baselineConversation.membership.inbox.unreadMessages).toBe(0);
    expect(directoryEntryByConversationId(baselineDirectory, conversationId)?.membership.inbox.unreadMessages).toBe(0);

    const text = `[betterchat] same-session snapshot refresh ${Date.now()}`;
    const messageId = await sendUpstreamConversationMessage(bobUpstream, conversationId, text);

    await waitFor('same-session plain HTTP snapshots refresh after upstream activity', async () => {
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${conversationId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directoryEntryByConversationId(directory, conversationId);

      expect(conversation.membership.inbox.unreadMessages).toBe(1);
      expect(entry?.membership.inbox.unreadMessages).toBe(1);
      expect(timeline.unreadAnchorMessageId).toBe(messageId);
    }, 20_000, 500);
  });

  test('projects exact replyCount for unseen quoted replies in directory, conversation, and timeline snapshots', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const room = await createUpstreamChannel(`betterchat-quoted-reply-${Date.now()}`, ['alice', 'bob']);

    const root = await client.post<CreateConversationMessageResponse>(`/api/conversations/${room.roomId}/messages`, {
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text: `[betterchat] quoted reply root ${Date.now()}`,
      },
    });

    await client.post<MembershipCommandResponse>(
      `/api/conversations/${room.roomId}/membership/commands`,
      {
        type: 'mark-read',
        includeThreads: true,
      },
    );

    const replyText = `[betterchat] quoted reply unread ${Date.now()}`;
    const replyMessageId = await sendUpstreamQuotedConversationReply(
      bobUpstream,
      {
        kind: 'channel',
        roomId: room.roomId,
        name: room.name,
      },
      root.message.id,
      replyText,
    );

    await waitFor('quoted reply attention is projected exactly from upstream history', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${room.roomId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${room.roomId}/timeline`);
      const entry = directoryEntryByConversationId(directory, room.roomId);

      expect(entry?.membership.inbox).toEqual({
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 1,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });
      expect(conversation.membership.inbox).toEqual({
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 1,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });
      expect(timeline.unreadAnchorMessageId).toBe(replyMessageId);
      expect(conversationMessageByText(timeline, replyText)?.replyTo?.messageId).toBe(root.message.id);
    }, 20_000, 500);
  });

  test('derives exact unread counts from subscription ts when ls is absent', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const room = await createUpstreamChannel(`betterchat-ts-baseline-${Date.now()}`, ['alice', 'bob']);

    await waitFor('new room is visible before first message arrives', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directoryEntryByConversationId(directory, room.roomId);

      expect(entry).toBeDefined();
      expect(entry?.membership.inbox).toEqual({
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });
    }, 20_000, 500);

    const text = `[betterchat] ts-baseline unread ${Date.now()}`;
    const messageId = await sendUpstreamConversationMessage(bobUpstream, room.roomId, text);

    await waitFor('ts-baseline unread is projected exactly without a fabricated quiet-activity fallback', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${room.roomId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${room.roomId}/timeline`);
      const entry = directoryEntryByConversationId(directory, room.roomId);

      expect(entry?.membership.inbox).toEqual({
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });
      expect(conversation.membership.inbox).toEqual({
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });
      expect(timeline.unreadAnchorMessageId).toBe(messageId);
    }, 20_000, 500);
  });

  test('projects thread-only activity into lastActivityAt without fabricating main-timeline unread', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const room = await createUpstreamChannel(`betterchat-thread-activity-${Date.now()}`, ['alice', 'bob']);
    const root = await client.post<CreateConversationMessageResponse>(
      `/api/conversations/${room.roomId}/messages`,
      {
        target: {
          kind: 'conversation',
        },
        content: {
          format: 'markdown',
          text: `[betterchat] thread root ${Date.now()}`,
        },
      },
    );

    await client.post<MembershipCommandResponse>(
      `/api/conversations/${room.roomId}/membership/commands`,
      {
        type: 'mark-read',
        includeThreads: true,
      },
    );

    const beforeDirectory = await client.get<DirectorySnapshot>('/api/directory');
    const beforeEntry = directoryEntryByConversationId(beforeDirectory, room.roomId);
    expect(beforeEntry?.membership.inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
    expect(beforeEntry?.conversation.lastActivityAt).toBeDefined();
    const beforeLastActivityAt = beforeEntry!.conversation.lastActivityAt!;

    await sendUpstreamThreadMessage(
      bobUpstream,
      room.roomId,
      root.message.id,
      `[betterchat] thread-only activity ${Date.now()}`,
      false,
    );

    await waitFor('thread-only activity updates inbox thread state and activity timestamp', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${room.roomId}`);
      const entry = directoryEntryByConversationId(directory, room.roomId);

      expect(entry?.membership.inbox).toEqual({
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: true,
        hasUncountedActivity: false,
      });
      expect(conversation.membership.inbox).toEqual({
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: true,
        hasUncountedActivity: false,
      });
      expect(entry?.conversation.lastActivityAt).toBeDefined();
      expect(Date.parse(entry!.conversation.lastActivityAt!)).toBeGreaterThan(Date.parse(beforeLastActivityAt));
    }, 20_000, 500);
  });

  test('rejects non-root thread targets on canonical routes', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const replyMessageId = messageByKey('publicThreadReply').messageId!;

    const threadTimelineResponse = await client.getRaw(`/api/conversations/${conversationId}/threads/${replyMessageId}/timeline`);
    await expectApiError(threadTimelineResponse, 404, 'NOT_FOUND');

    const sendResponse = await client.postRaw(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'thread',
        threadId: replyMessageId,
        echoToConversation: false,
      },
      content: {
        format: 'markdown',
        text: `[betterchat] invalid thread target ${Date.now()}`,
      },
    });
    await expectApiError(sendResponse, 404, 'NOT_FOUND');

    const imageResponse = await client.postFormRaw(
      `/api/conversations/${conversationId}/media`,
      imageFormData(`[betterchat] invalid thread image ${Date.now()}`, {
        targetKind: 'thread',
        threadId: replyMessageId,
        echoToConversation: false,
      }),
    );
    await expectApiError(imageResponse, 404, 'NOT_FOUND');
  });

  test('keeps hidden conversations hidden when failed send and media requests short-circuit before success', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('privateHidden').roomId;
    const foreignMessageId = messageByKey('publicWelcome').messageId!;

    expect((await upstreamSubscriptionByRoomId(aliceUpstream, conversationId))?.open).toBe(false);

    const failedSend = await client.postRaw(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'conversation',
        replyToMessageId: foreignMessageId,
      },
      content: {
        format: 'markdown',
        text: `[betterchat] hidden send failure ${Date.now()}`,
      },
    });
    await expectApiError(failedSend, 404, 'NOT_FOUND');
    expect((await upstreamSubscriptionByRoomId(aliceUpstream, conversationId))?.open).toBe(false);

    const failedMedia = await client.postFormRaw(
      `/api/conversations/${conversationId}/media`,
      imageFormData(`[betterchat] hidden media failure ${Date.now()}`, {
        replyToMessageId: foreignMessageId,
      }),
    );
    await expectApiError(failedMedia, 404, 'NOT_FOUND');
    expect((await upstreamSubscriptionByRoomId(aliceUpstream, conversationId))?.open).toBe(false);

    const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${conversationId}`);
    const directory = await client.get<DirectorySnapshot>('/api/directory');

    expect(conversation.membership.listing).toBe('hidden');
    expect(directoryEntryByConversationId(directory, conversationId)?.membership.listing).toBe('hidden');
  });

  test('proxies avatar and seeded attachment media', async () => {
    const client = await createAliceClient();
    const directory = await client.get<DirectorySnapshot>('/api/directory');
    const bobAvatarUrl = directoryEntryByKey(directory, 'dmBob')?.conversation.avatarUrl;
    expect(bobAvatarUrl).toBeDefined();

    const avatarResponse = await client.getRaw(bobAvatarUrl!);
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get('content-type')).toContain('image');

    const conversationId = roomByKey('publicMain').roomId;
    const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
    const imageMessage = timeline.messages.find((message) => message.attachments?.some((attachment) => attachment.title === imageFixture.fileName));
    const imageAttachment = imageMessage?.attachments?.[0];
    expect(imageAttachment?.kind).toBe('image');
    expect(imageAttachment?.preview.url).not.toBe(imageAttachment?.source.url);
    expect(imageAttachment?.preview.width).toBeDefined();
    expect(imageAttachment?.preview.height).toBeDefined();

    const imageAssets = await expectImageAttachment(client, imageAttachment);
    expect(imageAttachment?.preview.width).toBeLessThanOrEqual(imageFixture.width);
    expect(imageAttachment?.preview.height).toBeLessThanOrEqual(imageFixture.height);
    expect(imageAssets.previewDimensions).toEqual({
      width: imageAttachment!.preview.width!,
      height: imageAttachment!.preview.height!,
    });
    expect(imageAssets.sourceDimensions).toEqual({
      width: imageFixture.width,
      height: imageFixture.height,
    });
  });

  test('creates conversation replies, thread replies, and timeline-visible broadcast replies', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const parentMessageId = messageByKey('publicWelcome').messageId!;
    const threadRootId = messageByKey('publicThreadParent').messageId!;
    const mainText = `[betterchat] canonical main ${Date.now()}`;
    const replyText = `[betterchat] canonical reply ${Date.now()}`;
    const threadOnlyText = `[betterchat] canonical thread-only ${Date.now()}`;
    const broadcastText = `[betterchat] canonical thread-broadcast ${Date.now()}`;

    const mainMessage = await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text: mainText,
      },
    });
    expect(mainMessage.message.content.text).toBe(mainText);
    expect(mainMessage.sync).toBeUndefined();

    const replyMessage = await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'conversation',
        replyToMessageId: parentMessageId,
      },
      content: {
        format: 'markdown',
        text: replyText,
      },
    });
    expect(replyMessage.message.replyTo?.messageId).toBe(parentMessageId);

    await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'thread',
        threadId: threadRootId,
        echoToConversation: false,
      },
      content: {
        format: 'markdown',
        text: threadOnlyText,
      },
    });

    await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'thread',
        threadId: threadRootId,
        echoToConversation: true,
      },
      content: {
        format: 'markdown',
        text: broadcastText,
      },
    });

    await waitFor('conversation timeline reflects created canonical messages', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      expect(conversationMessageByText(timeline, mainText)).toBeDefined();
      expect(conversationMessageByText(timeline, replyText)?.replyTo?.messageId).toBe(parentMessageId);
      expect(conversationMessageByText(timeline, threadOnlyText)).toBeUndefined();
      expect(conversationMessageByText(timeline, broadcastText)).toBeDefined();
    }, 20_000, 500);

    await waitFor('thread timeline reflects thread-only and broadcast replies', async () => {
      const threadTimeline = await client.get<ConversationTimelineSnapshot>(
        `/api/conversations/${conversationId}/threads/${threadRootId}/timeline`,
      );
      expect(conversationMessageByText(threadTimeline, threadOnlyText)).toBeDefined();
      expect(conversationMessageByText(threadTimeline, broadcastText)).toBeDefined();
    }, 20_000, 500);
  });

  test('reuses submission ids as canonical Rocket.Chat text message ids for deterministic reconciliation', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicQuiet').roomId;
    const submissionId = `betterchat-submission-${Date.now()}`;
    const text = `[betterchat] submission reconciliation ${Date.now()}`;

    const sent = await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      submissionId,
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text,
      },
    });

    expect(sent.message.id).toBe(submissionId);
    expect(sent.message.submissionId).toBe(submissionId);
    expect(sent.message.content.text).toBe(text);

    await waitFor('conversation timeline reflects submission-aware canonical ids', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const message = timeline.messages.find((entry) => entry.id === submissionId);

      expect(message).toBeDefined();
      expect(message?.content.text).toBe(text);
    }, 20_000, 500);
  });

  test('uploads conversation and thread images through the canonical media endpoint', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const parentMessageId = messageByKey('publicWelcome').messageId!;
    const threadRootId = messageByKey('publicThreadParent').messageId!;
    const conversationCaption = `[betterchat] canonical image ${Date.now()}`;
    const quotedConversationCaption = `[betterchat] canonical quoted image ${Date.now()}`;
    const threadCaption = `[betterchat] canonical thread image ${Date.now()}`;

    const uploadedConversation = await client.postForm<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/media`,
      imageFormData(conversationCaption),
    );
    const conversationAttachment = uploadedConversation.message.attachments?.[0];
    expect(conversationAttachment?.kind).toBe('image');
    expect(uploadedConversation.message.content.text).toBe(conversationCaption);
    expect(conversationAttachment?.preview.url).toBeDefined();
    expect(conversationAttachment?.source.url).toBeDefined();
    expect(conversationAttachment?.preview.url).not.toBe(conversationAttachment?.source.url);

    const uploadedConversationReply = await client.postForm<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/media`,
      imageFormData(quotedConversationCaption, {
        replyToMessageId: parentMessageId,
      }),
    );
    const quotedConversationAttachment = uploadedConversationReply.message.attachments?.[0];
    expect(quotedConversationAttachment?.kind).toBe('image');
    expect(uploadedConversationReply.message.content.text).toBe(quotedConversationCaption);
    expect(uploadedConversationReply.message.replyTo?.messageId).toBe(parentMessageId);
    expect(quotedConversationAttachment?.preview.url).toBeDefined();
    expect(quotedConversationAttachment?.source.url).toBeDefined();
    expect(quotedConversationAttachment?.preview.url).not.toBe(quotedConversationAttachment?.source.url);

    const uploadedThread = await client.postForm<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/media`,
      imageFormData(threadCaption, {
        targetKind: 'thread',
        threadId: threadRootId,
        echoToConversation: false,
      }),
    );
    const threadAttachment = uploadedThread.message.attachments?.[0];
    expect(threadAttachment?.kind).toBe('image');
    expect(uploadedThread.message.content.text).toBe(threadCaption);
    expect(threadAttachment?.preview.url).toBeDefined();
    expect(threadAttachment?.source.url).toBeDefined();
    expect(threadAttachment?.preview.url).not.toBe(threadAttachment?.source.url);

    const conversationImage = await expectImageAttachment(client, conversationAttachment);
    expect(conversationAttachment?.preview.width).toBeDefined();
    expect(conversationAttachment?.preview.height).toBeDefined();
    expect(conversationAttachment?.preview.width).toBeLessThanOrEqual(imageFixture.width);
    expect(conversationAttachment?.preview.height).toBeLessThanOrEqual(imageFixture.height);
    expect(conversationImage.previewDimensions).toEqual({
      width: conversationAttachment!.preview.width!,
      height: conversationAttachment!.preview.height!,
    });
    expect(conversationImage.sourceDimensions).toEqual({
      width: imageFixture.width,
      height: imageFixture.height,
    });

    const quotedConversationImage = await expectImageAttachment(client, quotedConversationAttachment);
    expect(quotedConversationAttachment?.preview.width).toBeDefined();
    expect(quotedConversationAttachment?.preview.height).toBeDefined();
    expect(quotedConversationAttachment?.preview.width).toBeLessThanOrEqual(imageFixture.width);
    expect(quotedConversationAttachment?.preview.height).toBeLessThanOrEqual(imageFixture.height);
    expect(quotedConversationImage.previewDimensions).toEqual({
      width: quotedConversationAttachment!.preview.width!,
      height: quotedConversationAttachment!.preview.height!,
    });
    expect(quotedConversationImage.sourceDimensions).toEqual({
      width: imageFixture.width,
      height: imageFixture.height,
    });

    const threadImage = await expectImageAttachment(client, threadAttachment);
    expect(threadAttachment?.preview.width).toBeDefined();
    expect(threadAttachment?.preview.height).toBeDefined();
    expect(threadAttachment?.preview.width).toBeLessThanOrEqual(imageFixture.width);
    expect(threadAttachment?.preview.height).toBeLessThanOrEqual(imageFixture.height);
    expect(threadImage.previewDimensions).toEqual({
      width: threadAttachment!.preview.width!,
      height: threadAttachment!.preview.height!,
    });
    expect(threadImage.sourceDimensions).toEqual({
      width: imageFixture.width,
      height: imageFixture.height,
    });

    await waitFor('conversation upload is visible only in the main timeline', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const attachment = conversationMessageByText(timeline, conversationCaption)?.attachments?.[0];
      expect(attachment?.kind).toBe('image');
      expect(attachment?.preview.url).toBeDefined();
      expect(attachment?.source.url).toBeDefined();
      expect(conversationMessageByText(timeline, quotedConversationCaption)?.replyTo?.messageId).toBe(parentMessageId);
      expect(conversationMessageByText(timeline, threadCaption)).toBeUndefined();
    }, 20_000, 500);

    await waitFor('thread upload is visible in the thread timeline', async () => {
      const threadTimeline = await client.get<ConversationTimelineSnapshot>(
        `/api/conversations/${conversationId}/threads/${threadRootId}/timeline`,
      );
      const attachment = conversationMessageByText(threadTimeline, threadCaption)?.attachments?.[0];
      expect(attachment?.kind).toBe('image');
      expect(attachment?.preview.url).toBeDefined();
      expect(attachment?.source.url).toBeDefined();
    }, 20_000, 500);
  });

  test('updates, reacts to, unreactions, and deletes canonical messages', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const originalText = `[betterchat] canonical lifecycle ${Date.now()}`;
    const parentMessageId = messageByKey('publicWelcome').messageId!;
    const editedWithReplyText = `${originalText} edited with reply`;
    const preservedReplyText = `${originalText} preserved reply`;
    const clearedReplyText = `${originalText} cleared reply`;

    const sent = await client.post<CreateConversationMessageResponse>(`/api/conversations/${conversationId}/messages`, {
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text: originalText,
      },
    });

    const updatedWithReply = await client.patch<UpdateMessageResponse>(
      `/api/conversations/${conversationId}/messages/${sent.message.id}`,
      {
        text: editedWithReplyText,
        replyToMessageId: parentMessageId,
      },
    );
    expect(updatedWithReply.message.content.text).toBe(editedWithReplyText);
    expect(updatedWithReply.message.state.edited).toBe(true);
    expect(updatedWithReply.message.replyTo?.messageId).toBe(parentMessageId);

    const preservedReply = await client.patch<UpdateMessageResponse>(
      `/api/conversations/${conversationId}/messages/${sent.message.id}`,
      { text: preservedReplyText },
    );
    expect(preservedReply.message.content.text).toBe(preservedReplyText);
    expect(preservedReply.message.replyTo?.messageId).toBe(parentMessageId);

    const clearedReply = await client.patch<UpdateMessageResponse>(
      `/api/conversations/${conversationId}/messages/${sent.message.id}`,
      {
        text: clearedReplyText,
        replyToMessageId: null,
      },
    );
    expect(clearedReply.message.content.text).toBe(clearedReplyText);
    expect(clearedReply.message.replyTo).toBeUndefined();

    await waitFor('edited message reply state is reflected in the canonical timeline', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const editedMessage = timeline.messages.find((entry) => entry.id === sent.message.id);

      expect(editedMessage?.content.text).toBe(clearedReplyText);
      expect(editedMessage?.replyTo).toBeUndefined();
    }, 20_000, 500);

    const reacted = await client.post<SetReactionResponse>(
      `/api/conversations/${conversationId}/messages/${sent.message.id}/reactions`,
      { emoji: ':rocket:' },
    );
    expect(reacted.reactions).toContainEqual({
      emoji: ':rocket:',
      count: 1,
      reacted: true,
    });

    const unreacted = await client.post<SetReactionResponse>(
      `/api/conversations/${conversationId}/messages/${sent.message.id}/reactions`,
      { emoji: ':rocket:', shouldReact: false },
    );
    expect(unreacted.reactions?.some((reaction) => reaction.emoji === ':rocket:' && reaction.reacted)).not.toBe(true);

    const deleted = await client.delete<DeleteMessageResponse>(`/api/conversations/${conversationId}/messages/${sent.message.id}`);
    expect(deleted.messageId).toBe(sent.message.id);

    await waitFor('deleted message is reflected in the canonical timeline', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const message = timeline.messages.find((entry) => entry.id === sent.message.id);
      expect(message).toBeDefined();
      expect(message?.state.deleted).toBe(true);
      expect(message?.authoredAt).toBe(sent.message.authoredAt);
    }, 20_000, 500);

    const refreshedTimeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
    const refreshedMessage = refreshedTimeline.messages.find((entry) => entry.id === sent.message.id);
    expect(refreshedMessage).toBeDefined();
    expect(refreshedMessage?.state.deleted).toBe(true);
  });

  test('supports canonical membership commands for starred, listing, and read state', async () => {
    const client = await createAliceClient();
    const favoriteConversationId = roomByKey('privateMain').roomId;
    const hiddenConversationId = roomByKey('privateHidden').roomId;
    const readConversationId = roomByKey('publicQuiet').roomId;

    const starred = await client.post<MembershipCommandResponse>(
      `/api/conversations/${favoriteConversationId}/membership/commands`,
      {
        type: 'set-starred',
        value: true,
      },
    );
    expect(starred.conversationId).toBe(favoriteConversationId);
    expect(starred.sync.directoryVersion).toBeDefined();
    expect((await client.get<ConversationSnapshot>(`/api/conversations/${favoriteConversationId}`)).membership.starred).toBe(true);

    await client.post<MembershipCommandResponse>(`/api/conversations/${favoriteConversationId}/membership/commands`, {
      type: 'set-starred',
      value: false,
    });

    const listed = await client.post<MembershipCommandResponse>(
      `/api/conversations/${hiddenConversationId}/membership/commands`,
      {
        type: 'set-listing',
        value: 'listed',
      },
    );
    expect(listed.sync.directoryVersion).toBeDefined();
    expect((await client.get<ConversationSnapshot>(`/api/conversations/${hiddenConversationId}`)).membership.listing).toBe('listed');

    await client.post<MembershipCommandResponse>(`/api/conversations/${hiddenConversationId}/membership/commands`, {
      type: 'set-listing',
      value: 'hidden',
    });

    const timelineBeforeUnread = await client.get<ConversationTimelineSnapshot>(
      `/api/conversations/${readConversationId}/timeline?limit=20`,
    );
    const unreadAnchorId = [...timelineBeforeUnread.messages]
      .reverse()
      .find((message) => message.author.username !== fixtureUsers.alice.username)?.id;
    expect(unreadAnchorId).toBeDefined();

    const unread = await client.post<MembershipCommandResponse>(
      `/api/conversations/${readConversationId}/membership/commands`,
      {
        type: 'mark-unread',
        fromMessageId: unreadAnchorId,
      },
    );
    expect(unread.sync.directoryVersion).toBeDefined();

    await waitFor('canonical conversation becomes unread', async () => {
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${readConversationId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${readConversationId}/timeline?limit=20`);
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directory.entries.find((candidate) => candidate.conversation.id === readConversationId);

      expect(conversation.membership.inbox.unreadMessages).toBeGreaterThan(0);
      expect(timeline.unreadAnchorMessageId).toBe(unreadAnchorId);
      expect(entry?.membership.inbox.unreadMessages).toBeGreaterThan(0);
    }, 20_000, 500);

    const read = await client.post<MembershipCommandResponse>(
      `/api/conversations/${readConversationId}/membership/commands`,
      {
        type: 'mark-read',
        includeThreads: true,
      },
    );
    expect(read.sync.timelineVersion).toBeDefined();

    await waitFor('canonical conversation becomes read again', async () => {
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${readConversationId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${readConversationId}/timeline?limit=20`);
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directory.entries.find((candidate) => candidate.conversation.id === readConversationId);

      expect(conversation.membership.inbox).toEqual({
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });
      expect(timeline.unreadAnchorMessageId).toBeUndefined();
      expect(entry?.membership.inbox.unreadMessages).toBe(0);
    }, 20_000, 500);
  });

  test('rejects illegal mark-unread anchors that are hidden from the main conversation timeline', async () => {
    const client = await createAliceClient();
    const response = await client.postRaw(`/api/conversations/${roomByKey('publicMain').roomId}/membership/commands`, {
      type: 'mark-unread',
      fromMessageId: messageByKey('publicThreadReplyHidden').messageId,
    });

    expect(response.status).toBe(400);
    expect((await response.json()) as ApiErrorResponse).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  test('expands the first timeline page when the unread anchor falls outside the requested page', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const room = await createUpstreamChannel(`betterchat-unread-page-${Date.now()}`, ['alice', 'bob']);

    await waitFor('fresh room is visible before unread anchor pagination test', async () => {
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      expect(directoryEntryByConversationId(directory, room.roomId)).toBeDefined();
    }, 20_000, 500);

    const messageIds: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      messageIds.push(await sendUpstreamConversationMessage(
        bobUpstream,
        room.roomId,
        `[betterchat] bounded unread page ${Date.now()}-${index}`,
      ));
    }

    await waitFor('room reflects the posted history before mark-read', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${room.roomId}/timeline?limit=25`);
      expect(timeline.messages).toHaveLength(25);
    }, 20_000, 500);

    await client.post<MembershipCommandResponse>(
      `/api/conversations/${room.roomId}/membership/commands`,
      {
        type: 'mark-read',
        includeThreads: true,
      },
    );

    await client.post<MembershipCommandResponse>(
      `/api/conversations/${room.roomId}/membership/commands`,
      {
        type: 'mark-unread',
        fromMessageId: messageIds[4]!,
      },
    );

    await waitFor('first timeline page expands until the unread anchor is present', async () => {
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${room.roomId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${room.roomId}/timeline?limit=20`);

      expect(conversation.membership.inbox.unreadMessages).toBeGreaterThan(20);
      expect(timeline.messages).toHaveLength(21);
      expect(timeline.unreadAnchorMessageId).toBe(messageIds[4]);
      expect(timeline.messages[0]?.id).toBe(messageIds[4]);
      expect(timeline.messages.at(-1)?.id).toBe(messageIds.at(-1));
    }, 20_000, 500);
  });

  test('preserves thread-only activity when mark-read does not include threads', { timeout: 30_000 }, async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const text = `[betterchat] plain read semantics ${Date.now()}`;

    await sendUpstreamConversationMessage(bobUpstream, conversationId, text);

    await waitFor('public main has fresh main unread plus thread activity before plain mark-read', async () => {
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${conversationId}`);
      expect(conversation.membership.inbox.unreadMessages).toBeGreaterThan(0);
      expect(conversation.membership.inbox.hasThreadActivity).toBe(true);
    }, 20_000, 500);

    const read = await client.post<MembershipCommandResponse>(
      `/api/conversations/${conversationId}/membership/commands`,
      {
        type: 'mark-read',
      },
    );
    expect(read.sync.timelineVersion).toBeDefined();

    await waitFor('plain mark-read clears main unread state but keeps thread activity', async () => {
      const conversation = await client.get<ConversationSnapshot>(`/api/conversations/${conversationId}`);
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const directory = await client.get<DirectorySnapshot>('/api/directory');
      const entry = directory.entries.find((candidate) => candidate.conversation.id === conversationId);

      expect(conversation.membership.inbox.unreadMessages).toBe(0);
      expect(conversation.membership.inbox.mentionCount).toBe(0);
      expect(conversation.membership.inbox.hasThreadActivity).toBe(true);
      expect(timeline.unreadAnchorMessageId).toBeUndefined();
      expect(entry?.membership.inbox.unreadMessages).toBe(0);
      expect(entry?.membership.inbox.hasThreadActivity).toBe(true);
    }, 20_000, 500);
  });

  test('streams canonical directory patches with exact inactive-conversation unread counts', async () => {
    const { client, stream } = await createAliceConversationStreamClient();

    try {
      stream.send({ type: 'ping' });
      const pong = await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'pong' }> => event.type === 'pong',
      );
      expect(pong.type).toBe('pong');

      stream.send({ type: 'watch-directory' });
      const initialDirectory = await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'directory.resynced' }> => event.type === 'directory.resynced',
      );
      expect(directoryEntryByKey(initialDirectory.snapshot, 'publicQuiet')?.membership.inbox).toEqual({
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });

      const conversationId = roomByKey('publicQuiet').roomId;
      const text = `[betterchat] stream inactive unread ${Date.now()}`;
      const entryUpsertPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'directory.entry.upsert' }> =>
          event.type === 'directory.entry.upsert' && event.entry.conversation.id === conversationId,
      );

      await sendUpstreamConversationMessage(bobUpstream, conversationId, text);
      const directoryUpsert = await entryUpsertPromise;
      expect(directoryUpsert.entry.membership.inbox.unreadMessages).toBe(1);
      expect(directoryUpsert.entry.membership.inbox.mentionCount).toBe(0);
      expect(directoryUpsert.entry.membership.inbox.hasThreadActivity).toBe(false);

      await waitFor('directory snapshot reflects inactive-conversation unread count', async () => {
        const directory = await client.get<DirectorySnapshot>('/api/directory');
        const entry = directory.entries.find((candidate) => candidate.conversation.id === conversationId);
        expect(entry?.membership.inbox.unreadMessages).toBe(1);
      }, 20_000, 500);
    } finally {
      stream.close();
    }
  });

  test('streams replyCount updates for inactive quoted replies without frontend inference', async () => {
    const room = await createUpstreamChannel(`betterchat-stream-reply-${Date.now()}`, ['alice', 'bob']);
    const client = await createAliceClient();
    const root = await client.post<CreateConversationMessageResponse>(`/api/conversations/${room.roomId}/messages`, {
      target: {
        kind: 'conversation',
      },
      content: {
        format: 'markdown',
        text: `[betterchat] stream reply root ${Date.now()}`,
      },
    });
    await client.post<MembershipCommandResponse>(
      `/api/conversations/${room.roomId}/membership/commands`,
      {
        type: 'mark-read',
        includeThreads: true,
      },
    );

    const stream = new BetterChatConversationStreamClient(env.backendUrl);
    await stream.connect(client.cookieHeader());

    try {
      await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'ready' }> => event.type === 'ready',
      );

      stream.send({ type: 'watch-directory' });
      const initialDirectory = await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'directory.resynced' }> => event.type === 'directory.resynced',
      );
      expect(directoryEntryByConversationId(initialDirectory.snapshot, room.roomId)?.membership.inbox).toEqual({
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });

      const replyText = `[betterchat] stream quoted reply ${Date.now()}`;
      const entryUpsertPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'directory.entry.upsert' }> =>
          event.type === 'directory.entry.upsert' && event.entry.conversation.id === room.roomId,
      );

      await sendUpstreamQuotedConversationReply(
        bobUpstream,
        {
          kind: 'channel',
          roomId: room.roomId,
          name: room.name,
        },
        root.message.id,
        replyText,
      );

      const directoryUpsert = await entryUpsertPromise;
      expect(directoryUpsert.entry.membership.inbox).toEqual({
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 1,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      });

      await waitFor('directory snapshot reflects streamed reply attention', async () => {
        const directory = await client.get<DirectorySnapshot>('/api/directory');
        const entry = directoryEntryByConversationId(directory, room.roomId);
        expect(entry?.membership.inbox).toEqual({
          unreadMessages: 1,
          mentionCount: 0,
          replyCount: 1,
          hasThreadActivity: false,
          hasUncountedActivity: false,
        });
      }, 20_000, 500);
    } finally {
      stream.close();
    }
  });

  test('streams conversation and thread updates plus typing and presence events', async () => {
    const conversationId = roomByKey('publicMain').roomId;
    const threadRootId = messageByKey('publicThreadParent').messageId!;
    const roomText = `[betterchat] stream room ${Date.now()}`;
    const threadText = `[betterchat] stream thread ${Date.now()}`;
    const { client, stream } = await createAliceConversationStreamClient();
    const { stream: bobStream } = await createConversationStreamForUser(fixtureUsers.bob.username, fixtureUsers.bob.password);

    try {
      stream.send({
        type: 'watch-conversation',
        conversationId,
      });
      const watchedConversation = await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'conversation.resynced' }> =>
          event.type === 'conversation.resynced' && event.snapshot.conversation.id === conversationId,
      );
      expect(watchedConversation.snapshot.conversation.id).toBe(conversationId);

      const watchedTimeline = await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'timeline.resynced' }> =>
          event.type === 'timeline.resynced'
          && event.snapshot.scope.kind === 'conversation'
          && event.snapshot.scope.conversationId === conversationId,
      );
      expect(watchedTimeline.snapshot.scope.kind).toBe('conversation');

      stream.send({
        type: 'watch-thread',
        conversationId,
        threadId: threadRootId,
      });
      const watchedThread = await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'thread.resynced' }> =>
          event.type === 'thread.resynced'
          && event.snapshot.scope.kind === 'thread'
          && event.snapshot.scope.threadId === threadRootId,
      );
      expect(watchedThread.snapshot.threadRoot?.id).toBe(threadRootId);

      const conversationUpdatedPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'conversation.updated' }> =>
          event.type === 'conversation.updated' && event.snapshot.conversation.id === conversationId,
      );
      const timelineUpdatedPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'timeline.resynced' }> =>
          event.type === 'timeline.resynced'
          && event.snapshot.scope.kind === 'conversation'
          && event.snapshot.scope.conversationId === conversationId
          && conversationMessageByText(event.snapshot, roomText) !== undefined,
      );

      await sendUpstreamConversationMessage(bobUpstream, conversationId, roomText);
      await conversationUpdatedPromise;
      await timelineUpdatedPromise;

      await waitFor('conversation timeline reflects streamed main-timeline activity', async () => {
        const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
        expect(conversationMessageByText(timeline, roomText)).toBeDefined();
      }, 20_000, 500);

      const threadUpdatedPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'thread.resynced' }> =>
          event.type === 'thread.resynced'
          && event.snapshot.scope.kind === 'thread'
          && event.snapshot.scope.threadId === threadRootId
          && conversationMessageByText(event.snapshot, threadText) !== undefined,
      );

      await sendUpstreamThreadMessage(bobUpstream, conversationId, threadRootId, threadText, false);
      await threadUpdatedPromise;

      await waitFor('thread timeline reflects streamed thread activity', async () => {
        const threadTimeline = await client.get<ConversationTimelineSnapshot>(
          `/api/conversations/${conversationId}/threads/${threadRootId}/timeline`,
        );
        expect(conversationMessageByText(threadTimeline, threadText)).toBeDefined();
      }, 20_000, 500);

      const typingUpdatedPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'typing.updated' }> =>
          event.type === 'typing.updated' && event.conversationId === conversationId && event.participants.length > 0,
      );
      bobStream.send({
        type: 'set-typing',
        conversationId,
        typing: true,
      });
      const typingUpdated = await typingUpdatedPromise;
      expect(typingUpdated.participants.length).toBeGreaterThan(0);

      const dmConversationId = roomByKey('dmBob').roomId;
      stream.send({
        type: 'watch-conversation',
        conversationId: dmConversationId,
      });
      await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'conversation.resynced' }> =>
          event.type === 'conversation.resynced' && event.snapshot.conversation.id === dmConversationId,
      );
      await stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'timeline.resynced' }> =>
          event.type === 'timeline.resynced'
          && event.snapshot.scope.kind === 'conversation'
          && event.snapshot.scope.conversationId === dmConversationId,
      );

      const nextPresence = fixturePresence.bob === 'busy' ? 'away' : 'busy';
      const presenceUpdatedPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'presence.updated' }> =>
          event.type === 'presence.updated' && event.conversationId === dmConversationId && event.presence === nextPresence,
        20_000,
      );
      await setUpstreamOwnStatus(bobUpstream, nextPresence);
      const presenceUpdated = await presenceUpdatedPromise;
      expect(presenceUpdated.presence).toBe(nextPresence);

      await setUpstreamOwnStatus(bobUpstream, fixturePresence.bob);
    } finally {
      stream.close();
      bobStream.close();
    }
  });

  test('invalidates the conversation stream session after logout', async () => {
    const { client, stream } = await createAliceConversationStreamClient();

    try {
      const invalidatedPromise = stream.nextEvent(
        (event): event is Extract<BetterChatConversationStreamEvent, { type: 'session.invalidated' }> =>
          event.type === 'session.invalidated',
      );

      await client.logout();
      await invalidatedPromise;

      const workspaceAfterLogout = await client.getRaw('/api/workspace');
      await expectApiError(workspaceAfterLogout, 401, 'UNAUTHENTICATED');
    } finally {
      stream.close();
    }
  });

  test('gates thread capabilities and thread operations when Rocket.Chat threads are disabled', { timeout: 30_000 }, async () => {
    const settingId = 'Threads_enabled';
    const originalValue = await readRocketChatSettingValue(settingId);

    await writeRocketChatSettingValue(settingId, false);

    try {
      const client = await createAliceClient();
      const conversationId = roomByKey('publicMain').roomId;
      const threadRootId = messageByKey('publicThreadParent').messageId!;

      await waitFor('fresh conversation snapshots project disabled thread capabilities', async () => {
        const snapshot = await client.get<ConversationSnapshot>(`/api/conversations/${conversationId}`);

        expect(snapshot.capabilities.messageMutations.thread).toBe(false);
        expect(snapshot.capabilities.messageMutations.threadEchoToConversation).toBe(false);
        expect(snapshot.capabilities.mediaMutations.thread).toBe(false);
        expect(snapshot.capabilities.mediaMutations.threadEchoToConversation).toBe(false);
      }, 20_000, 500);

      const threadTimelineResponse = await client.getRaw(
        `/api/conversations/${conversationId}/threads/${threadRootId}/timeline`,
      );
      await expectApiError(threadTimelineResponse, 403, 'UPSTREAM_REJECTED');

      const threadSendResponse = await client.postRaw(`/api/conversations/${conversationId}/messages`, {
        target: {
          kind: 'thread',
          threadId: threadRootId,
          echoToConversation: false,
        },
        content: {
          format: 'markdown',
          text: `[betterchat] disabled threads send ${Date.now()}`,
        },
      });
      await expectApiError(threadSendResponse, 403, 'UPSTREAM_REJECTED');

      const threadImageResponse = await client.postFormRaw(
        `/api/conversations/${conversationId}/media`,
        imageFormData(`[betterchat] disabled threads image ${Date.now()}`, {
          targetKind: 'thread',
          threadId: threadRootId,
          echoToConversation: false,
        }),
      );
      await expectApiError(threadImageResponse, 403, 'UPSTREAM_REJECTED');
    } finally {
      await writeRocketChatSettingValue(settingId, originalValue ?? true);
    }
  });

  test('deleted message has state.edited false even if previously edited', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;
    const originalText = `[betterchat] edit-then-delete ${Date.now()}`;

    const sent = await client.post<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/messages`,
      { target: { kind: 'conversation' }, content: { format: 'markdown', text: originalText } },
    );

    const edited = await client.patch<UpdateMessageResponse>(
      `/api/conversations/${conversationId}/messages/${sent.message.id}`,
      { text: `${originalText} edited` },
    );
    expect(edited.message.state.edited).toBe(true);
    expect(edited.message.state.deleted).toBe(false);

    await client.delete<DeleteMessageResponse>(`/api/conversations/${conversationId}/messages/${sent.message.id}`);

    await waitFor('deleted message is reflected in timeline', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const message = timeline.messages.find((entry) => entry.id === sent.message.id);
      expect(message).toBeDefined();
      expect(message?.state.deleted).toBe(true);
      expect(message?.state.edited).toBe(false);
    }, 20_000, 500);
  }, 30_000);

  test('reply to deleted message shows deleted placeholder excerpt', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;

    const parentMessage = await client.post<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/messages`,
      { target: { kind: 'conversation' }, content: { format: 'markdown', text: `[betterchat] reply-parent ${Date.now()}` } },
    );

    const replyMessage = await client.post<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/messages`,
      {
        target: { kind: 'conversation', replyToMessageId: parentMessage.message.id },
        content: { format: 'markdown', text: `[betterchat] reply-child ${Date.now()}` },
      },
    );
    expect(replyMessage.message.replyTo?.messageId).toBe(parentMessage.message.id);

    await client.delete<DeleteMessageResponse>(`/api/conversations/${conversationId}/messages/${parentMessage.message.id}`);

    await waitFor('deleted parent is reflected in timeline', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const parent = timeline.messages.find((entry) => entry.id === parentMessage.message.id);
      expect(parent).toBeDefined();
      expect(parent?.state.deleted).toBe(true);
      const reply = timeline.messages.find((entry) => entry.id === replyMessage.message.id);
      expect(reply).toBeDefined();
      expect(reply?.replyTo?.excerpt).toBe('该消息已删除。');
      expect(reply?.replyTo?.long).toBe(false);
    }, 20_000, 500);
  }, 30_000);

  test('deleted tombstones survive BetterChat backend restart', async () => {
    const client = await createAliceClient();
    const conversationId = roomByKey('publicMain').roomId;

    const parentMessage = await client.post<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/messages`,
      { target: { kind: 'conversation' }, content: { format: 'markdown', text: `[betterchat] restart-parent ${Date.now()}` } },
    );
    const replyMessage = await client.post<CreateConversationMessageResponse>(
      `/api/conversations/${conversationId}/messages`,
      {
        target: { kind: 'conversation', replyToMessageId: parentMessage.message.id },
        content: { format: 'markdown', text: `[betterchat] restart-child ${Date.now()}` },
      },
    );

    await client.delete<DeleteMessageResponse>(`/api/conversations/${conversationId}/messages/${parentMessage.message.id}`);

    await waitFor('deleted parent is reflected before restart', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const parent = timeline.messages.find((entry) => entry.id === parentMessage.message.id);
      const reply = timeline.messages.find((entry) => entry.id === replyMessage.message.id);
      expect(parent?.state.deleted).toBe(true);
      expect(reply?.replyTo?.excerpt).toBe('该消息已删除。');
    }, 20_000, 500);

    await restartBetterChatBackend();

    await waitFor('deleted tombstone survives backend restart', async () => {
      const timeline = await client.get<ConversationTimelineSnapshot>(`/api/conversations/${conversationId}/timeline`);
      const parent = timeline.messages.find((entry) => entry.id === parentMessage.message.id);
      const reply = timeline.messages.find((entry) => entry.id === replyMessage.message.id);
      expect(parent).toBeDefined();
      expect(parent?.state.deleted).toBe(true);
      expect(parent?.content.text).toBe('');
      expect(reply).toBeDefined();
      expect(reply?.replyTo?.excerpt).toBe('该消息已删除。');
      expect(reply?.replyTo?.messageId).toBe(parentMessage.message.id);
    }, 20_000, 500);
  }, 60_000);
});
