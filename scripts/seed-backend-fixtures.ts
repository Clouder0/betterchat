import { statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SeedManifest, SeedManifestMessage, SeedManifestRoom } from '../packages/test-utils/src';
import {
  adminFixture,
  clearSeedManifest,
  createMongoClient,
  fixtureHistoryMessages,
  fixtureMessages,
  fixturePresence,
  fixtureReactions,
  fixtureRooms,
  fixtureUsers,
  getIntegrationEnv,
  imageFixture,
  rocketChatMessagePermalinkFrom,
  stripLeadingRocketChatQuotePlaceholders,
  RocketChatRestClient,
  waitFor,
  waitForRocketChat,
  writeSeedManifestAtomically,
} from '../packages/test-utils/src';

type UserInfoResponse = {
  user?: {
    _id: string;
    username: string;
  };
};

type RoomInfoResponse = {
  channel?: { _id: string; name: string };
  group?: { _id: string; name: string };
  room?: { _id: string; name?: string };
};

type MessageRecord = {
  _id: string;
  msg?: string;
  ts?: string;
  tmid?: string;
  tshow?: boolean;
  editedAt?: string;
  _hidden?: boolean;
  _deletedAt?: string;
  t?: string;
  u?: {
    _id: string;
  };
  attachments?: Array<{ title?: string }>;
};

type MessagesResponse = {
  messages?: MessageRecord[];
  total?: number;
};

type SendMessageResponse = {
  message: MessageRecord;
};

type SubscriptionResponse = {
  subscription?: {
    open: boolean;
    f?: boolean;
    unread?: number;
    ls?: string;
  };
};

type UserStatusResponse = {
  status?: string;
};

type PublicSettingsResponse = {
  settings?: Array<{
    _id: string;
    value?: unknown;
  }>;
};

type SyncMessagesResponse = {
  result?: {
    updated?: MessageRecord[];
  };
};

type SeedRoomKey = keyof typeof fixtureRooms;
type SeedRoomDefinition = (typeof fixtureRooms)[SeedRoomKey];
type NamedRoomState = {
  roomId: string;
  title: string;
} & SeedRoomDefinition;

const WORKSPACE_NAME = 'BetterChat Test Workspace';
const AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID = 'Cloud_Workspace_AirGapped_Restrictions_Remaining_Days';
const MANAGED_MESSAGE_PREFIXES = ['[betterchat]', '[probe]'] as const;
const SEED_LOCK_DIR = '/tmp/betterchat-seed.lock';
const SEED_LOCK_TIMEOUT_MS = 120_000;
const SEED_LOCK_POLL_MS = 250;
const SEED_LOCK_STALE_MS = 5 * 60_000;
const seedRunTag = new Date().toISOString();

const dynamicFixtureMessages = {
  publicUnreadMention: `[betterchat][seed:${seedRunTag}] @alice unread mention from bob`,
  dmBobUnread: `[betterchat][seed:${seedRunTag}] seeded unread dm from bob`,
} as const;

const env = getIntegrationEnv();

const adminClient = new RocketChatRestClient(env.upstreamUrl);
const aliceClient = new RocketChatRestClient(env.upstreamUrl);
const bobClient = new RocketChatRestClient(env.upstreamUrl);
const charlieClient = new RocketChatRestClient(env.upstreamUrl);

const roomMessageEndpoint = (kind: SeedRoomDefinition['kind'] | 'dm'): string =>
  kind === 'channel' ? '/api/v1/channels.messages' : kind === 'group' ? '/api/v1/groups.messages' : '/api/v1/im.messages';

const roomApiPrefix = (kind: SeedRoomDefinition['kind']): 'channels' | 'groups' => (kind === 'channel' ? 'channels' : 'groups');

const sleep = (timeoutMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, timeoutMs));

const seedLockIsStale = (): boolean => {
  try {
    return Date.now() - statSync(SEED_LOCK_DIR).mtimeMs > SEED_LOCK_STALE_MS;
  } catch {
    return false;
  }
};

