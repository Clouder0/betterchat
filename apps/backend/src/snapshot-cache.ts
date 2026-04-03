export class InFlightRequestCache {
  private readonly pendingByKey = new Map<string, Promise<unknown>>();

  getOrLoadEntry<T>(key: string, loader: () => Promise<T>): {
    created: boolean;
    promise: Promise<T>;
  } {
    const existing = this.pendingByKey.get(key);
    if (existing) {
      return {
        created: false,
        promise: existing as Promise<T>,
      };
    }

    const promise = loader().finally(() => {
      if (this.pendingByKey.get(key) === promise) {
        this.pendingByKey.delete(key);
      }
    });

    this.pendingByKey.set(key, promise);
    return {
      created: true,
      promise,
    };
  }

  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    return this.getOrLoadEntry(key, loader).promise;
  }

  deleteWhere(predicate: (key: string) => boolean): void {
    for (const key of this.pendingByKey.keys()) {
      if (predicate(key)) {
        this.pendingByKey.delete(key);
      }
    }
  }
}
