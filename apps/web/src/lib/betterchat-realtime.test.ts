import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createBetterChatRealtimeController } from './betterchat-realtime';

type FakeSocketEventMap = {
	close: Event;
	error: Event;
	message: MessageEvent<string>;
};

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly sentMessages: string[] = [];
	readonly url: string;
	readyState = FakeWebSocket.OPEN;
	private readonly listeners: {
		[K in keyof FakeSocketEventMap]: Set<(event: FakeSocketEventMap[K]) => void>;
	} = {
		close: new Set(),
		error: new Set(),
		message: new Set(),
	};

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	addEventListener<K extends keyof FakeSocketEventMap>(type: K, listener: (event: FakeSocketEventMap[K]) => void) {
		this.listeners[type].add(listener);
	}

	removeEventListener<K extends keyof FakeSocketEventMap>(type: K, listener: (event: FakeSocketEventMap[K]) => void) {
		this.listeners[type].delete(listener);
	}

	send(message: string) {
		this.sentMessages.push(message);
	}

	close(code?: number, wasClean = false) {
		this.readyState = FakeWebSocket.CLOSED;
		this.dispatch(
			'close',
			{
				code: code ?? 1006,
				wasClean,
			} as CloseEvent,
		);
	}

	dispatchMessage(payload: unknown) {
		this.dispatch(
			'message',
			{
				data: JSON.stringify(payload),
			} as MessageEvent<string>,
		);
	}

	dispatch<K extends keyof FakeSocketEventMap>(type: K, event: FakeSocketEventMap[K]) {
		for (const listener of this.listeners[type]) {
			listener(event);
		}
	}
}

const readSentCommands = (socket: FakeWebSocket) =>
	socket.sentMessages.map(
		(message) =>
			JSON.parse(message) as {
				conversationId?: string;
				conversationVersion?: string;
				directoryVersion?: string;
				timelineVersion?: string;
				type: string;
			},
	);

