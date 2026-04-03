import { describe, expect, test } from 'bun:test';

import { AppError } from './errors';
import { SameUserStreamRefreshCoalescer } from './stream-refresh-coalescing';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SameUserStreamRefreshCoalescer', () => {
  test('coalesces concurrent refreshes for the same user and scope', async () => {
    const coalescer = new SameUserStreamRefreshCoalescer();
    let loadCount = 0;

    const [left, right] = await Promise.all([
      coalescer.run('alice-id', 'conversation:1', async () => {
        loadCount += 1;
        await delay(20);
        return 'shared-result';
      }),
      coalescer.run('alice-id', 'conversation:1', async () => {
        loadCount += 1;
        await delay(20);
        return 'unexpected-second-result';
      }),
    ]);

    expect(left).toBe('shared-result');
    expect(right).toBe('shared-result');
    expect(loadCount).toBe(1);
  });

  test('does not coalesce refreshes for different users', async () => {
    const coalescer = new SameUserStreamRefreshCoalescer();
    let loadCount = 0;

    const [left, right] = await Promise.all([
      coalescer.run('alice-id', 'conversation:1', async () => {
        loadCount += 1;
        await delay(20);
        return 'alice-result';
      }),
      coalescer.run('bob-id', 'conversation:1', async () => {
        loadCount += 1;
        await delay(20);
        return 'bob-result';
      }),
    ]);

    expect(left).toBe('alice-result');
    expect(right).toBe('bob-result');
    expect(loadCount).toBe(2);
  });

  test('retries the caller load after a shared unauthenticated failure', async () => {
    const coalescer = new SameUserStreamRefreshCoalescer();
    let invalidLoadCount = 0;
    let validLoadCount = 0;

    const invalidPromise = coalescer.run('alice-id', 'conversation:1', async () => {
      invalidLoadCount += 1;
      await delay(20);
      throw new AppError('UNAUTHENTICATED', 'invalid session', 401);
    });
    await Promise.resolve();

    const validPromise = coalescer.run('alice-id', 'conversation:1', async () => {
      validLoadCount += 1;
      await delay(20);
      return 'valid-result';
    });

    const [invalid, valid] = await Promise.allSettled([invalidPromise, validPromise]);

    expect(invalid.status).toBe('rejected');
    expect(valid).toEqual({
      status: 'fulfilled',
      value: 'valid-result',
    });
    expect(invalidLoadCount).toBe(2);
    expect(validLoadCount).toBe(1);
  });
});
