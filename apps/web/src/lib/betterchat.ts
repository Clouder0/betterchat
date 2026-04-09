import type {
	ApiErrorCode,
	ApiResult,
	ConversationMentionCandidatesResponse,
	ConversationMessageContextSnapshot,
	ConversationParticipantsPage,
	ConversationSnapshot,
	ConversationTimelineSnapshot,
	CreateConversationMessageResponse,
	DeleteMessageResponse as ContractDeleteMessageResponse,
	DirectorySnapshot,
	DirectConversationLookup,
	EnsureDirectConversationResponse,
	LoginRequest,
	LoginResponse,
	MembershipCommandResponse,
	PublicBootstrap,
	UpdateMessageResponse as ContractUpdateMessageResponse,
	WorkspaceBootstrap,
} from '@betterchat/contracts';

import {
	toCreateConversationMessageRequest,
	toDeleteMessageResponse,
	toDirectConversationLookupResult,
	toEditMessageResponse,
	toEnsureDirectConversationResult,
	toFavoriteMutationResponse,
	toMessageContextSnapshot,
	toReadStateMutationResponse,
	toRoomListSnapshot,
	toRoomSnapshot,
	toRoomTimelineSnapshot,
	toSendMessageResponse,
	toVisibilityMutationResponse,
} from './chatAdapters';
import type {
	DeleteMessageResponse,
	DirectConversationLookupResult,
	EditMessageRequest,
	EditMessageResponse,
	EnsureDirectConversationResult,
	MessageContextSnapshot,
	RoomFavoriteMutationResponse,
	RoomListSnapshot,
	RoomSnapshot,
	RoomTimelineSnapshot,
	RoomReadStateMutationResponse,
	RoomVisibilityMutationResponse,
	SendMessageRequest,
	SendMessageResponse,
	SetRoomFavoriteRequest,
	SetRoomReadStateRequest,
	SetRoomVisibilityRequest,
} from './chatModels';
import { fixtureBetterChatService } from './betterchat-fixtures';
import { fetchWithTimeout, TimeoutError, TIMEOUTS } from './fetchWithTimeout';

const DEFAULT_API_MODE = 'fixture';
const NETWORK_DELAY_MS = 120;

const apiMode = (import.meta.env.VITE_BETTERCHAT_API_MODE ?? DEFAULT_API_MODE).toLowerCase();
const apiBaseUrl = import.meta.env.VITE_BETTERCHAT_API_BASE_URL ?? '';

export class BetterChatApiError extends Error {
	readonly code: ApiErrorCode;
	readonly details?: unknown;

	constructor(code: ApiErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = 'BetterChatApiError';
		this.code = code;
		this.details = details;
	}
}

const sleep = (timeoutMs = NETWORK_DELAY_MS) => new Promise((resolve) => globalThis.setTimeout(resolve, timeoutMs));

const toApiError = (error: unknown) => {
	if (error instanceof BetterChatApiError) {
		return error;
	}

	if (error instanceof TimeoutError) {
		return new BetterChatApiError('UPSTREAM_UNAVAILABLE', error.message);
	}

	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return new BetterChatApiError(error.code as ApiErrorCode, error.message, 'details' in error ? error.details : undefined);
	}

	if (error instanceof Error) {
		return new BetterChatApiError('UPSTREAM_UNAVAILABLE', error.message);
	}

	return new BetterChatApiError('UPSTREAM_UNAVAILABLE', '请求 BetterChat 服务失败。');
};

const unwrapEnvelope = <T,>(result: ApiResult<T>) => {
	if (result.ok) {
		return result.data;
	}

	throw new BetterChatApiError(result.error.code, result.error.message, result.error.details);
};

