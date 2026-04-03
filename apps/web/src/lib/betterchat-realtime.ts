import type { ConversationStreamClientCommand, ConversationStreamServerEvent } from '@betterchat/contracts';

import { resolveBetterChatRealtimeUrl } from './betterchat';

export type WatchedRoomState = {
	roomId: string;
	roomVersion?: string;
	timelineVersion?: string;
};

export type BetterChatRealtimeStatus =
	| {
			kind: 'connecting' | 'disconnected' | 'stopped';
	  }
	| {
			kind: 'ready';
			pollIntervalMs: number;
	  };

export type SocketErrorCategory =
	| 'connection-failed'
	| 'connection-lost'
	| 'connection-error'
	| 'message-parse-error'
	| 'protocol-error'
	| 'rate-limited'
	| 'authentication-failed'
	| 'server-error';

export type SocketError = {
	category: SocketErrorCategory;
	message: string;
	timestamp: number;
	code?: string;
	wasClean?: boolean;
	originalError?: unknown;
};

type BetterChatRealtimeController = {
	close: () => void;
	setWatchState: (watchState: {
		directoryVersion?: string;
		rooms: WatchedRoomState[];
	}) => void;
};

type BetterChatRealtimeOptions = {
	onEvent: (event: ConversationStreamServerEvent) => void;
	onSocketError?: (error: SocketError) => void;
	onStatusChange?: (status: BetterChatRealtimeStatus) => void;
};

const RECONNECT_DELAYS_MS = [600, 1_200, 2_400, 4_000] as const;

const createSocketError = (
	category: SocketErrorCategory,
	message: string,
	options?: { code?: string; wasClean?: boolean; originalError?: unknown },
): SocketError => ({
	category,
	message,
	timestamp: Date.now(),
	...options,
});

const parseRealtimeEvent = (rawMessage: string): { event: ConversationStreamServerEvent | null; parseError?: SocketError } => {
	try {
		const parsed = JSON.parse(rawMessage) as ConversationStreamServerEvent;
		// Check if it's a server error event
		if (parsed.type === 'error') {
			const errorEvent = parsed as unknown as { code?: string; message?: string };
			let category: SocketErrorCategory = 'server-error';
			if (errorEvent.code === 'authentication_failed') {
				category = 'authentication-failed';
			} else if (errorEvent.code === 'rate_limited') {
				category = 'rate-limited';
			}
			return {
				event: null,
				parseError: createSocketError(category, errorEvent.message || `Server error: ${errorEvent.code || 'unknown'}`, {
					code: errorEvent.code,
				}),
			};
		}
		return { event: parsed };
	} catch {
		return {
			event: null,
			parseError: createSocketError('message-parse-error', 'BetterChat realtime event was not valid JSON.'),
		};
	}
};

const sendCommand = (socket: WebSocket | null, command: ConversationStreamClientCommand) => {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		return;
	}

	socket.send(JSON.stringify(command));
};

