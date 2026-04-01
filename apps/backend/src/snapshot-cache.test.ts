import { describe, expect, test } from 'bun:test';

import { InFlightRequestCache } from './snapshot-cache';

describe('InFlightRequestCache', () => {
  test('coalesces concurrent loads for the same key', async () => {
    const cache = new InFlightRequestCache();
    let loadCount = 0;

    const loader = async (): Promise<string> => {
      loadCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'loaded';
    };

    const [left, right] = await Promise.all([
      cache.getOrLoad('same-key', loader),
      cache.getOrLoad('same-key', loader),
    ]);

    expect(left).toBe('loaded');
    expect(right).toBe('loaded');
    expect(loadCount).toBe(1);
  });

  test('does not reuse completed loads for later requests', async () => {
    const cache = new InFlightRequestCache();
    let loadCount = 0;

    const loader = async (): Promise<number> => {
      loadCount += 1;
      return loadCount;
    };

    expect(await cache.getOrLoad('same-key', loader)).toBe(1);
    expect(await cache.getOrLoad('same-key', loader)).toBe(2);
    expect(loadCount).toBe(2);
  });
});