const acquireSeedLock = async (): Promise<(() => Promise<void>)> => {
  const deadline = Date.now() + SEED_LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await mkdir(SEED_LOCK_DIR);
      await writeFile(
        join(SEED_LOCK_DIR, 'owner.json'),
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2),
        'utf8',
      );

      return async () => {
        await rm(SEED_LOCK_DIR, { force: true, recursive: true });
      };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }

      if (seedLockIsStale()) {
        await rm(SEED_LOCK_DIR, { force: true, recursive: true });
        continue;
      }

      await sleep(SEED_LOCK_POLL_MS);
    }
  }

  throw new Error(`Timed out waiting for seed lock ${SEED_LOCK_DIR}`);
};

const ignoreSameValueMutation = async (action: Promise<unknown>): Promise<void> => {
  try {
    await action;
  } catch (error) {
    if (error instanceof Error && error.message.includes('is the same as what it would be changed to')) {
      return;
    }

    throw error;
  }
};

const visibleInMainTimeline = (message: MessageRecord): boolean =>
  message._hidden !== true
  && message._deletedAt === undefined
  && message.t !== 'rm'
  && (message.tmid === undefined || message.tshow === true);

const readPublicSetting = async (settingId: string): Promise<unknown> => {
  const response = await adminClient.getJson<PublicSettingsResponse>(
    `/api/v1/settings.public?_id=${encodeURIComponent(settingId)}`,
  );

  return response.settings?.find((setting) => setting._id === settingId)?.value;
};

const assertWritableWorkspaceForSeed = async (): Promise<void> => {
  const remainingDays = await readPublicSetting(AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID);
  if (remainingDays === 0) {
    throw new Error(
      `Rocket.Chat workspace is read-only for seed writes: ${AIR_GAPPED_RESTRICTION_REMAINING_DAYS_SETTING_ID}=0 (restricted-workspace)`,
    );
  }
};

const ensureSettings = async (): Promise<void> => {
  const mongoClient = createMongoClient(env.mongoUrl);
  await mongoClient.connect();

  try {
    const database = mongoClient.db();
    const settings = database.collection('rocketchat_settings');

    await Promise.all([
      settings.updateOne({ _id: 'Show_Setup_Wizard' }, { $set: { value: 'completed' } }, { upsert: true }),
      settings.updateOne({ _id: 'Organization_Name' }, { $set: { value: WORKSPACE_NAME } }, { upsert: true }),
      settings.updateOne({ _id: 'Site_Name' }, { $set: { value: WORKSPACE_NAME } }, { upsert: true }),
      settings.updateOne({ _id: 'API_Enable_Rate_Limiter_Dev' }, { $set: { value: false } }, { upsert: true }),
      settings.updateOne({ _id: 'Message_MaxAllowedSize' }, { $set: { value: 500000 } }, { upsert: true }),
    ]);
  } finally {
    await mongoClient.close();
  }
};

const maybeGetUser = async (username: string): Promise<UserInfoResponse['user'] | undefined> => {
  try {
    const response = await adminClient.getJson<UserInfoResponse>(`/api/v1/users.info?username=${encodeURIComponent(username)}`);
    return response.user;
  } catch {
    return undefined;
  }
};

const deleteOneToOneDirectConversation = async ({
  firstUserId,
  secondUserId,
  firstUsername,
  secondUsername,
}: {
  firstUserId: string;
  secondUserId: string;
  firstUsername: string;
  secondUsername: string;
}): Promise<void> => {
  const mongoClient = createMongoClient(env.mongoUrl);
  await mongoClient.connect();

  try {
    const database = mongoClient.db();
    const rooms = database.collection('rocketchat_room');
    const messages = database.collection('rocketchat_message');
    const subscriptions = database.collection('rocketchat_subscription');

    const room = await rooms.findOne<{
      _id: string;
    }>({
      t: 'd',
      uids: { $all: [firstUserId, secondUserId], $size: 2 },
      usernames: { $all: [firstUsername, secondUsername], $size: 2 },
    });

    if (!room?._id) {
      return;
    }

    await Promise.all([
      messages.deleteMany({ rid: room._id }),
      subscriptions.deleteMany({ rid: room._id }),
      rooms.deleteOne({ _id: room._id }),
    ]);
  } finally {
    await mongoClient.close();
  }
};

