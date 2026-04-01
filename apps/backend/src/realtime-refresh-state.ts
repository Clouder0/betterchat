export class RealtimeRefreshState {
  private readonly activeRoomRefreshIdByRoomId = new Map<string, number>();
  private readonly activeThreadRefreshIdByThreadId = new Map<string, number>();
  private activeSidebarRefreshId = 0;
  private nextRefreshIdCounter = 0;

  beginSidebarRefresh(): number {
    const refreshId = this.nextRefreshId();
    this.activeSidebarRefreshId = refreshId;
    return refreshId;
  }

  isCurrentSidebarRefresh(refreshId: number, isAlive: boolean): boolean {
    return isAlive && this.activeSidebarRefreshId === refreshId;
  }

  beginRoomRefresh(roomId: string): number {
    const refreshId = this.nextRefreshId();
    this.activeRoomRefreshIdByRoomId.set(roomId, refreshId);
    return refreshId;
  }

  isCurrentRoomRefresh(roomId: string, refreshId: number, isAlive: boolean, watchedRoom: boolean): boolean {
    return isAlive
      && watchedRoom
      && this.activeRoomRefreshIdByRoomId.get(roomId) === refreshId;
  }

  clearRoom(roomId: string): void {
    this.activeRoomRefreshIdByRoomId.delete(roomId);
  }

  beginThreadRefresh(threadId: string): number {
    const refreshId = this.nextRefreshId();
    this.activeThreadRefreshIdByThreadId.set(threadId, refreshId);
    return refreshId;
  }

  isCurrentThreadRefresh(
    roomId: string,
    threadId: string,
    refreshId: number,
    isAlive: boolean,
    watchedThreadRoomId: string | undefined,
  ): boolean {
    return isAlive
      && watchedThreadRoomId === roomId
      && this.activeThreadRefreshIdByThreadId.get(threadId) === refreshId;
  }

  clearThread(threadId: string): void {
    this.activeThreadRefreshIdByThreadId.delete(threadId);
  }

  private nextRefreshId(): number {
    this.nextRefreshIdCounter += 1;
    return this.nextRefreshIdCounter;
  }
}
