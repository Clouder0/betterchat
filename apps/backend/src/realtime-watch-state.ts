export class RealtimeWatchState {
  private readonly sidebarDmPeerUserIds = new Set<string>();
  private readonly watchedRoomIds = new Set<string>();
  private readonly watchedDmPeerUserIdByRoomId = new Map<string, string>();
  private readonly watchedThreadIdsByRoomId = new Map<string, Set<string>>();
  private readonly watchedThreadRoomIds = new Map<string, string>();

  watchRoom(roomId: string): void {
    this.watchedRoomIds.add(roomId);
  }

  unwatchRoom(roomId: string): void {
    this.watchedRoomIds.delete(roomId);
    this.watchedDmPeerUserIdByRoomId.delete(roomId);
  }

  dropRoom(roomId: string): string[] {
    this.watchedRoomIds.delete(roomId);
    this.watchedDmPeerUserIdByRoomId.delete(roomId);

    const threadIds = [...(this.watchedThreadIdsByRoomId.get(roomId) || [])];
    this.watchedThreadIdsByRoomId.delete(roomId);
    for (const threadId of threadIds) {
      this.watchedThreadRoomIds.delete(threadId);
    }

    return threadIds;
  }

  hasRoom(roomId: string): boolean {
    return this.watchedRoomIds.has(roomId);
  }

  watchedConversationIds(): string[] {
    return [...new Set([...this.watchedRoomIds, ...this.watchedThreadIdsByRoomId.keys()])];
  }

  watchThread(roomId: string, threadId: string): void {
    let threadIds = this.watchedThreadIdsByRoomId.get(roomId);
    if (!threadIds) {
      threadIds = new Set<string>();
      this.watchedThreadIdsByRoomId.set(roomId, threadIds);
    }

    threadIds.add(threadId);
    this.watchedThreadRoomIds.set(threadId, roomId);
  }

  unwatchThread(roomId: string, threadId: string): void {
    const threadIds = this.watchedThreadIdsByRoomId.get(roomId);
    threadIds?.delete(threadId);
    if (threadIds && threadIds.size === 0) {
      this.watchedThreadIdsByRoomId.delete(roomId);
    }

    this.watchedThreadRoomIds.delete(threadId);
  }

  threadIdsForRoom(roomId: string): string[] {
    return [...(this.watchedThreadIdsByRoomId.get(roomId) || [])];
  }

  threadRoomId(threadId: string): string | undefined {
    return this.watchedThreadRoomIds.get(threadId);
  }

  roomWatchRequired(roomId: string): boolean {
    return this.watchedRoomIds.has(roomId) || (this.watchedThreadIdsByRoomId.get(roomId)?.size || 0) > 0;
  }

  setSidebarPresenceTargets(dmPeerUserIdByRoomId: ReadonlyMap<string, string>): string[] {
    this.sidebarDmPeerUserIds.clear();
    for (const userId of dmPeerUserIdByRoomId.values()) {
      this.sidebarDmPeerUserIds.add(userId);
    }

    return this.presenceUserIds();
  }

  hasSidebarPresenceUser(userId: string): boolean {
    return this.sidebarDmPeerUserIds.has(userId);
  }

  setWatchedRoomPresence(roomId: string, dmPeerUserId: string | undefined): string[] {
    if (dmPeerUserId) {
      this.watchedDmPeerUserIdByRoomId.set(roomId, dmPeerUserId);
      return this.presenceUserIds();
    }

    this.watchedDmPeerUserIdByRoomId.delete(roomId);
    return this.presenceUserIds();
  }

  watchedRoomsForPresenceUser(userId: string): string[] {
    return [...this.watchedDmPeerUserIdByRoomId.entries()]
      .filter(([, watchedUserId]) => watchedUserId === userId)
      .map(([roomId]) => roomId);
  }

  presenceUserIds(): string[] {
    const combined = new Set<string>();

    for (const userId of this.sidebarDmPeerUserIds) {
      combined.add(userId);
    }

    for (const userId of this.watchedDmPeerUserIdByRoomId.values()) {
      combined.add(userId);
    }

    return [...combined];
  }
}