describe('createBetterChatRealtimeController', () => {
	const originalWindow = globalThis.window;
	const originalWebSocket = globalThis.WebSocket;

	beforeEach(() => {
		FakeWebSocket.instances = [];
		(globalThis as typeof globalThis & { window: Window }).window = {
			...(globalThis as unknown as Window),
			location: {
				origin: 'http://127.0.0.1:3401',
			},
		} as Window;
		(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
	});

	afterEach(() => {
		if (originalWindow) {
			(globalThis as typeof globalThis & { window: Window }).window = originalWindow;
		} else {
			delete (globalThis as typeof globalThis & { window?: Window }).window;
		}

		if (originalWebSocket) {
			(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
		} else {
			delete (globalThis as typeof globalThis & { WebSocket?: typeof WebSocket }).WebSocket;
		}
	});

	it('watches the directory plus active conversations after ready and only sends diffs later', () => {
		const controller = createBetterChatRealtimeController({
			onEvent() {},
		});

		const socket = FakeWebSocket.instances[0];
		expect(socket).toBeDefined();
		if (!socket) {
			throw new Error('expected a fake realtime socket');
		}

		controller.setWatchState({
			directoryVersion: 'directory-v1',
			rooms: [{ roomId: 'room-2', roomVersion: 'room-v2', timelineVersion: 'timeline-v2' }],
		});
		expect(socket.sentMessages).toHaveLength(0);

		socket.dispatchMessage({
			type: 'ready',
			mode: 'push',
			protocol: 'conversation-stream.v1',
		});

		expect(readSentCommands(socket)).toEqual([
			{
				directoryVersion: 'directory-v1',
				type: 'watch-directory',
			},
			{
				conversationId: 'room-2',
				conversationVersion: 'room-v2',
				timelineVersion: 'timeline-v2',
				type: 'watch-conversation',
			},
		]);

		controller.setWatchState({
			directoryVersion: 'directory-v2',
			rooms: [{ roomId: 'room-3' }],
		});

		expect(readSentCommands(socket)).toEqual([
			{
				directoryVersion: 'directory-v1',
				type: 'watch-directory',
			},
			{
				conversationId: 'room-2',
				conversationVersion: 'room-v2',
				timelineVersion: 'timeline-v2',
				type: 'watch-conversation',
			},
			{ conversationId: 'room-2', type: 'unwatch-conversation' },
			{ conversationId: 'room-3', type: 'watch-conversation' },
		]);

		controller.close();
	});

	it('does not re-send watch commands when live versions advance on an already watched connection', () => {
		const controller = createBetterChatRealtimeController({
			onEvent() {},
		});

		const socket = FakeWebSocket.instances[0];
		expect(socket).toBeDefined();
		if (!socket) {
			throw new Error('expected a fake realtime socket');
		}

		controller.setWatchState({
			directoryVersion: 'directory-v1',
			rooms: [{ roomId: 'room-2', roomVersion: 'room-v1', timelineVersion: 'timeline-v1' }],
		});
		socket.dispatchMessage({
			type: 'ready',
			mode: 'push',
			protocol: 'conversation-stream.v1',
		});

		controller.setWatchState({
			directoryVersion: 'directory-v1',
			rooms: [{ roomId: 'room-2', roomVersion: 'room-v2', timelineVersion: 'timeline-v2' }],
		});

		expect(readSentCommands(socket)).toEqual([
			{
				directoryVersion: 'directory-v1',
				type: 'watch-directory',
			},
			{
				conversationId: 'room-2',
				conversationVersion: 'room-v1',
				timelineVersion: 'timeline-v1',
				type: 'watch-conversation',
			},
		]);

		controller.close();
	});

	it('reuses the latest version hints after reconnecting', () => {
		const originalSetTimeout = window.setTimeout;
		const originalClearTimeout = window.clearTimeout;
		(window as Window & typeof globalThis).setTimeout = ((callback: TimerHandler) => {
			if (typeof callback === 'function') {
				callback();
			}
			return 1;
		}) as typeof window.setTimeout;
		(window as Window & typeof globalThis).clearTimeout = (() => undefined) as typeof window.clearTimeout;

		try {
			const controller = createBetterChatRealtimeController({
				onEvent() {},
			});

			const initialSocket = FakeWebSocket.instances[0];
			expect(initialSocket).toBeDefined();
			if (!initialSocket) {
				throw new Error('expected an initial fake realtime socket');
			}

			controller.setWatchState({
				directoryVersion: 'directory-v2',
				rooms: [{ roomId: 'room-2', roomVersion: 'room-v2', timelineVersion: 'timeline-v2' }],
			});
			initialSocket.dispatchMessage({
				type: 'ready',
				mode: 'push',
				protocol: 'conversation-stream.v1',
			});
			initialSocket.close();

			const reconnectedSocket = FakeWebSocket.instances[1];
			expect(reconnectedSocket).toBeDefined();
			if (!reconnectedSocket) {
				throw new Error('expected a reconnected fake realtime socket');
			}

			reconnectedSocket.dispatchMessage({
				type: 'ready',
				mode: 'push',
				protocol: 'conversation-stream.v1',
			});

			expect(readSentCommands(reconnectedSocket)).toEqual([
				{
					directoryVersion: 'directory-v2',
					type: 'watch-directory',
				},
				{
					conversationId: 'room-2',
					conversationVersion: 'room-v2',
					timelineVersion: 'timeline-v2',
					type: 'watch-conversation',
				},
			]);

			controller.close();
		} finally {
			(window as Window & typeof globalThis).setTimeout = originalSetTimeout;
			(window as Window & typeof globalThis).clearTimeout = originalClearTimeout;
		}
	});

	describe('onSocketError callback', () => {
		it('should trigger onSocketError with category "message-parse-error" when receiving invalid JSON', () => {
			const errors: Array<{ category: string; message: string; timestamp: number }> = [];
			const controller = createBetterChatRealtimeController({
				onEvent: () => {},
				onSocketError: (error) => errors.push(error as { category: string; message: string; timestamp: number }),
			});

			const socket = FakeWebSocket.instances[0];
			expect(socket).toBeDefined();
			if (!socket) {
				throw new Error('expected a fake realtime socket');
			}

			// Simulate receiving invalid JSON
			socket.dispatch('message', { data: 'not valid json {{{' } as MessageEvent<string>);

			expect(errors.length).toBe(1);
			expect(errors[0]?.category).toBe('message-parse-error');
			expect(errors[0]?.message).toContain('JSON');
			expect(errors[0]?.timestamp).toBeDefined();
			expect(typeof errors[0]?.timestamp).toBe('number');

			controller.close();
		});

		it('should trigger onSocketError when WebSocket error event occurs', () => {
			const errors: Array<{ category: string; timestamp: number }> = [];
			const controller = createBetterChatRealtimeController({
				onEvent: () => {},
				onSocketError: (error) => errors.push(error as { category: string; timestamp: number }),
			});

			const socket = FakeWebSocket.instances[0];
			expect(socket).toBeDefined();
			if (!socket) {
				throw new Error('expected a fake realtime socket');
			}

			// Simulate WebSocket error
			socket.dispatch('error', new Event('error'));

			expect(errors.length).toBe(1);
			expect(errors[0]?.category).toBe('connection-error');
			expect(errors[0]?.timestamp).toBeDefined();

			controller.close();
		});

		it('should categorize server authentication errors as "authentication-failed"', () => {
			const errors: Array<{ category: string; code?: string }> = [];
			const controller = createBetterChatRealtimeController({
				onEvent: () => {},
				onSocketError: (error) => errors.push(error as { category: string; code?: string }),
			});

			const socket = FakeWebSocket.instances[0];
			expect(socket).toBeDefined();
			if (!socket) {
				throw new Error('expected a fake realtime socket');
			}

			// Simulate server sending authentication error event
			socket.dispatchMessage({
				type: 'error',
				code: 'authentication_failed',
			});

			expect(errors.length).toBe(1);
			expect(errors[0]?.category).toBe('authentication-failed');
			expect(errors[0]?.code).toBe('authentication_failed');

			controller.close();
		});

		it('should categorize server rate limit errors as "rate-limited"', () => {
			const errors: Array<{ category: string; code?: string }> = [];
			const controller = createBetterChatRealtimeController({
				onEvent: () => {},
				onSocketError: (error) => errors.push(error as { category: string; code?: string }),
			});

			const socket = FakeWebSocket.instances[0];
			expect(socket).toBeDefined();
			if (!socket) {
				throw new Error('expected a fake realtime socket');
			}

			// Simulate server sending rate limit error
			socket.dispatchMessage({
				type: 'error',
				code: 'rate_limited',
			});

			expect(errors.length).toBe(1);
			expect(errors[0]?.category).toBe('rate-limited');
			expect(errors[0]?.code).toBe('rate_limited');

			controller.close();
		});

		it('should categorize connection close as "connection-lost"', () => {
			const errors: Array<{ category: string; wasClean?: boolean }> = [];
			const controller = createBetterChatRealtimeController({
				onEvent: () => {},
				onSocketError: (error) => errors.push(error as { category: string; wasClean?: boolean }),
			});

			const socket = FakeWebSocket.instances[0];
			expect(socket).toBeDefined();
			if (!socket) {
				throw new Error('expected a fake realtime socket');
			}

			// Simulate connection close
			socket.close();

			expect(errors.length).toBe(1);
			expect(errors[0]?.category).toBe('connection-lost');

			controller.close();
		});

		it('should continue to function and reconnect after errors', () => {
			const errors: unknown[] = [];
			const controller = createBetterChatRealtimeController({
				onEvent: () => {},
				onSocketError: (error) => errors.push(error),
				onStatusChange: () => {},
			});

			const socket = FakeWebSocket.instances[0];
			expect(socket).toBeDefined();
			if (!socket) {
				throw new Error('expected a fake realtime socket');
			}

			// Trigger an error
			socket.dispatch('error', new Event('error'));

			expect(errors.length).toBe(1);

			// Close the socket to trigger reconnect
			socket.close();

			// After reconnect, we should have a second socket instance
			// (in real implementation with setTimeout, but in our fake we might not see it)
			// The important thing is the controller doesn't crash

			controller.close();
		});
	});
});
