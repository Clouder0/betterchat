#!/usr/bin/env bun

import { performance } from 'node:perf_hooks';

import type { ConversationStreamServerEvent } from '@betterchat/contracts';

import {
  BetterChatConversationStreamClient,
  fixtureUsers,
  getIntegrationEnv,
  readSeedManifest,
  RocketChatRestClient,
} from '../packages/test-utils/src';

type BetterChatSession = {
  cookieHeader: string;
};

type ApiEnvelope<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type BetterChatDirectory = {
  version: string;
  entries: Array<{
    conversation: {
      id: string;
    };
  }>;
};

type BetterChatConversation = {
  version: string;
  conversation: {
    id: string;
  };
};

type BetterChatTimeline = {
  version: string;
  messages: Array<{
    id: string;
    body: {
      rawMarkdown: string;
    };
  }>;
};

type RocketChatSendMessageResponse = {
  message: {
    _id: string;
    msg?: string;
  };
};

type TimedSample<TResult> = {
  durationMs: number;
  result: TResult;
};

type Summary = {
  avgMs: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  samplesMs: number[];
};

const env = getIntegrationEnv();
const seedManifest = readSeedManifest();

const activeRoom = seedManifest.rooms.publicEmpty;
const inactiveRoom = seedManifest.rooms.publicQuiet;

if (!activeRoom?.roomId || !inactiveRoom?.roomId) {
  throw new Error('Seed manifest is missing required rooms for performance investigation.');
}

const createUniqueText = (label: string) => `[betterchat][perf][${label}] ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
};

const summarize = (samplesMs: number[]): Summary => ({
  avgMs: Number((samplesMs.reduce((total, value) => total + value, 0) / Math.max(samplesMs.length, 1)).toFixed(1)),
  maxMs: Number(Math.max(...samplesMs).toFixed(1)),
  minMs: Number(Math.min(...samplesMs).toFixed(1)),
  p50Ms: Number(percentile(samplesMs, 0.5).toFixed(1)),
  p95Ms: Number(percentile(samplesMs, 0.95).toFixed(1)),
  samplesMs: samplesMs.map((value) => Number(value.toFixed(1))),
});

const sleep = (timeoutMs: number) => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

const unwrapApiEnvelope = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Unexpected BetterChat response: ${response.status}` : payload.error.message);
  }

  return payload.data;
};

const loginBetterChat = async (login: string, password: string): Promise<BetterChatSession> => {
  const response = await fetch(new URL('/api/session/login', env.backendUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login,
      password,
    }),
  });

  await unwrapApiEnvelope(response);

  const setCookie = response.headers.get('set-cookie');
  const cookieHeader = setCookie?.match(/^[^;]+/)?.[0];
  if (!cookieHeader) {
    throw new Error(`BetterChat login for ${login} returned no session cookie.`);
  }

  return { cookieHeader };
};

const betterChatGetJson = async <T>(session: BetterChatSession, path: string): Promise<T> => {
  const response = await fetch(new URL(path, env.backendUrl), {
    headers: {
      cookie: session.cookieHeader,
    },
  });

  return unwrapApiEnvelope<T>(response);
};

const betterChatPostJson = async <T>(session: BetterChatSession, path: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(new URL(path, env.backendUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: session.cookieHeader,
    },
    body: JSON.stringify(body),
  });

  return unwrapApiEnvelope<T>(response);
};

const timeOnce = async <T>(label: string, task: () => Promise<T>): Promise<TimedSample<T>> => {
  const startedAt = performance.now();
  const result = await task();
  const durationMs = performance.now() - startedAt;
  console.log(`${label}: ${durationMs.toFixed(1)}ms`);
  return {
    durationMs,
    result,
  };
};

const benchmark = async <T>(label: string, iterations: number, task: (iteration: number) => Promise<T>): Promise<{
  firstMs: number;
  summary: Summary;
}> => {
  const samples: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const { durationMs } = await timeOnce(`${label} [${iteration + 1}/${iterations}]`, () => task(iteration));
    samples.push(durationMs);
    await sleep(75);
  }

  return {
    firstMs: Number((samples[0] ?? 0).toFixed(1)),
    summary: summarize(samples),
  };
};

const isReadyEvent = (
  event: ConversationStreamServerEvent,
): event is Extract<ConversationStreamServerEvent, { type: 'ready' }> => event.type === 'ready';

const isTimelineResyncedForText = (text: string) => (
  event: ConversationStreamServerEvent,
): event is Extract<ConversationStreamServerEvent, { type: 'timeline.resynced' }> =>
  event.type === 'timeline.resynced'
  && event.snapshot.messages.some((message) => message.content.text === text);

