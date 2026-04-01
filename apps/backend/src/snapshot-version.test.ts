import { describe, expect, test } from 'bun:test';

import { computeSnapshotVersion } from './snapshot-version';

describe('snapshot versioning', () => {
  test('is stable for equivalent objects regardless of key order', () => {
    const left = computeSnapshotVersion({
      entries: [{ roomId: 'room-1', unreadCount: 2 }],
      version: 'ignored-at-call-site',
    });
    const right = computeSnapshotVersion({
      version: 'ignored-at-call-site',
      entries: [{ unreadCount: 2, roomId: 'room-1' }],
    });

    expect(left).toBe(right);
  });

  test('changes when snapshot content changes', () => {
    const before = computeSnapshotVersion({
      entries: [{ roomId: 'room-1', unreadCount: 1 }],
    });
    const after = computeSnapshotVersion({
      entries: [{ roomId: 'room-1', unreadCount: 2 }],
    });

    expect(before).not.toBe(after);
  });
});
