import { toAppError } from './errors';
import { InFlightRequestCache } from './snapshot-cache';

export class SameUserStreamRefreshCoalescer {
  constructor(private readonly cache = new InFlightRequestCache()) {}

  run<T>(userId: string, scope: string, load: () => Promise<T>): Promise<T> {
    return this.cache.getOrLoad(`user:${userId}:${scope}`, load).catch((error) => {
      const appError = toAppError(error);
      if (appError.status === 401) {
        return load();
      }

      throw error;
    });
  }
}

export const sameUserStreamRefreshCoalescer = new SameUserStreamRefreshCoalescer();