const isDirectoryUpdateForConversation = (conversationId: string) => (
  event: ConversationStreamServerEvent,
):
  event is
    | Extract<ConversationStreamServerEvent, { type: 'directory.entry.upsert' }>
    | Extract<ConversationStreamServerEvent, { type: 'directory.resynced' }> =>
  (event.type === 'directory.entry.upsert' && event.entry.conversation.id === conversationId)
  || (
    event.type === 'directory.resynced'
    && event.snapshot.entries.some((entry) => entry.conversation.id === conversationId)
  );

const drainQueuedStreamEvents = async (stream: BetterChatConversationStreamClient): Promise<void> => {
  for (;;) {
    try {
      await stream.nextEvent((event): event is ConversationStreamServerEvent => Boolean(event), 100);
    } catch {
      return;
    }
  }
};

const conversationMessageBody = (text: string) => ({
  target: {
    kind: 'conversation' as const,
  },
  content: {
    format: 'markdown' as const,
    text,
  },
});

const main = async () => {
  console.log(`# BetterChat API-mode performance investigation`);
  console.log(`backend=${env.backendUrl}`);
  console.log(`upstream=${env.upstreamUrl}`);
  console.log(`activeRoom=${activeRoom.title} (${activeRoom.roomId})`);
  console.log(`inactiveRoom=${inactiveRoom.title} (${inactiveRoom.roomId})`);
  console.log('');

  const [aliceBetterChat, bobBetterChat] = await Promise.all([
    loginBetterChat(fixtureUsers.alice.username, fixtureUsers.alice.password),
    loginBetterChat(fixtureUsers.bob.username, fixtureUsers.bob.password),
  ]);

  const aliceRocketChat = new RocketChatRestClient(env.upstreamUrl);
  const bobRocketChat = new RocketChatRestClient(env.upstreamUrl);
  await Promise.all([
    aliceRocketChat.login(fixtureUsers.alice.username, fixtureUsers.alice.password),
    bobRocketChat.login(fixtureUsers.bob.username, fixtureUsers.bob.password),
  ]);

  console.log('## HTTP benchmarks');

  const directoryBench = await benchmark('GET /api/directory', 7, async () =>
    betterChatGetJson<BetterChatDirectory>(aliceBetterChat, '/api/directory'));

  const conversationBench = await benchmark('GET /api/conversations/:id', 7, async () =>
    betterChatGetJson<BetterChatConversation>(aliceBetterChat, `/api/conversations/${activeRoom.roomId}`));

  const timelineBench = await benchmark('GET /api/conversations/:id/timeline', 7, async () =>
    betterChatGetJson<BetterChatTimeline>(aliceBetterChat, `/api/conversations/${activeRoom.roomId}/timeline`));

  const upstreamTimelineBench = await benchmark('GET Rocket.Chat room messages', 7, async () =>
    aliceRocketChat.getJson(`/api/v1/channels.messages?${new URLSearchParams({
      roomId: activeRoom.roomId,
      count: '50',
      offset: '0',
      sort: JSON.stringify({ ts: -1 }),
    }).toString()}`));

  const betterChatSendBench = await benchmark('POST /api/conversations/:id/messages', 7, async (iteration) =>
    betterChatPostJson(
      aliceBetterChat,
      `/api/conversations/${activeRoom.roomId}/messages`,
      conversationMessageBody(createUniqueText(`betterchat-send-${iteration}`)),
    ));

  const upstreamSendBench = await benchmark('POST Rocket.Chat chat.sendMessage', 7, async (iteration) =>
    bobRocketChat.postJson<RocketChatSendMessageResponse>('/api/v1/chat.sendMessage', {
      message: {
        rid: activeRoom.roomId,
        msg: createUniqueText(`upstream-send-${iteration}`),
      },
    }));

  console.log('');
  console.log('## Realtime stream benchmarks');

  const latestDirectory = await betterChatGetJson<BetterChatDirectory>(aliceBetterChat, '/api/directory');
  const latestConversation = await betterChatGetJson<BetterChatConversation>(
    aliceBetterChat,
    `/api/conversations/${activeRoom.roomId}`,
  );
  const latestTimeline = await betterChatGetJson<BetterChatTimeline>(
    aliceBetterChat,
    `/api/conversations/${activeRoom.roomId}/timeline`,
  );

  const stream = new BetterChatConversationStreamClient(env.backendUrl);
  await stream.connect(aliceBetterChat.cookieHeader);
  await stream.nextEvent(isReadyEvent);
  stream.send({
    type: 'watch-directory',
    directoryVersion: latestDirectory.version,
  });
  stream.send({
    type: 'watch-conversation',
    conversationId: activeRoom.roomId,
    conversationVersion: latestConversation.version,
    timelineVersion: latestTimeline.version,
  });
  await drainQueuedStreamEvents(stream);

  const streamBetterChatActiveSamples: Array<{ eventMs: number; senderAckMs: number }> = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const text = createUniqueText(`stream-active-betterchat-${iteration}`);
    const eventMatcher = isTimelineResyncedForText(text);
    const startedAt = performance.now();
    let senderAckMs = Number.NaN;
    let eventMs = Number.NaN;

    const eventPromise = stream.nextEvent(eventMatcher, 20_000).then((event) => {
      eventMs = performance.now() - startedAt;
      return event;
    });
    const sendPromise = betterChatPostJson(
      bobBetterChat,
      `/api/conversations/${activeRoom.roomId}/messages`,
      conversationMessageBody(text),
    ).then((result) => {
      senderAckMs = performance.now() - startedAt;
      return result;
    });

    await Promise.all([eventPromise, sendPromise]);
    console.log(
      `stream active receive via BetterChat sender [${iteration + 1}/5]: senderAck=${senderAckMs.toFixed(1)}ms event=${eventMs.toFixed(1)}ms`,
    );
    streamBetterChatActiveSamples.push({
      eventMs,
      senderAckMs,
    });
    await sleep(100);
  }

  const streamUpstreamActiveSamples: Array<{ eventMs: number; senderAckMs: number }> = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const text = createUniqueText(`stream-active-upstream-${iteration}`);
    const eventMatcher = isTimelineResyncedForText(text);
    const startedAt = performance.now();
    let senderAckMs = Number.NaN;
    let eventMs = Number.NaN;

    const eventPromise = stream.nextEvent(eventMatcher, 20_000).then((event) => {
      eventMs = performance.now() - startedAt;
      return event;
    });
    const sendPromise = bobRocketChat.postJson<RocketChatSendMessageResponse>('/api/v1/chat.sendMessage', {
      message: {
        rid: activeRoom.roomId,
        msg: text,
      },
    }).then((result) => {
      senderAckMs = performance.now() - startedAt;
      return result;
    });

    await Promise.all([eventPromise, sendPromise]);
    console.log(
      `stream active receive via Rocket.Chat sender [${iteration + 1}/5]: senderAck=${senderAckMs.toFixed(1)}ms event=${eventMs.toFixed(1)}ms`,
    );
    streamUpstreamActiveSamples.push({
      eventMs,
      senderAckMs,
    });
    await sleep(100);
  }

  const streamBetterChatInactiveSamples: Array<{ eventMs: number; senderAckMs: number; eventType: string }> = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const text = createUniqueText(`stream-inactive-betterchat-${iteration}`);
    const eventMatcher = isDirectoryUpdateForConversation(inactiveRoom.roomId);
    const startedAt = performance.now();
    let senderAckMs = Number.NaN;
    let eventMs = Number.NaN;
    let eventType = 'unknown';

    const eventPromise = stream.nextEvent(eventMatcher, 20_000).then((event) => {
      eventMs = performance.now() - startedAt;
      eventType = event.type;
      return event;
    });
    const sendPromise = betterChatPostJson(
      bobBetterChat,
      `/api/conversations/${inactiveRoom.roomId}/messages`,
      conversationMessageBody(text),
    ).then((result) => {
      senderAckMs = performance.now() - startedAt;
      return result;
    });

    await Promise.all([eventPromise, sendPromise]);
    console.log(
      `stream inactive sidebar receive via BetterChat sender [${iteration + 1}/5]: senderAck=${senderAckMs.toFixed(1)}ms event=${eventMs.toFixed(1)}ms type=${eventType}`,
    );
    streamBetterChatInactiveSamples.push({
      eventMs,
      senderAckMs,
      eventType,
    });
    await sleep(100);
  }

  stream.close();

  const results = {
    metadata: {
      activeRoomId: activeRoom.roomId,
      inactiveRoomId: inactiveRoom.roomId,
      investigatedAt: new Date().toISOString(),
    },
    http: {
      betterChatConversation: conversationBench,
      betterChatDirectory: directoryBench,
      betterChatSend: betterChatSendBench,
      betterChatTimeline: timelineBench,
      upstreamSend: upstreamSendBench,
      upstreamTimeline: upstreamTimelineBench,
    },
    realtime: {
      activeViaBetterChatSender: {
        event: summarize(streamBetterChatActiveSamples.map((sample) => sample.eventMs)),
        senderAck: summarize(streamBetterChatActiveSamples.map((sample) => sample.senderAckMs)),
      },
      activeViaRocketChatSender: {
        event: summarize(streamUpstreamActiveSamples.map((sample) => sample.eventMs)),
        senderAck: summarize(streamUpstreamActiveSamples.map((sample) => sample.senderAckMs)),
      },
      inactiveViaBetterChatSender: {
        event: summarize(streamBetterChatInactiveSamples.map((sample) => sample.eventMs)),
        eventTypes: streamBetterChatInactiveSamples.map((sample) => sample.eventType),
        senderAck: summarize(streamBetterChatInactiveSamples.map((sample) => sample.senderAckMs)),
      },
    },
  };

  console.log('');
  console.log('## Summary JSON');
  console.log(JSON.stringify(results, null, 2));
};

await main();