const resolveApiUrl = (path: string) => {
	if (apiBaseUrl) {
		return new URL(path, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`).toString();
	}

	if (typeof window === 'undefined') {
		return path;
	}

	return new URL(path, window.location.origin).toString();
};

const requestJson = async <T,>(path: string, init?: RequestInit, timeout: number = TIMEOUTS.default) => {
	let response: Response;

	try {
		response = await fetchWithTimeout(
			resolveApiUrl(path),
			{
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					...(init?.headers ?? {}),
				},
				...init,
			},
			timeout,
		);
	} catch (error) {
		throw toApiError(error);
	}

	let payload: ApiResult<T> | null = null;
	try {
		payload = (await response.json()) as ApiResult<T>;
	} catch {
		throw new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'BetterChat 服务返回了无法解析的响应。');
	}

	if (!response.ok && payload?.ok) {
		throw new BetterChatApiError('UPSTREAM_REJECTED', 'BetterChat 服务拒绝了本次请求。');
	}

	if (!payload) {
		throw new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'BetterChat 服务未返回预期数据。');
	}

	return unwrapEnvelope(payload);
};

const requestForm = async <T,>(path: string, formData: FormData, timeout: number = TIMEOUTS.fileUpload) => {
	let response: Response;

	try {
		response = await fetchWithTimeout(
			resolveApiUrl(path),
			{
				method: 'POST',
				credentials: 'include',
				body: formData,
			},
			timeout,
		);
	} catch (error) {
		throw toApiError(error);
	}

	let payload: ApiResult<T> | null = null;
	try {
		payload = (await response.json()) as ApiResult<T>;
	} catch {
		throw new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'BetterChat 服务返回了无法解析的响应。');
	}

	if (!response.ok && payload?.ok) {
		throw new BetterChatApiError('UPSTREAM_REJECTED', 'BetterChat 服务拒绝了本次请求。');
	}

	if (!payload) {
		throw new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'BetterChat 服务未返回预期数据。');
	}

	return unwrapEnvelope(payload);
};

const runFixture = async <T,>(task: () => Promise<T>) => {
	await sleep();

	try {
		return await task();
	} catch (error) {
		throw toApiError(error);
	}
};

const useFixtureMode = apiMode !== 'api';
type RoomTimelineRequestOptions = {
	cursor?: string;
	limit?: number;
};
type RoomParticipantsRequestOptions = {
	cursor?: string;
	limit?: number;
	query?: string;
};
type RoomMentionCandidatesRequestOptions = {
	limit?: number;
	query?: string;
};

export const betterChatApi = {
	mode: useFixtureMode ? 'fixture' : 'api',
	publicBootstrap: async (): Promise<PublicBootstrap> =>
		useFixtureMode ? runFixture(() => fixtureBetterChatService.publicBootstrap()) : requestJson('/api/public/bootstrap'),
	login: async (request: LoginRequest): Promise<LoginResponse> =>
		useFixtureMode
			? runFixture(() => fixtureBetterChatService.login(request))
			: requestJson('/api/session/login', {
				method: 'POST',
				body: JSON.stringify(request),
			}),
	logout: async (): Promise<void> => {
		if (useFixtureMode) {
			return runFixture(async () => {
				await fixtureBetterChatService.logout();
			});
		}

		await requestJson<Record<string, never>>('/api/session/logout', {
			method: 'POST',
			body: JSON.stringify({}),
		});
	},
	workspace: async (): Promise<WorkspaceBootstrap> =>
		useFixtureMode ? runFixture(() => fixtureBetterChatService.workspace()) : requestJson('/api/workspace'),
	roomList: async (): Promise<RoomListSnapshot> =>
		useFixtureMode
			? runFixture(async () => toRoomListSnapshot(await fixtureBetterChatService.directory()))
			: toRoomListSnapshot(await requestJson<DirectorySnapshot>('/api/directory', undefined, TIMEOUTS.sidebar)),
	room: async (roomId: string): Promise<RoomSnapshot> =>
		useFixtureMode
			? runFixture(async () => toRoomSnapshot(await fixtureBetterChatService.conversation(roomId)))
			: toRoomSnapshot(await requestJson<ConversationSnapshot>(`/api/conversations/${roomId}`, undefined, TIMEOUTS.roomDetails)),
	roomTimeline: async (roomId: string, options: RoomTimelineRequestOptions = {}): Promise<RoomTimelineSnapshot> => {
		const params = new URLSearchParams();
		if (options.cursor) {
			params.set('cursor', options.cursor);
		}
		if (options.limit !== undefined) {
			params.set('limit', String(options.limit));
		}

		const suffix = params.size > 0 ? `?${params.toString()}` : '';
		return useFixtureMode
			? runFixture(async () => toRoomTimelineSnapshot(await fixtureBetterChatService.conversationTimeline(roomId, options)))
			: toRoomTimelineSnapshot(
					await requestJson<ConversationTimelineSnapshot>(`/api/conversations/${roomId}/timeline${suffix}`, undefined, TIMEOUTS.timeline),
			  );
	},
	roomParticipants: async (roomId: string, options: RoomParticipantsRequestOptions = {}): Promise<ConversationParticipantsPage> => {
		const params = new URLSearchParams();
		if (options.cursor) {
			params.set('cursor', options.cursor);
		}
		if (options.limit !== undefined) {
			params.set('limit', String(options.limit));
		}
		if (options.query && options.query.trim()) {
			params.set('q', options.query.trim());
		}

		const suffix = params.size > 0 ? `?${params.toString()}` : '';
		return useFixtureMode
			? runFixture(async () => fixtureBetterChatService.conversationParticipants(roomId, options))
			: requestJson<ConversationParticipantsPage>(`/api/conversations/${roomId}/participants${suffix}`, undefined, TIMEOUTS.roomDetails);
	},
	roomMentionCandidates: async (
		roomId: string,
		options: RoomMentionCandidatesRequestOptions = {},
	): Promise<ConversationMentionCandidatesResponse> => {
		const params = new URLSearchParams();
		if (options.limit !== undefined) {
			params.set('limit', String(options.limit));
		}
		if (options.query !== undefined) {
			params.set('q', options.query);
		}

		const suffix = params.size > 0 ? `?${params.toString()}` : '';
		return useFixtureMode
			? runFixture(async () => fixtureBetterChatService.conversationMentionCandidates(roomId, options))
			: requestJson<ConversationMentionCandidatesResponse>(`/api/conversations/${roomId}/mention-candidates${suffix}`, undefined, TIMEOUTS.roomDetails);
	},
	roomMessageContext: async (
		roomId: string,
		messageId: string,
		options: { after?: number; before?: number } = {},
	): Promise<MessageContextSnapshot> => {
		const params = new URLSearchParams();
		if (options.before !== undefined) {
			params.set('before', String(options.before));
		}
		if (options.after !== undefined) {
			params.set('after', String(options.after));
		}

		const suffix = params.size > 0 ? `?${params.toString()}` : '';
		return useFixtureMode
			? runFixture(async () =>
					toMessageContextSnapshot(await fixtureBetterChatService.conversationMessageContext(roomId, messageId, options)),
			  )
			: toMessageContextSnapshot(
					await requestJson<ConversationMessageContextSnapshot>(
						`/api/conversations/${roomId}/messages/${messageId}/context${suffix}`,
						undefined,
						TIMEOUTS.timeline,
					),
			  );
	},
	sendMessage: async (roomId: string, request: SendMessageRequest): Promise<SendMessageResponse> =>
		useFixtureMode
			? runFixture(async () =>
					toSendMessageResponse(
						await fixtureBetterChatService.createConversationMessage(roomId, toCreateConversationMessageRequest(request)),
					),
			  )
			: toSendMessageResponse(
					await requestJson<CreateConversationMessageResponse>(`/api/conversations/${roomId}/messages`, {
						method: 'POST',
						body: JSON.stringify(toCreateConversationMessageRequest(request)),
					}, TIMEOUTS.sendMessage),
			  ),
	editMessage: async (roomId: string, messageId: string, request: EditMessageRequest): Promise<EditMessageResponse> =>
		useFixtureMode
			? runFixture(async () => toEditMessageResponse(await fixtureBetterChatService.updateMessage(roomId, messageId, request)))
			: toEditMessageResponse(
					await requestJson<ContractUpdateMessageResponse>(
						`/api/conversations/${roomId}/messages/${encodeURIComponent(messageId)}`,
						{
							method: 'PATCH',
							body: JSON.stringify(request),
						},
						TIMEOUTS.sendMessage,
					),
			  ),
	deleteMessage: async (roomId: string, messageId: string): Promise<DeleteMessageResponse> =>
		useFixtureMode
			? runFixture(async () => toDeleteMessageResponse(await fixtureBetterChatService.deleteMessage(roomId, messageId)))
			: toDeleteMessageResponse(
					await requestJson<ContractDeleteMessageResponse>(
						`/api/conversations/${roomId}/messages/${encodeURIComponent(messageId)}`,
						{ method: 'DELETE' },
						TIMEOUTS.sendMessage,
					),
			  ),
	uploadImage: async (
		roomId: string,
		request: { file: File; submissionId?: string; text?: string },
	): Promise<SendMessageResponse> => {
		if (useFixtureMode) {
			return runFixture(async () => toSendMessageResponse(await fixtureBetterChatService.uploadConversationMedia(roomId, request)));
		}

		const formData = new FormData();
		formData.set('file', request.file, request.file.name);
		if (request.submissionId) {
			formData.set('submissionId', request.submissionId);
		}
		if (request.text) {
			formData.set('text', request.text);
		}

		return toSendMessageResponse(
			await requestForm<CreateConversationMessageResponse>(`/api/conversations/${roomId}/media`, formData, TIMEOUTS.fileUpload),
		);
	},
	setRoomFavorite: async (roomId: string, request: SetRoomFavoriteRequest): Promise<RoomFavoriteMutationResponse> =>
		useFixtureMode
			? runFixture(async () =>
					toFavoriteMutationResponse({
						roomId,
						favorite: request.favorite,
						response: await fixtureBetterChatService.membershipCommand(roomId, {
							type: 'set-starred',
							value: request.favorite,
						}),
					}),
			  )
			: toFavoriteMutationResponse({
					roomId,
					favorite: request.favorite,
					response: await requestJson<MembershipCommandResponse>(`/api/conversations/${roomId}/membership/commands`, {
						method: 'POST',
						body: JSON.stringify({
							type: 'set-starred',
							value: request.favorite,
						}),
					}, TIMEOUTS.sendMessage),
			  }),
	setRoomReadState: async (roomId: string, request: SetRoomReadStateRequest): Promise<RoomReadStateMutationResponse> =>
		useFixtureMode
			? runFixture(async () =>
					toReadStateMutationResponse({
						roomId,
						response: await fixtureBetterChatService.membershipCommand(
							roomId,
							request.state === 'read'
								? {
										type: 'mark-read',
								  }
								: {
										type: 'mark-unread',
										...(request.firstUnreadMessageId ? { fromMessageId: request.firstUnreadMessageId } : {}),
								  },
						),
					}),
			  )
			: toReadStateMutationResponse({
					roomId,
					response: await requestJson<MembershipCommandResponse>(`/api/conversations/${roomId}/membership/commands`, {
						method: 'POST',
						body: JSON.stringify(
							request.state === 'read'
								? {
										type: 'mark-read',
								  }
								: {
										type: 'mark-unread',
										...(request.firstUnreadMessageId ? { fromMessageId: request.firstUnreadMessageId } : {}),
								  },
						),
					}, TIMEOUTS.sendMessage),
			  }),
	setRoomVisibility: async (roomId: string, request: SetRoomVisibilityRequest): Promise<RoomVisibilityMutationResponse> =>
		useFixtureMode
			? runFixture(async () =>
					toVisibilityMutationResponse({
						roomId,
						visibility: request.visibility,
						response: await fixtureBetterChatService.membershipCommand(roomId, {
							type: 'set-listing',
							value: request.visibility === 'visible' ? 'listed' : 'hidden',
						}),
					}),
			  )
			: toVisibilityMutationResponse({
					roomId,
					visibility: request.visibility,
					response: await requestJson<MembershipCommandResponse>(`/api/conversations/${roomId}/membership/commands`, {
						method: 'POST',
						body: JSON.stringify({
							type: 'set-listing',
							value: request.visibility === 'visible' ? 'listed' : 'hidden',
						}),
					}, TIMEOUTS.sendMessage),
			  }),
	directConversationLookup: async (userId: string): Promise<DirectConversationLookupResult> =>
		useFixtureMode
			? runFixture(async () => toDirectConversationLookupResult(await fixtureBetterChatService.lookupDirectConversation(userId)))
			: toDirectConversationLookupResult(
					await requestJson<DirectConversationLookup>(`/api/users/${encodeURIComponent(userId)}/direct-conversation`),
			  ),
	ensureDirectConversation: async (userId: string): Promise<EnsureDirectConversationResult> =>
		useFixtureMode
			? runFixture(async () => toEnsureDirectConversationResult(await fixtureBetterChatService.ensureDirectConversation(userId)))
			: toEnsureDirectConversationResult(
					await requestJson<EnsureDirectConversationResponse>(`/api/users/${encodeURIComponent(userId)}/direct-conversation`, {
						method: 'PUT',
						body: JSON.stringify({}),
					}),
			  ),
	clearFixtureSession: () => fixtureBetterChatService.clearSession(),
};

export const betterChatQueryKeys = {
	publicBootstrap: ['public-bootstrap'] as const,
	workspace: ['workspace'] as const,
	roomList: ['room-list'] as const,
	room: (roomId: string) => ['room', roomId] as const,
	roomTimeline: (roomId: string) => ['room-timeline', roomId] as const,
	roomTimelineOlder: (roomId: string, cursor: string) => ['room-timeline-older', roomId, cursor] as const,
	roomParticipants: (roomId: string) => ['room-participants', roomId] as const,
	roomMentionCandidates: (roomId: string, query: string) => ['room-mention-candidates', roomId, query] as const,
	directConversation: (userId: string) => ['direct-conversation', userId] as const,
};

export const isBetterChatApiError = (error: unknown): error is BetterChatApiError => error instanceof BetterChatApiError;

export const isTimeoutError = (error: unknown): error is TimeoutError => error instanceof TimeoutError;

export { TimeoutError, TIMEOUTS };

export const resolveBetterChatRealtimeUrl = () => {
	const url = new URL(resolveApiUrl('/api/stream'));
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
};