export const createBetterChatRealtimeController = ({
	onEvent,
	onSocketError,
	onStatusChange,
}: BetterChatRealtimeOptions): BetterChatRealtimeController => {
	let desiredRooms = new Map<string, WatchedRoomState>();
	let desiredDirectoryVersion: string | undefined;
	let reconnectTimer: number | null = null;
	let reconnectAttempt = 0;
	let socket: WebSocket | null = null;
	let stopped = false;
	let ready = false;
	let watchingDirectory = false;
	let watchedDirectoryVersion: string | undefined;
	let status: BetterChatRealtimeStatus = { kind: 'connecting' };
	let watchedRoomVersions = new Map<string, string>();

	const serializeRoomVersionHint = (room: WatchedRoomState) => `${room.roomVersion ?? ''}:${room.timelineVersion ?? ''}`;

	const setStatus = (nextStatus: BetterChatRealtimeStatus) => {
		const statusesMatch =
			status.kind === nextStatus.kind &&
			(status.kind !== 'ready' || (nextStatus.kind === 'ready' && status.pollIntervalMs === nextStatus.pollIntervalMs));
		if (statusesMatch) {
			return;
		}

		status = nextStatus;
		onStatusChange?.(nextStatus);
	};

	const clearReconnectTimer = () => {
		if (reconnectTimer !== null) {
			window.clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	};

	const flushWatchState = () => {
		if (!ready || !socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		if (!watchingDirectory) {
			sendCommand(socket, {
				type: 'watch-directory',
				...(desiredDirectoryVersion ? { directoryVersion: desiredDirectoryVersion } : {}),
			});
			watchingDirectory = true;
			watchedDirectoryVersion = desiredDirectoryVersion;
		}

		for (const watchedRoomId of watchedRoomVersions.keys()) {
			if (desiredRooms.has(watchedRoomId)) {
				continue;
			}

			sendCommand(socket, {
				type: 'unwatch-conversation',
				conversationId: watchedRoomId,
			});
			watchedRoomVersions.delete(watchedRoomId);
		}

		for (const [roomId, room] of desiredRooms) {
			const roomVersionHint = serializeRoomVersionHint(room);
			if (watchedRoomVersions.has(roomId)) {
				continue;
			}

			sendCommand(socket, {
				type: 'watch-conversation',
				conversationId: roomId,
				...(room.roomVersion ? { conversationVersion: room.roomVersion } : {}),
				...(room.timelineVersion ? { timelineVersion: room.timelineVersion } : {}),
			});
			watchedRoomVersions.set(roomId, roomVersionHint);
		}
	};

	const scheduleReconnect = () => {
		if (stopped || reconnectTimer !== null) {
			return;
		}

		const nextDelay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 4_000;
		reconnectTimer = window.setTimeout(() => {
			reconnectTimer = null;
			reconnectAttempt += 1;
			connect();
		}, nextDelay);
	};

	const handleRealtimeEvent = (event: ConversationStreamServerEvent) => {
		onEvent(event);
		if (event.type === 'ready') {
			reconnectAttempt = 0;
			ready = true;
			setStatus({
				kind: 'ready',
				pollIntervalMs: 0,
			});
			flushWatchState();
			return;
		}

		if (event.type === 'session.invalidated') {
			stopped = true;
			clearReconnectTimer();
			setStatus({ kind: 'stopped' });
			socket?.close();
		}
	};

	const connect = () => {
		if (stopped) {
			return;
		}

		clearReconnectTimer();
		ready = false;
		setStatus({ kind: 'connecting' });
		const nextSocket = new WebSocket(resolveBetterChatRealtimeUrl());
		socket = nextSocket;

		nextSocket.addEventListener('message', (event) => {
			if (typeof event.data !== 'string') {
				return;
			}

			const { event: parsedEvent, parseError } = parseRealtimeEvent(event.data);
			if (parseError) {
				onSocketError?.(parseError);
				return;
			}

			if (parsedEvent) {
				handleRealtimeEvent(parsedEvent);
			}
		});

		nextSocket.addEventListener('close', (event) => {
			if (socket === nextSocket) {
				socket = null;
			}
			ready = false;
			watchingDirectory = false;
			watchedDirectoryVersion = undefined;
			watchedRoomVersions.clear();

			if (!stopped) {
				// Report unexpected disconnections as errors
				if (!event.wasClean) {
					onSocketError?.(
						createSocketError('connection-lost', `Connection closed unexpectedly (code: ${event.code})`, {
							wasClean: event.wasClean,
						}),
					);
				}
				setStatus({ kind: 'disconnected' });
				scheduleReconnect();
			}
		});

		nextSocket.addEventListener('error', () => {
			onSocketError?.(createSocketError('connection-error', 'WebSocket connection error occurred'));
		});
	};

	connect();

	return {
		close() {
			stopped = true;
			ready = false;
			watchingDirectory = false;
			watchedDirectoryVersion = undefined;
			watchedRoomVersions.clear();
			clearReconnectTimer();
			socket?.close();
			socket = null;
			setStatus({ kind: 'stopped' });
		},
		setWatchState(watchState) {
			desiredDirectoryVersion = watchState.directoryVersion;
			desiredRooms = new Map(watchState.rooms.map((room) => [room.roomId, room]));
			flushWatchState();
		},
	};
};