const ensureUser = async (fixture: (typeof fixtureUsers)[keyof typeof fixtureUsers]): Promise<{ _id: string; username: string }> => {
  const existing = await maybeGetUser(fixture.username);
  if (existing) {
    return existing;
  }

  const created = await adminClient.postJson<{ user: { _id: string; username: string } }>('/api/v1/users.create', {
    username: fixture.username,
    name: fixture.displayName,
    email: fixture.email,
    password: fixture.password,
    joinDefaultChannels: false,
  });

  if (!created.user) {
    throw new Error(`Failed to create user ${fixture.username}`);
  }

  return created.user;
};

const maybeGetNamedRoom = async (definition: SeedRoomDefinition): Promise<{ _id: string; name: string } | undefined> => {
  const prefix = roomApiPrefix(definition.kind);

  try {
    const response = await adminClient.getJson<RoomInfoResponse>(
      `/api/v1/${prefix}.info?roomName=${encodeURIComponent(definition.name)}`,
    );

    return definition.kind === 'channel' ? response.channel : response.group;
  } catch {
    return undefined;
  }
};

const createNamedRoom = async (definition: SeedRoomDefinition): Promise<{ _id: string; name: string }> => {
  const prefix = roomApiPrefix(definition.kind);
  let created: { channel?: { _id: string; name: string }; group?: { _id: string; name: string } };

  try {
    created = await adminClient.postJson<{ channel?: { _id: string; name: string }; group?: { _id: string; name: string } }>(
      `/api/v1/${prefix}.create`,
      {
        name: definition.name,
        members: [...definition.members],
      },
    );
  } catch (error) {
    const existing = await maybeGetNamedRoom(definition);
    if (existing) {
      return existing;
    }

    throw error;
  }

  const room = definition.kind === 'channel' ? created.channel : created.group;
  if (!room) {
    throw new Error(`Failed to create seeded ${definition.kind} ${definition.name}`);
  }

  return room;
};

const setRoomReadOnly = async (
  kind: SeedRoomDefinition['kind'],
  roomId: string,
  readOnly: boolean,
): Promise<void> => {
  const prefix = roomApiPrefix(kind);
  await ignoreSameValueMutation(
    adminClient.postJson(`/api/v1/${prefix}.setReadOnly`, { roomId, readOnly }),
  );
};

const ensureNamedRoom = async (definition: SeedRoomDefinition): Promise<NamedRoomState> => {
  const room = (await maybeGetNamedRoom(definition)) || (await createNamedRoom(definition));
  const prefix = roomApiPrefix(definition.kind);

  const metadataUpdates = [
    definition.topic !== undefined
      ? ignoreSameValueMutation(adminClient.postJson(`/api/v1/${prefix}.setTopic`, { roomId: room._id, topic: definition.topic }))
      : undefined,
    definition.description !== undefined
      ? ignoreSameValueMutation(
          adminClient.postJson(`/api/v1/${prefix}.setDescription`, { roomId: room._id, description: definition.description }),
        )
      : undefined,
    definition.announcement !== undefined
      ? ignoreSameValueMutation(
          adminClient.postJson(`/api/v1/${prefix}.setAnnouncement`, { roomId: room._id, announcement: definition.announcement }),
        )
      : undefined,
  ].filter((value): value is Promise<unknown> => value !== undefined);

  if (metadataUpdates.length > 0) {
    await Promise.all(metadataUpdates);
  }

  return {
    ...definition,
    roomId: room._id,
    title: definition.name,
  };
};

const ensureDmRoom = async (username: keyof typeof fixtureUsers): Promise<SeedManifestRoom> => {
  const response = await aliceClient.postJson<{ room: { _id: string } }>('/api/v1/im.create', {
    username: fixtureUsers[username].username,
  });

  if (!response.room) {
    throw new Error(`Failed to create seeded DM room with ${fixtureUsers[username].username}`);
  }

  return {
    roomId: response.room._id,
    kind: 'dm',
    title: fixtureUsers[username].displayName,
  };
};

const getSubscription = async (roomId: string): Promise<SubscriptionResponse['subscription']> => {
  const response = await aliceClient.getJson<SubscriptionResponse>(`/api/v1/subscriptions.getOne?roomId=${encodeURIComponent(roomId)}`);
  return response.subscription;
};

