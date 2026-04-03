#!/usr/bin/env bun

import { performance } from 'node:perf_hooks';

import type { ConversationStreamServerEvent } from '@betterchat/contracts';

import {
  BetterChatConversationStreamClient,
  fixtureUsers,
  getIntegrationEnv,
  readSeedManifest,
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
};

type BetterChatConversation = {
  version: string;
};

type BetterChatTimeline = {
  version: string;
};

type Summary = {
  avgMs: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  samplesMs: number[];
};

type FanoutScenario = {
  label: string;
  sampleCount: number;
  watchConversation: boolean;
  watchDirectory: boolean;
  watcherCount: number;
  watcherMode: 'distinct-sessions' | 'shared-session';
};

const parseArgs = () => {
  const labels: string[] = [];
  let sampleCountOverride: number | undefined;

  for (const rawArg of Bun.argv.slice(2)) {
    if (rawArg.startsWith('--label=')) {
      const label = rawArg.slice('--label='.length).trim();
      if (label.length > 0) {
        labels.push(label);
      }
      continue;
    }

    if (rawArg.startsWith('--sample-count=')) {
      const parsed = Number.parseInt(rawArg.slice('--sample-count='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        sampleCountOverride = parsed;
      }
    }
  }

  return {
    labels,
    sampleCountOverride,
  };
};

const env = getIntegrationEnv();
const seedManifest = readSeedManifest();
const activeRoom = seedManifest.rooms.publicEmpty;

if (!activeRoom?.roomId) {
  throw new Error('Seed manifest is missing the active room used by the fan-out recheck.');
}

const sleep = (timeoutMs: number) => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

const createUniqueText = (label: string) => `[betterchat][fanout-recheck][${label}] ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
      await stream.nextEvent((event): event is ConversationStreamServerEvent => Boolean(event), 50);
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
  const args = parseArgs();
  console.log('# BetterChat API fan-out recheck');
  console.log(`backend=${env.backendUrl}`);
  console.log(`activeRoom=${activeRoom.title} (${activeRoom.roomId})`);
  console.log('');

  const senderSession = await loginBetterChat(fixtureUsers.bob.username, fixtureUsers.bob.password);
  const referenceSession = await loginBetterChat(fixtureUsers.alice.username, fixtureUsers.alice.password);

  const [latestDirectory, latestConversation, latestTimeline] = await Promise.all([
    betterChatGetJson<BetterChatDirectory>(referenceSession, '/api/directory'),
    betterChatGetJson<BetterChatConversation>(referenceSession, `/api/conversations/${activeRoom.roomId}`),
    betterChatGetJson<BetterChatTimeline>(referenceSession, `/api/conversations/${activeRoom.roomId}/timeline`),
  ]);

  const scenarios: FanoutScenario[] = [
    {
      label: 'shared-session room+directory x4',
      sampleCount: 5,
      watchConversation: true,
      watchDirectory: true,
      watcherCount: 4,
      watcherMode: 'shared-session',
    },
    {
      label: 'distinct-sessions room+directory x4',
      sampleCount: 5,
      watchConversation: true,
      watchDirectory: true,
      watcherCount: 4,
      watcherMode: 'distinct-sessions',
    },
    {
      label: 'shared-session room-only x4',
      sampleCount: 5,
      watchConversation: true,
      watchDirectory: false,
      watcherCount: 4,
      watcherMode: 'shared-session',
    },
    {
      label: 'distinct-sessions room-only x4',
      sampleCount: 5,
      watchConversation: true,
      watchDirectory: false,
      watcherCount: 4,
      watcherMode: 'distinct-sessions',
    },
    {
      label: 'shared-session directory-only x4',
      sampleCount: 5,
      watchConversation: false,
      watchDirectory: true,
      watcherCount: 4,
      watcherMode: 'shared-session',
    },
    {
      label: 'distinct-sessions directory-only x4',
      sampleCount: 5,
      watchConversation: false,
      watchDirectory: true,
      watcherCount: 4,
      watcherMode: 'distinct-sessions',
    },
  ].filter((scenario) => args.labels.length === 0 || args.labels.includes(scenario.label)).map((scenario) => ({
    ...scenario,
    ...(args.sampleCountOverride ? { sampleCount: args.sampleCountOverride } : {}),
  }));

  if (scenarios.length === 0) {
    throw new Error(`No fan-out scenarios matched the requested labels: ${args.labels.join(', ')}`);
  }

  const distinctWatcherSessions = await Promise.all(
    Array.from({ length: 4 }, () => loginBetterChat(fixtureUsers.alice.username, fixtureUsers.alice.password)),
  );

  const results: Record<string, unknown> = {};

  for (const scenario of scenarios) {
    const watcherSessions = scenario.watcherMode === 'shared-session'
      ? Array.from({ length: scenario.watcherCount }, () => referenceSession)
      : distinctWatcherSessions.slice(0, scenario.watcherCount);
    const streams: BetterChatConversationStreamClient[] = [];

    console.log(`## ${scenario.label}`);

    for (const watcherSession of watcherSessions) {
      const stream = new BetterChatConversationStreamClient(env.backendUrl);
      await stream.connect(watcherSession.cookieHeader);
      await stream.nextEvent(isReadyEvent);
      if (scenario.watchDirectory) {
        stream.send({
          type: 'watch-directory',
          directoryVersion: latestDirectory.version,
        });
      }
      if (scenario.watchConversation) {
        stream.send({
          type: 'watch-conversation',
          conversationId: activeRoom.roomId,
          conversationVersion: latestConversation.version,
          timelineVersion: latestTimeline.version,
        });
      }
      await drainQueuedStreamEvents(stream);
      streams.push(stream);
    }

    const senderAckSamples: number[] = [];
    const slowestEventSamples: number[] = [];

    for (let iteration = 0; iteration < scenario.sampleCount; iteration += 1) {
      const text = createUniqueText(`${scenario.label}-${iteration}`);
      const startedAt = performance.now();
      const eventPromise = Promise.all(
        streams.map((stream) =>
          stream.nextEvent(
            scenario.watchConversation
              ? isTimelineResyncedForText(text)
              : isDirectoryUpdateForConversation(activeRoom.roomId),
            20_000,
          ).then(() => performance.now() - startedAt)
        ),
      );

      await betterChatPostJson(
        senderSession,
        `/api/conversations/${activeRoom.roomId}/messages`,
        conversationMessageBody(text),
      );

      const senderAckMs = performance.now() - startedAt;
      const eventTimingsMs = await eventPromise;
      const slowestEventMs = Math.max(...eventTimingsMs);

      console.log(
        `${scenario.label} [${iteration + 1}/${scenario.sampleCount}]: senderAck=${senderAckMs.toFixed(1)}ms slowestEvent=${slowestEventMs.toFixed(1)}ms`,
      );

      senderAckSamples.push(senderAckMs);
      slowestEventSamples.push(slowestEventMs);

      await sleep(100);
    }

    for (const stream of streams) {
      stream.close();
    }

    results[scenario.label] = {
      senderAck: summarize(senderAckSamples),
      slowestEvent: summarize(slowestEventSamples),
      watchConversation: scenario.watchConversation,
      watchDirectory: scenario.watchDirectory,
      watcherCount: scenario.watcherCount,
      watcherMode: scenario.watcherMode,
    };

    console.log('');
    await sleep(250);
  }

  console.log('## Summary JSON');
  console.log(JSON.stringify(results, null, 2));
};

await main();
