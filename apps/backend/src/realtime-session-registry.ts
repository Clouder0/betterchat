class RealtimeSessionRegistry {
  private readonly listenersBySessionKey = new Map<string, Set<() => void>>();

  onInvalidate(sessionKey: string, listener: () => void): () => void {
    const listeners = this.listenersBySessionKey.get(sessionKey) || new Set<() => void>();
    listeners.add(listener);
    this.listenersBySessionKey.set(sessionKey, listeners);

    return () => {
      const currentListeners = this.listenersBySessionKey.get(sessionKey);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        this.listenersBySessionKey.delete(sessionKey);
      }
    };
  }

  invalidate(sessionKey: string): void {
    const listeners = [...(this.listenersBySessionKey.get(sessionKey) || [])];

    for (const listener of listeners) {
      listener();
    }
  }
}

export const realtimeSessionRegistry = new RealtimeSessionRegistry();