const syncMessagesSince = async (roomId: string, lastUpdate: string): Promise<MessageRecord[]> => {
  const response = await aliceClient.getJson<SyncMessagesResponse>(
    `/api/v1/chat.syncMessages?roomId=${encodeURIComponent(roomId)}&lastUpdate=${encodeURIComponent(lastUpdate)}`,
  );
  return response.result?.updated || [];
};

const setAliceRoomState = async (roomId: string, favorite: boolean, hidden: boolean): Promise<void> => {
  const subscription = await getSubscription(roomId);

  if (Boolean(subscription?.f) !== favorite) {
    await aliceClient.postJson('/api/v1/rooms.favorite', { roomId, favorite });
  }

  if (hidden) {
    if (subscription?.open !== false) {
      await aliceClient.postJson('/api/v1/rooms.hide', { roomId });
    }
    return;
  }

  if (subscription?.open === false) {
    await aliceClient.postJson('/api/v1/rooms.open', { roomId });
  }
};

const markReadAsAlice = async (roomId: string): Promise<void> => {
  await aliceClient.postJson('/api/v1/subscriptions.read', { rid: roomId });
};

const verifyExactUnreadBaseline = async ({
  currentUserId,
  roomId,
  expectedAnchorMessageId,
}: {
  currentUserId: string;
  roomId: string;
  expectedAnchorMessageId: string;
}): Promise<void> => {
  const subscription = await getSubscription(roomId);
  if (!subscription?.ls) {
    throw new Error(`Seed verification failed for ${roomId}: subscription.ls is missing`);
  }

  const updatedMessages = await syncMessagesSince(roomId, subscription.ls);
  const unreadMessages = updatedMessages.filter(
    (message) => visibleInMainTimeline(message) && message.u?._id !== currentUserId,
  );

  if (unreadMessages.length !== 1 || unreadMessages[0]?._id !== expectedAnchorMessageId) {
    throw new Error(
      `Seed verification failed for ${roomId}: expected exact unread anchor ${expectedAnchorMessageId}, got ${JSON.stringify(unreadMessages.map((message) => message._id))}`,
    );
  }
};

const ensureOwnStatus = async (
  client: RocketChatRestClient,
  desiredStatus: (typeof fixturePresence)[keyof typeof fixturePresence],
): Promise<void> => {
  const current = await client.getJson<UserStatusResponse>('/api/v1/users.getStatus');
  if (current.status === desiredStatus) {
    return;
  }

  await client.postJson('/api/v1/users.setStatus', {
    status: desiredStatus,
    message: '',
  });
};

const listMessages = async (client: RocketChatRestClient, kind: SeedRoomDefinition['kind'] | 'dm', roomId: string): Promise<MessageRecord[]> => {
  const batchSize = 200;
  const messages: MessageRecord[] = [];
  let offset = 0;
  let total = 0;

  while (true) {
    const response = await client.getJson<MessagesResponse>(
      `${roomMessageEndpoint(kind)}?roomId=${encodeURIComponent(roomId)}&count=${batchSize}&offset=${offset}&sort=${encodeURIComponent(JSON.stringify({ ts: -1 }))}`,
    );
    const batch = response.messages || [];
    messages.push(...batch);
    total = typeof response.total === 'number' ? response.total : offset + batch.length;

    if (batch.length === 0 || offset + batch.length >= total || batch.length < batchSize) {
      return messages;
    }

    offset += batch.length;
  }
};

const isVisibleSeedMessage = (message: MessageRecord): boolean => message._hidden !== true && message.t !== 'rm';

const isManagedMessage = (message: MessageRecord): boolean => {
  const text = stripLeadingRocketChatQuotePlaceholders(message.msg || '').trim();
  return MANAGED_MESSAGE_PREFIXES.some((prefix) => text.startsWith(prefix))
    || Boolean(message.attachments?.some((attachment) => attachment.title === imageFixture.fileName));
};

const deleteMessage = async (roomId: string, messageId: string): Promise<void> => {
  await adminClient.postJson('/api/v1/chat.delete', {
    roomId,
    msgId: messageId,
    asUser: true,
  });
};

const resetManagedMessages = async (kind: SeedRoomDefinition['kind'] | 'dm', roomId: string): Promise<void> => {
  const managedMessages = (await listMessages(aliceClient, kind, roomId)).filter(
    (message) => isVisibleSeedMessage(message) && isManagedMessage(message),
  );
  await Promise.all(managedMessages.map((message) => deleteMessage(roomId, message._id)));
};

