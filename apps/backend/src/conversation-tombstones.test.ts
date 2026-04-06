import { describe, expect, test } from 'bun:test';

import { InMemoryConversationMessageLedger } from './conversation-message-ledger';
import {
  findCanonicalConversationMessage,
  mergeInitialConversationTimelineTombstones,
  toDeletedTombstoneMessage,
  toDeletedTombstoneMessageFromEnvelope,
} from './conversation-tombstones';
import type { UpstreamMessage } from './upstream';

const message = ({
  id,
  text,
  ts,
}: {
  id: string;
  text: string;
  ts: string;
}): UpstreamMessage => ({
  _id: id,
  rid: 'room-1',
  msg: text,
  ts,
  u: {
    _id: 'alice-id',
    username: 'alice',
    name: 'Alice Example',
  },
  attachments: [
    {
      title: 'image.png',
      title_link: '/file-upload/image.png',
      image_url: '/file-upload/image.png',
      image_type: 'image/png',
    },
  ],
  reactions: {
    ':rocket:': {
      usernames: ['alice'],
    },
  },
});

describe('conversation tombstones', () => {
  test('projects a deleted tombstone from a ledger envelope while preserving timeline identity', () => {
    const tombstone = toDeletedTombstoneMessageFromEnvelope({
      authoredAt: '2026-04-07T08:00:00.000Z',
      authorId: 'alice-id',
      authorName: 'Alice Example',
      authorUsername: 'alice',
      conversationId: 'room-1',
      deletedAt: '2026-04-07T08:10:00.000Z',
      messageId: 'message-1',
      observedAt: '2026-04-07T08:01:00.000Z',
      threadLastReplyAt: '2026-04-07T08:05:00.000Z',
      threadReplyCount: 2,
    });

    expect(tombstone).toEqual({
      _id: 'message-1',
      _deletedAt: '2026-04-07T08:10:00.000Z',
      _updatedAt: '2026-04-07T08:10:00.000Z',
      editedAt: '2026-04-07T08:10:00.000Z',
      msg: '',
      rid: 'room-1',
      t: 'rm',
      tcount: 2,
      tlm: '2026-04-07T08:05:00.000Z',
      ts: '2026-04-07T08:00:00.000Z',
      u: {
        _id: 'alice-id',
        name: 'Alice Example',
        username: 'alice',
      },
    });
  });

  test('merges missing tombstones from the ledger into the initial canonical conversation page in chronology order', () => {
    const ledger = new InMemoryConversationMessageLedger();
    ledger.observe(
      message({
        id: 'message-deleted',
        text: 'deleted',
        ts: '2026-04-07T08:05:00.000Z',
      }),
      '2026-04-07T08:05:30.000Z',
    );
    ledger.markDeletedById('room-1', 'message-deleted', {
      deletedAt: '2026-04-07T08:06:00.000Z',
      source: 'betterchat-delete',
    });

    const merged = mergeInitialConversationTimelineTombstones({
      conversationId: 'room-1',
      hasMoreUpstream: true,
      ledger,
      messages: [
        message({
          id: 'message-newest',
          text: 'newest',
          ts: '2026-04-07T08:10:00.000Z',
        }),
        message({
          id: 'message-oldest',
          text: 'oldest',
          ts: '2026-04-07T08:00:00.000Z',
        }),
      ],
      pageOffset: 0,
    });

    expect(merged.map((entry) => entry._id)).toEqual([
      'message-newest',
      'message-deleted',
      'message-oldest',
    ]);
    expect(merged.find((entry) => entry._id === 'message-deleted')?.t).toBe('rm');
  });

  test('does not duplicate a tombstone already present upstream', () => {
    const ledger = new InMemoryConversationMessageLedger();
    ledger.observe(
      message({
        id: 'message-1',
        text: 'deleted',
        ts: '2026-04-07T08:05:00.000Z',
      }),
      '2026-04-07T08:05:30.000Z',
    );
    ledger.markDeletedById('room-1', 'message-1', {
      deletedAt: '2026-04-07T08:06:00.000Z',
      source: 'betterchat-delete',
    });
    const tombstone = toDeletedTombstoneMessage(
      message({
        id: 'message-1',
        text: 'deleted',
        ts: '2026-04-07T08:05:00.000Z',
      }),
      '2026-04-07T08:06:00.000Z',
    );

    const merged = mergeInitialConversationTimelineTombstones({
      conversationId: 'room-1',
      hasMoreUpstream: true,
      ledger,
      messages: [tombstone],
      pageOffset: 0,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?._id).toBe('message-1');
  });

  test('falls back to a ledger-backed deleted tombstone when upstream no longer has the message', async () => {
    const ledger = new InMemoryConversationMessageLedger();
    ledger.observe(
      message({
        id: 'message-1',
        text: 'deleted later',
        ts: '2026-04-07T08:05:00.000Z',
      }),
      '2026-04-07T08:05:30.000Z',
    );
    ledger.markDeletedById('room-1', 'message-1', {
      deletedAt: '2026-04-07T08:06:00.000Z',
      source: 'upstream-realtime',
    });

    const canonical = await findCanonicalConversationMessage(
      {
        findMessage: async () => undefined,
      } as never,
      {} as never,
      'room-1',
      'message-1',
      ledger,
    );

    expect(canonical).toMatchObject({
      _id: 'message-1',
      rid: 'room-1',
      t: 'rm',
      _deletedAt: '2026-04-07T08:06:00.000Z',
    });
  });
});