const ensureMessage = async ({
  client,
  kind,
  roomId,
  roomName,
  text,
  parentMessageId,
  quotedMessageId,
  visibleInMainTimeline = true,
}: {
  client: RocketChatRestClient;
  kind: SeedRoomDefinition['kind'] | 'dm';
  roomId: string;
  roomName?: string;
  text: string;
  parentMessageId?: string;
  quotedMessageId?: string;
  visibleInMainTimeline?: boolean;
}): Promise<MessageRecord> => {
  const existing = (await listMessages(client, kind, roomId)).find(
    (message) =>
      isVisibleSeedMessage(message)
      && stripLeadingRocketChatQuotePlaceholders(message.msg || '').trim() === text
      && (parentMessageId ? message.tmid === parentMessageId : message.tmid === undefined),
  );

  if (existing) {
    return existing;
  }

  const quotedMessageLink = quotedMessageId
    ? rocketChatMessagePermalinkFrom(
        env.upstreamUrl,
        {
          kind,
          roomId,
          name: roomName,
        },
        quotedMessageId,
      )
    : undefined;

  const response = await client.postJson<SendMessageResponse>('/api/v1/chat.sendMessage', {
    message: {
      rid: roomId,
      msg: quotedMessageLink ? `[ ](${quotedMessageLink})\n${text}` : text,
      ...(parentMessageId
        ? {
            tmid: parentMessageId,
            ...(visibleInMainTimeline ? { tshow: true } : {}),
          }
        : {}),
    },
  });

  return response.message;
};

const ensureMessageSequence = async ({
  client,
  kind,
  roomId,
  texts,
}: {
  client: RocketChatRestClient;
  kind: SeedRoomDefinition['kind'] | 'dm';
  roomId: string;
  texts: readonly string[];
}): Promise<MessageRecord[]> => {
  const messages: MessageRecord[] = [];

  for (const text of texts) {
    messages.push(
      await ensureMessage({
        client,
        kind,
        roomId,
        text,
      }),
    );
  }

  return messages;
};

const ensureEditedMessage = async ({
  client,
  kind,
  roomId,
  originalText,
  finalText,
}: {
  client: RocketChatRestClient;
  kind: SeedRoomDefinition['kind'] | 'dm';
  roomId: string;
  originalText: string;
  finalText: string;
}): Promise<MessageRecord> => {
  const existing = (await listMessages(client, kind, roomId)).find(
    (message) => isVisibleSeedMessage(message) && message.msg === finalText && Boolean(message.editedAt),
  );
  if (existing) {
    return existing;
  }

  const created = await ensureMessage({
    client,
    kind,
    roomId,
    text: originalText,
  });

  const response = await client.postJson<SendMessageResponse>('/api/v1/chat.update', {
    roomId,
    msgId: created._id,
    text: finalText,
  });

  return response.message;
};

const ensureImageMessage = async (roomId: string): Promise<MessageRecord | undefined> => {
  const existingMessages = await listMessages(bobClient, 'channel', roomId);
  const existing = existingMessages.find(
    (message) =>
      isVisibleSeedMessage(message) && message.attachments?.some((attachment) => attachment.title === imageFixture.fileName),
  );

  if (existing) {
    return existing;
  }

  const formData = new FormData();
  formData.set('file', new Blob([imageFixture.bytes], { type: imageFixture.contentType }), imageFixture.fileName);
  const uploadResponse = await bobClient.postForm<{ file: { _id: string } }>(`/api/v1/rooms.media/${roomId}`, formData);
  await bobClient.postJson(`/api/v1/rooms.mediaConfirm/${roomId}/${uploadResponse.file._id}`, {});

  const refreshedMessages = await listMessages(bobClient, 'channel', roomId);
  return refreshedMessages.find((message) => message.attachments?.some((attachment) => attachment.title === imageFixture.fileName));
};

const ensureReaction = async ({
  client,
  messageId,
  emoji,
}: {
  client: RocketChatRestClient;
  messageId: string;
  emoji: string;
}): Promise<void> => {
  const current = await client.getJson<{ message?: MessageRecord & { reactions?: Record<string, { usernames: string[] }> } }>(
    `/api/v1/chat.getMessage?msgId=${encodeURIComponent(messageId)}`,
  );

  if (current.message?.reactions?.[emoji]?.usernames.length) {
    return;
  }

  await client.postJson('/api/v1/chat.react', {
    messageId,
    emoji,
  });
};

await waitForRocketChat(env.upstreamUrl);
const releaseSeedLock = await acquireSeedLock();

try {
  await clearSeedManifest(env.seedManifestPath);
  await waitFor('writable Rocket.Chat workspace', assertWritableWorkspaceForSeed, 20_000, 500);
  await ensureSettings();
  await adminClient.login(adminFixture.username, adminFixture.password);
  const aliceUser = await ensureUser(fixtureUsers.alice);
  const bobUser = await ensureUser(fixtureUsers.bob);
  const charlieUser = await ensureUser(fixtureUsers.charlie);
  const danaUser = await ensureUser(fixtureUsers.dana);
  await deleteOneToOneDirectConversation({
    firstUserId: aliceUser._id,
    secondUserId: danaUser._id,
    firstUsername: fixtureUsers.alice.username,
    secondUsername: fixtureUsers.dana.username,
  });
  await aliceClient.login(fixtureUsers.alice.username, fixtureUsers.alice.password);
  await bobClient.login(fixtureUsers.bob.username, fixtureUsers.bob.password);
  await charlieClient.login(fixtureUsers.charlie.username, fixtureUsers.charlie.password);
  await Promise.all([
    ensureOwnStatus(aliceClient, fixturePresence.alice),
    ensureOwnStatus(bobClient, fixturePresence.bob),
    ensureOwnStatus(charlieClient, fixturePresence.charlie),
  ]);

  const publicMain = await ensureNamedRoom(fixtureRooms.publicMain);
  const publicQuiet = await ensureNamedRoom(fixtureRooms.publicQuiet);
  const publicEmpty = await ensureNamedRoom(fixtureRooms.publicEmpty);
  const publicReadonly = await ensureNamedRoom(fixtureRooms.publicReadonly);
  await setRoomReadOnly(publicReadonly.kind, publicReadonly.roomId, false);
  const privateMain = await ensureNamedRoom(fixtureRooms.privateMain);
  const privateHidden = await ensureNamedRoom(fixtureRooms.privateHidden);
  const dmBob = await ensureDmRoom('bob');
  const dmCharlie = await ensureDmRoom('charlie');

  await Promise.all([
    resetManagedMessages(publicMain.kind, publicMain.roomId),
    resetManagedMessages(publicQuiet.kind, publicQuiet.roomId),
    resetManagedMessages(publicEmpty.kind, publicEmpty.roomId),
    resetManagedMessages(publicReadonly.kind, publicReadonly.roomId),
    resetManagedMessages(privateMain.kind, privateMain.roomId),
    resetManagedMessages(privateHidden.kind, privateHidden.roomId),
    resetManagedMessages('dm', dmBob.roomId),
    resetManagedMessages('dm', dmCharlie.roomId),
  ]);

  const publicWelcome = await ensureMessage({
    client: aliceClient,
    kind: publicMain.kind,
    roomId: publicMain.roomId,
    text: fixtureMessages.publicWelcome,
  });
  await ensureReaction({
    client: bobClient,
    messageId: publicWelcome._id,
    emoji: fixtureReactions.publicWelcome,
  });
  const publicEdited = await ensureEditedMessage({
    client: aliceClient,
    kind: publicMain.kind,
    roomId: publicMain.roomId,
    originalText: fixtureMessages.publicEditedOriginal,
    finalText: fixtureMessages.publicEditedFinal,
  });
  const publicThreadParent = await ensureMessage({
    client: aliceClient,
    kind: publicMain.kind,
    roomId: publicMain.roomId,
    text: fixtureMessages.publicThreadParent,
  });
  const publicThreadReply = await ensureMessage({
    client: bobClient,
    kind: publicMain.kind,
    roomId: publicMain.roomId,
    text: fixtureMessages.publicThreadReply,
    parentMessageId: publicThreadParent._id,
  });
  const publicThreadReplyHidden = await ensureMessage({
    client: charlieClient,
    kind: publicMain.kind,
    roomId: publicMain.roomId,
    text: fixtureMessages.publicThreadReplyHidden,
    parentMessageId: publicThreadParent._id,
    visibleInMainTimeline: false,
  });
  const publicImageMessage = await ensureImageMessage(publicMain.roomId);

  await ensureMessageSequence({
    client: charlieClient,
    kind: publicQuiet.kind,
    roomId: publicQuiet.roomId,
    texts: fixtureHistoryMessages.publicQuiet,
  });
  const publicQuietRead = await ensureMessage({
    client: charlieClient,
    kind: publicQuiet.kind,
    roomId: publicQuiet.roomId,
    text: fixtureMessages.publicQuietRead,
  });
  await markReadAsAlice(publicQuiet.roomId);

  const publicReadonlyNote = await ensureMessage({
    client: bobClient,
    kind: publicReadonly.kind,
    roomId: publicReadonly.roomId,
    text: fixtureMessages.publicReadonlyNote,
  });
  await markReadAsAlice(publicReadonly.roomId);
  await setRoomReadOnly(publicReadonly.kind, publicReadonly.roomId, true);

  const privateMainNote = await ensureMessage({
    client: aliceClient,
    kind: privateMain.kind,
    roomId: privateMain.roomId,
    text: fixtureMessages.privateNote,
  });
  await markReadAsAlice(privateMain.roomId);

  const hiddenPrivateNote = await ensureMessage({
    client: charlieClient,
    kind: privateHidden.kind,
    roomId: privateHidden.roomId,
    text: fixtureMessages.hiddenPrivateNote,
  });
  await markReadAsAlice(privateHidden.roomId);

  const dmBobRead = await ensureMessage({
    client: bobClient,
    kind: 'dm',
    roomId: dmBob.roomId,
    text: fixtureMessages.dmBobRead,
  });

  const dmCharlieRead = await ensureMessage({
    client: charlieClient,
    kind: 'dm',
    roomId: dmCharlie.roomId,
    text: fixtureMessages.dmCharlieRead,
  });
  await markReadAsAlice(dmCharlie.roomId);

  await Promise.all([
    setAliceRoomState(publicMain.roomId, publicMain.favoriteForAlice, false),
    setAliceRoomState(publicQuiet.roomId, publicQuiet.favoriteForAlice, false),
    setAliceRoomState(publicEmpty.roomId, publicEmpty.favoriteForAlice, false),
    setAliceRoomState(publicReadonly.roomId, publicReadonly.favoriteForAlice, false),
    setAliceRoomState(privateMain.roomId, privateMain.favoriteForAlice, false),
    setAliceRoomState(privateHidden.roomId, privateHidden.favoriteForAlice, Boolean(privateHidden.hiddenForAlice)),
  ]);

  await markReadAsAlice(publicEmpty.roomId);
  await markReadAsAlice(publicMain.roomId);
  const publicUnreadMention = await ensureMessage({
    client: bobClient,
    kind: publicMain.kind,
    roomId: publicMain.roomId,
    roomName: publicMain.name,
    text: dynamicFixtureMessages.publicUnreadMention,
    quotedMessageId: publicWelcome._id,
  });
  await waitFor(
    'public main unread baseline',
    () =>
      verifyExactUnreadBaseline({
        currentUserId: aliceUser._id,
        roomId: publicMain.roomId,
        expectedAnchorMessageId: publicUnreadMention._id,
      }),
    20_000,
    500,
  );

  await markReadAsAlice(dmBob.roomId);
  const dmBobUnread = await ensureMessage({
    client: bobClient,
    kind: 'dm',
    roomId: dmBob.roomId,
    text: dynamicFixtureMessages.dmBobUnread,
  });
  await waitFor(
    'dm bob unread baseline',
    () =>
      verifyExactUnreadBaseline({
        currentUserId: aliceUser._id,
        roomId: dmBob.roomId,
        expectedAnchorMessageId: dmBobUnread._id,
      }),
    20_000,
    500,
  );

  const manifest: SeedManifest = {
    version: 1,
    seedRunTag,
    workspace: {
      siteName: WORKSPACE_NAME,
    },
    users: {
      alice: {
        userId: aliceUser._id,
        username: fixtureUsers.alice.username,
        displayName: fixtureUsers.alice.displayName,
      },
      bob: {
        userId: bobUser._id,
        username: fixtureUsers.bob.username,
        displayName: fixtureUsers.bob.displayName,
      },
      charlie: {
        userId: charlieUser._id,
        username: fixtureUsers.charlie.username,
        displayName: fixtureUsers.charlie.displayName,
      },
      dana: {
        userId: danaUser._id,
        username: fixtureUsers.dana.username,
        displayName: fixtureUsers.dana.displayName,
      },
    },
    rooms: {
      publicMain,
      publicQuiet,
      publicEmpty,
      publicReadonly,
      privateMain,
      privateHidden,
      dmBob: {
        ...dmBob,
        favoriteForAlice: false,
        hiddenForAlice: false,
      },
      dmCharlie: {
        ...dmCharlie,
        favoriteForAlice: false,
        hiddenForAlice: false,
      },
    } satisfies Record<string, SeedManifestRoom>,
    messages: {
      publicWelcome: {
        roomKey: 'publicMain',
        messageId: publicWelcome._id,
        text: fixtureMessages.publicWelcome,
      },
      publicEdited: {
        roomKey: 'publicMain',
        messageId: publicEdited._id,
        text: fixtureMessages.publicEditedFinal,
      },
      publicThreadParent: {
        roomKey: 'publicMain',
        messageId: publicThreadParent._id,
        text: fixtureMessages.publicThreadParent,
      },
      publicThreadReply: {
        roomKey: 'publicMain',
        messageId: publicThreadReply._id,
        text: fixtureMessages.publicThreadReply,
        parentMessageId: publicThreadParent._id,
      },
      publicThreadReplyHidden: {
        roomKey: 'publicMain',
        messageId: publicThreadReplyHidden._id,
        text: fixtureMessages.publicThreadReplyHidden,
        parentMessageId: publicThreadParent._id,
      },
      publicUnreadMention: {
        roomKey: 'publicMain',
        messageId: publicUnreadMention._id,
        text: dynamicFixtureMessages.publicUnreadMention,
      },
      publicImage: {
        roomKey: 'publicMain',
        messageId: publicImageMessage?._id,
        attachmentTitle: imageFixture.fileName,
      },
      publicQuietRead: {
        roomKey: 'publicQuiet',
        messageId: publicQuietRead._id,
        text: fixtureMessages.publicQuietRead,
      },
      publicReadonlyNote: {
        roomKey: 'publicReadonly',
        messageId: publicReadonlyNote._id,
        text: fixtureMessages.publicReadonlyNote,
      },
      privateNote: {
        roomKey: 'privateMain',
        messageId: privateMainNote._id,
        text: fixtureMessages.privateNote,
      },
      hiddenPrivateNote: {
        roomKey: 'privateHidden',
        messageId: hiddenPrivateNote._id,
        text: fixtureMessages.hiddenPrivateNote,
      },
      dmBobRead: {
        roomKey: 'dmBob',
        messageId: dmBobRead._id,
        text: fixtureMessages.dmBobRead,
      },
      dmBobUnread: {
        roomKey: 'dmBob',
        messageId: dmBobUnread._id,
        text: dynamicFixtureMessages.dmBobUnread,
      },
      dmCharlieRead: {
        roomKey: 'dmCharlie',
        messageId: dmCharlieRead._id,
        text: fixtureMessages.dmCharlieRead,
      },
    } satisfies Record<string, SeedManifestMessage>,
  };

  await writeSeedManifestAtomically(manifest, env.seedManifestPath);

  console.log('Seeded BetterChat backend fixtures');
  console.log(`Seed manifest: ${env.seedManifestPath}`);
  console.log(`Public main: ${publicMain.roomId}`);
  console.log(`Public quiet: ${publicQuiet.roomId}`);
  console.log(`Public empty: ${publicEmpty.roomId}`);
  console.log(`Public readonly: ${publicReadonly.roomId}`);
  console.log(`Private main: ${privateMain.roomId}`);
  console.log(`Private hidden: ${privateHidden.roomId}`);
  console.log(`DM bob: ${dmBob.roomId}`);
  console.log(`DM charlie: ${dmCharlie.roomId}`);
} finally {
  await releaseSeedLock();
}
