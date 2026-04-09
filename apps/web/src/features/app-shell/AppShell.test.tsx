import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';

import type { WorkspaceBootstrap } from '@betterchat/contracts';
import type { HTMLAttributes, ReactNode } from 'react';
import { BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY } from '@/features/notifications/notificationPreferences';
import type { RoomListSnapshot, RoomSnapshot, RoomTimelineSnapshot } from '@/lib/chatModels';
import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId } from '@/test/domQueries';
import { setElementBox } from '@/test/layoutHarness';
import { renderWithAppProviders } from '@/test/renderWithAppProviders';
import { MAX_SIDEBAR_WIDTH_PX, MIN_SIDEBAR_WIDTH_PX } from './sidebarWidthPreference';

const mockNavigate = mock(async () => {});
const mockWorkspace = mock(async () => {
	if (workspaceError) {
		throw workspaceError;
	}
	return workspaceState;
});
const mockRoomList = mock(async () => roomListState);
const mockRoom = mock(async () => roomState);
const mockRoomTimeline = mock(async () => timelineState);
const mockRoomParticipants = mock(async () => ({
	conversationId: 'room-ops',
	entries: [],
}));
const mockLogout = mock(async () => {});
const mockSetRoomFavorite = mock(async (_roomId: string, { favorite }: { favorite: boolean }) => ({
	favorite,
	roomId: roomState.room.id,
	sync: {},
}));
const mockUploadImage = mock(async () => ({
	message: timelineState.messages[0]!,
}));
const mockRealtimeClose = mock(() => {});
const mockRealtimeSetWatchState = mock(() => {});
let apiModeState: 'api' | 'fixture' = 'fixture';
let lastRealtimeOptions:
	| {
			onSocketError?: (error: { category: string; message: string; timestamp: number }) => void;
	  }
	| undefined;

let workspaceState: WorkspaceBootstrap;
let workspaceError: unknown = null;
let roomListState: RoomListSnapshot;
let roomState: RoomSnapshot;
let timelineState: RoomTimelineSnapshot;
let appShellImportNonce = 0;

const createDeferred = <T,>() => {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
};

const loadAppShell = async () => {
	mock.restore();
	mock.module('@tanstack/react-router', () => ({
		useNavigate: () => mockNavigate,
	}));

	mock.module('@/lib/betterchat', () => ({
		BetterChatApiError: class BetterChatApiError extends Error {
			readonly code: string;

			constructor(code: string, message: string) {
				super(message);
				this.code = code;
			}
		},
		betterChatApi: {
			deleteMessage: mock(async () => ({ messageId: 'noop', sync: {} })),
			directConversationLookup: mock(async () => ({
				conversation: { state: 'none' },
				user: { displayName: 'Alice Example', id: 'user-alice', username: 'alice' },
			})),
			editMessage: mock(async () => ({
				message: timelineState.messages[0]!,
				sync: {},
			})),
			ensureDirectConversation: mock(async () => ({
				disposition: 'existing-listed',
				roomId: 'dm-alice',
				sync: {},
				user: { displayName: 'Alice Example', id: 'user-alice', username: 'alice' },
			})),
			logout: mockLogout,
			mode: apiModeState,
			room: mockRoom,
			roomList: mockRoomList,
			roomMentionCandidates: mock(async () => ({
				conversationId: roomState.room.id,
				entries: [],
				query: '',
			})),
			roomMessageContext: mock(async () => ({
				anchorIndex: 0,
				anchorMessageId: timelineState.messages[0]?.id ?? 'message-1',
				hasAfter: false,
				hasBefore: false,
				messages: timelineState.messages,
				roomId: timelineState.roomId,
				version: 'context-v1',
			})),
			roomParticipants: mockRoomParticipants,
			roomTimeline: mockRoomTimeline,
			sendMessage: mock(async () => ({
				message: timelineState.messages[0]!,
			})),
			setRoomFavorite: mockSetRoomFavorite,
			setRoomReadState: mock(async () => ({
				roomId: roomState.room.id,
				sync: {},
			})),
			setRoomVisibility: mock(async () => ({
				roomId: roomState.room.id,
				sync: {},
				visibility: 'visible',
			})),
			uploadImage: mockUploadImage,
			workspace: mockWorkspace,
		},
		betterChatQueryKeys: {
			directConversation: (userId: string) => ['direct-conversation', userId] as const,
			room: (roomId: string) => ['room', roomId] as const,
			roomList: ['room-list'] as const,
			roomMentionCandidates: (roomId: string, query: string) => ['room-mention-candidates', roomId, query] as const,
			roomParticipants: (roomId: string) => ['room-participants', roomId] as const,
			roomTimeline: (roomId: string) => ['room-timeline', roomId] as const,
			roomTimelineOlder: (roomId: string, cursor: string) => ['room-timeline-older', roomId, cursor] as const,
			workspace: ['workspace'] as const,
		},
		isBetterChatApiError: (error: unknown): error is { code: string; message: string } =>
			typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string',
	}));

	mock.module('@/lib/betterchat-realtime', () => ({
		createBetterChatRealtimeController: (options: typeof lastRealtimeOptions) => {
			lastRealtimeOptions = options;
			return {
				close: mockRealtimeClose,
				setWatchState: mockRealtimeSetWatchState,
			};
		},
	}));

	mock.module('@/features/composer/loadLiveMarkdownEditor', () => ({
		loadLiveMarkdownEditor: () => new Promise(() => {}),
		preloadLiveMarkdownEditor: () => {},
	}));
	mock.module('@radix-ui/react-dialog', () => ({
		Root: ({ children }: { children: ReactNode }) => <>{children}</>,
		Trigger: ({ asChild, children }: { asChild?: boolean; children: ReactNode }) =>
			asChild ? children : <button type='button'>{children}</button>,
		Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
		Overlay: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
		Content: ({
			onCloseAutoFocus: _onCloseAutoFocus,
			onEscapeKeyDown: _onEscapeKeyDown,
			onFocusOutside: _onFocusOutside,
			onInteractOutside: _onInteractOutside,
			onOpenAutoFocus: _onOpenAutoFocus,
			onPointerDownOutside: _onPointerDownOutside,
			...props
		}: HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => <div {...props} />,
		Title: (props: HTMLAttributes<HTMLHeadingElement>) => <h2 {...props} />,
		Description: (props: HTMLAttributes<HTMLParagraphElement>) => <p {...props} />,
		Close: ({ asChild, children }: { asChild?: boolean; children: ReactNode }) =>
			asChild ? children : <button type='button'>{children}</button>,
	}));

	const module = await import(`./AppShell.tsx?app-shell-test=${appShellImportNonce++}`);
	return module.AppShell as typeof import('./AppShell').AppShell;
};

const createWorkspaceState = (): WorkspaceBootstrap => ({
	capabilities: {
		canSendMessages: true,
		canUploadImages: true,
		realtimeEnabled: false,
	},
	currentUser: {
		displayName: 'Test User',
		id: 'user-self',
		username: 'self',
	},
	workspace: {
		name: 'Ops Workspace',
		version: '7.6.0',
	},
});

const createRoomListState = (): RoomListSnapshot => ({
	rooms: [
		{
			attention: {
				level: 'none',
			},
			favorite: false,
			id: 'room-ops',
			kind: 'channel',
			subtitle: 'Operations room',
			title: 'Ops room',
			visibility: 'visible',
		},
	],
	version: 'room-list-v1',
});

const createRoomState = (): RoomSnapshot => ({
	room: {
		attention: {
			level: 'none',
		},
		capabilities: {
			canChangeVisibility: true,
			canFavorite: true,
			canSendMessages: true,
			canUploadImages: true,
		},
		description: 'Operations coordination',
		favorite: false,
		id: 'room-ops',
		kind: 'channel',
		memberCount: 3,
		subtitle: 'Operations room',
		title: 'Ops room',
		topic: 'Coordinate live operations',
		visibility: 'visible',
	},
	version: 'room-v1',
});

const createTimelineState = (): RoomTimelineSnapshot => ({
	messages: [
		{
			actions: {
				delete: true,
				edit: true,
			},
			author: {
				displayName: 'Alice Example',
				id: 'user-alice',
				username: 'alice',
			},
			body: {
				rawMarkdown: 'Hello from AppShell',
			},
			createdAt: '2026-04-07T10:00:00.000Z',
			flags: {
				deleted: false,
				edited: false,
			},
			id: 'message-1',
			roomId: 'room-ops',
		},
	],
	roomId: 'room-ops',
	version: 'timeline-v1',
});

describe('AppShell component contracts', () => {
	let dom: TestDomHarness;
	let AppShell: typeof import('./AppShell').AppShell;

	beforeEach(async () => {
		workspaceState = createWorkspaceState();
		workspaceError = null;
		roomListState = createRoomListState();
		roomState = createRoomState();
		timelineState = createTimelineState();
		mockNavigate.mockImplementation(async () => {});
		mockNavigate.mockClear();
		mockWorkspace.mockClear();
		mockRoomList.mockClear();
		mockRoom.mockClear();
		mockRoomTimeline.mockClear();
		mockRoomParticipants.mockClear();
		mockLogout.mockClear();
		mockSetRoomFavorite.mockClear();
		mockUploadImage.mockClear();
		mockUploadImage.mockImplementation(async () => ({
			message: timelineState.messages[0]!,
		}));
		mockRealtimeClose.mockClear();
		mockRealtimeSetWatchState.mockClear();
		apiModeState = 'fixture';
		lastRealtimeOptions = undefined;
		AppShell = await loadAppShell();
	});

	afterEach(async () => {
		cleanup();
		if (dom) {
			await dom.flushAnimationFrames();
			await Promise.resolve();
			await Promise.resolve();
			await new Promise((resolve) => setTimeout(resolve, 0));
			dom.cleanup();
		}
		mock.restore();
	});

	it('navigates back to /login when workspace bootstrap becomes unauthenticated', async () => {
		dom = installTestDom();
		workspaceError = {
			code: 'UNAUTHENTICATED',
			message: 'Session expired',
		};
		mockNavigate.mockImplementation(async () => {
			workspaceError = null;
		});

		renderWithAppProviders(<AppShell roomId='room-ops' />);

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith({
				replace: true,
				to: '/login',
			}),
		);
	});

	it('suppresses console errors for recoverable websocket interruptions', async () => {
		dom = installTestDom();
		apiModeState = 'api';
		workspaceState = {
			...workspaceState,
			capabilities: {
				...workspaceState.capabilities,
				realtimeEnabled: true,
			},
		};
		AppShell = await loadAppShell();
		const consoleError = mock(() => {});
		const originalConsoleError = console.error;
		console.error = consoleError;

		try {
			renderWithAppProviders(<AppShell roomId='room-ops' />);
			await waitFor(() => expect(lastRealtimeOptions?.onSocketError).toBeTruthy());

			act(() => {
				lastRealtimeOptions?.onSocketError?.({
					category: 'connection-lost',
					message: 'socket reconnecting',
					timestamp: Date.now(),
				});
			});

			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			console.error = originalConsoleError;
		}
	});

	it('quiesces realtime immediately when logout begins in API mode', async () => {
		dom = installTestDom();
		apiModeState = 'api';
		workspaceState = {
			...workspaceState,
			capabilities: {
				...workspaceState.capabilities,
				realtimeEnabled: true,
			},
		};
		let resolveLogout: (() => void) | null = null;
		mockLogout.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveLogout = resolve;
				}),
		);
		AppShell = await loadAppShell();

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'settings-trigger')).toBeTruthy());

		await act(async () => {
			fireEvent.click(getByTestId(container, 'settings-trigger'));
		});
		await waitFor(() => expect(getByTestId(document, 'settings-panel')).toBeTruthy());
		await act(async () => {
			fireEvent.click(getByTestId(document, 'settings-logout'));
		});

		await waitFor(() => expect(mockRealtimeClose.mock.calls.length).toBeGreaterThanOrEqual(1));
		expect(mockNavigate).not.toHaveBeenCalled();

		await act(async () => {
			resolveLogout?.();
			await Promise.resolve();
		});

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith({
				replace: true,
				to: '/login',
			}),
		);
	});

	it('expands the collapsed sidebar on a rail click and persists the restored state', async () => {
		dom = installTestDom({
			localStorageSeed: {
				'betterchat.sidebar-collapsed.v1': JSON.stringify(true),
				'betterchat.sidebar-width.v1': JSON.stringify(292),
			},
		});

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'sidebar-room-room-ops')).toBeTruthy());

		const handle = getByTestId(container, 'sidebar-resize-handle');
		const sidebar = getByTestId(container, 'app-sidebar');

		expect(sidebar.getAttribute('data-collapsed')).toBe('true');

		await act(async () => {
			fireEvent.pointerDown(handle, {
				button: 0,
				clientX: 0,
				pointerId: 1,
				pointerType: 'mouse',
			});
			fireEvent.pointerUp(handle, {
				clientX: 0,
				pointerId: 1,
				pointerType: 'mouse',
			});
		});

		await waitFor(() => expect(handle.getAttribute('data-sidebar-collapsed')).toBe('false'));
		await waitFor(() => expect(sidebar.getAttribute('data-collapsed')).toBe('false'));
		await waitFor(() => expect(window.localStorage.getItem('betterchat.sidebar-collapsed.v1')).toBe(JSON.stringify(false)));
	});

	it('supports keyboard resizing on the sidebar rail with clamp-aware step and boundary commands', async () => {
		dom = installTestDom({
			localStorageSeed: {
				'betterchat.sidebar-collapsed.v1': JSON.stringify(false),
				'betterchat.sidebar-width.v1': JSON.stringify(320),
			},
		});

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'sidebar-room-room-ops')).toBeTruthy());

		const handle = getByTestId(container, 'sidebar-resize-handle');

		await act(async () => {
			fireEvent.focus(handle);
			fireEvent.keyDown(handle, { key: 'Enter' });
		});

		await waitFor(() => expect(handle.getAttribute('data-keyboard-adjusting')).toBe('true'));

		await act(async () => {
			fireEvent.keyDown(handle, { key: 'ArrowLeft' });
		});
		await waitFor(() => expect(window.localStorage.getItem('betterchat.sidebar-width.v1')).toBe(JSON.stringify(304)));

		await act(async () => {
			fireEvent.keyDown(handle, { key: 'Home' });
		});
		await waitFor(() => expect(window.localStorage.getItem('betterchat.sidebar-width.v1')).toBe(JSON.stringify(MIN_SIDEBAR_WIDTH_PX)));

		await act(async () => {
			fireEvent.keyDown(handle, { key: 'End' });
		});
		await waitFor(() => expect(window.localStorage.getItem('betterchat.sidebar-width.v1')).toBe(JSON.stringify(MAX_SIDEBAR_WIDTH_PX)));

		await act(async () => {
			fireEvent.keyDown(handle, { key: 'Escape' });
		});
		await waitFor(() => expect(handle.getAttribute('data-keyboard-adjusting')).toBe('false'));
	});

	it('previews and commits expanding the sidebar when dragging from collapsed to open', async () => {
		dom = installTestDom({
			localStorageSeed: {
				'betterchat.sidebar-collapsed.v1': JSON.stringify(true),
				'betterchat.sidebar-width.v1': JSON.stringify(292),
			},
		});

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'sidebar-room-room-ops')).toBeTruthy());

		const handle = getByTestId(container, 'sidebar-resize-handle');
		const sidebar = getByTestId(container, 'app-sidebar');

		expect(sidebar.getAttribute('data-collapsed')).toBe('true');

		await act(async () => {
			fireEvent.pointerDown(handle, {
				button: 0,
				clientX: 0,
				pointerId: 1,
				pointerType: 'mouse',
			});
			fireEvent.pointerMove(handle, {
				clientX: 300,
				pointerId: 1,
				pointerType: 'mouse',
			});
		});

		await waitFor(() => expect(handle.getAttribute('data-sidebar-collapsed')).toBe('false'));
		await waitFor(() => expect(sidebar.getAttribute('data-collapsed')).toBe('false'));

		await act(async () => {
			fireEvent.pointerUp(handle, {
				clientX: 300,
				pointerId: 1,
				pointerType: 'mouse',
			});
		});

		await waitFor(() => expect(window.localStorage.getItem('betterchat.sidebar-collapsed.v1')).toBe(JSON.stringify(false)));
	});

	it('previews and commits collapsing the sidebar when dragged to the collapse rail threshold', async () => {
		dom = installTestDom({
			localStorageSeed: {
				'betterchat.sidebar-collapsed.v1': JSON.stringify(false),
				'betterchat.sidebar-width.v1': JSON.stringify(320),
			},
		});

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'sidebar-room-room-ops')).toBeTruthy());

		const handle = getByTestId(container, 'sidebar-resize-handle');
		const sidebar = getByTestId(container, 'app-sidebar');
		setElementBox(sidebar, {
			clientWidth: 320,
			height: 800,
			offsetHeight: 800,
			width: 320,
		});

		await act(async () => {
			fireEvent.pointerDown(handle, {
				button: 0,
				clientX: 320,
				pointerId: 1,
				pointerType: 'mouse',
			});
			fireEvent.pointerMove(handle, {
				clientX: 12,
				pointerId: 1,
				pointerType: 'mouse',
			});
		});

		await waitFor(() => expect(handle.getAttribute('data-sidebar-collapsed')).toBe('true'));

		await act(async () => {
			fireEvent.pointerUp(handle, {
				clientX: 12,
				pointerId: 1,
				pointerType: 'mouse',
			});
		});

		await waitFor(() => expect(sidebar.getAttribute('data-collapsed')).toBe('true'));
		await waitFor(() => expect(window.localStorage.getItem('betterchat.sidebar-collapsed.v1')).toBe(JSON.stringify(true)));
	});

	it('keeps a retried image upload expanded when the canonical message replaces the failed local submission', async () => {
		dom = installTestDom();
		timelineState = {
			...createTimelineState(),
			messages: [],
		};
		let uploadAttempt = 0;
		mockUploadImage.mockImplementation(async (_roomId: string, request: { file: File; submissionId?: string; text?: string }) => {
			uploadAttempt += 1;
			if (uploadAttempt === 1) {
				throw new Error('图片发送失败，请重试。');
			}

			return {
				message: {
					actions: {
						delete: true,
						edit: true,
					},
					attachments: [
						{
							id: 'attachment-canonical-image',
							kind: 'image',
							preview: {
								url: '/api/media/file-upload/upload-thumb.png',
							},
							source: {
								url: '/api/media/file-upload/upload.png',
							},
							title: request.file.name,
						},
					],
					author: {
						displayName: workspaceState.currentUser.displayName,
						id: workspaceState.currentUser.id,
						username: workspaceState.currentUser.username,
					},
					body: {
						rawMarkdown: request.text ?? '',
					},
					createdAt: '2026-04-09T12:00:00.000Z',
					flags: {
						deleted: false,
						edited: false,
					},
					id: 'message-canonical-image',
					roomId: 'room-ops',
					submissionId: request.submissionId,
				},
			};
		});

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'composer-textarea')).toBeTruthy());

		const composerImageInput = getByTestId(container, 'composer-image-input') as HTMLInputElement;
		const composerTextarea = getByTestId(container, 'composer-textarea') as HTMLTextAreaElement;
		const composerSend = getByTestId(container, 'composer-send');
		const uploadFile = new File(
			[
				Uint8Array.from([
					0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
					0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
					0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
					0x03, 0x03, 0x01, 0xff, 0xa5, 0x9f, 0x81, 0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
					0xae, 0x42, 0x60, 0x82,
				]),
			],
			'betterchat-e2e-upload.png',
			{ type: 'image/png' },
		);

		await act(async () => {
			fireEvent.change(composerImageInput, {
				target: {
					files: [uploadFile],
				},
			});
		});
		await act(async () => {
			fireEvent.change(composerTextarea, {
				target: {
					value: 'Retry image upload',
				},
			});
		});
		await act(async () => {
			fireEvent.click(composerSend);
		});

		const failedMessage = () => container.querySelector<HTMLElement>('article[data-delivery-state="failed"]');
		await waitFor(() => expect(failedMessage()).toBeTruthy());
		const failedMessageId = failedMessage()?.getAttribute('data-message-id');
		expect(failedMessageId).toBeTruthy();
		if (!failedMessageId) {
			throw new Error('expected failed optimistic image message id');
		}

		await act(async () => {
			fireEvent.click(getByTestId(container, `timeline-message-retry-${failedMessageId}`));
		});

		await waitFor(() =>
			expect(getByTestId(container, 'timeline-message-content-message-canonical-image').getAttribute('data-collapsed')).toBe('false'),
		);
	});

	it('renders the attention dock outside the scrollable sidebar body and excludes the active room', async () => {
		dom = installTestDom();
		roomListState = {
			rooms: [
				{
					attention: {
						badgeCount: 1,
						level: 'mention',
					},
					favorite: false,
					id: 'room-ops',
					kind: 'channel',
					subtitle: 'Operations room',
					title: 'Ops room',
					visibility: 'visible',
				},
				{
					attention: {
						badgeCount: 3,
						level: 'unread',
					},
					favorite: false,
					id: 'dm-alice',
					kind: 'dm',
					subtitle: '@alice',
					title: 'Alice Example',
					visibility: 'visible',
				},
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-quiet',
					kind: 'channel',
					subtitle: 'Quiet room',
					title: 'Quiet room',
					visibility: 'visible',
				},
			],
			version: 'room-list-v2',
		};

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);

		await waitFor(() => expect(getByTestId(container, 'sidebar-attention-dock')).toBeTruthy());

		const dock = getByTestId(container, 'sidebar-attention-dock');
		const sidebarBody = getByTestId(container, 'sidebar-body');

		expect(sidebarBody.contains(dock)).toBe(false);
		expect(container.querySelector('[data-testid="sidebar-attention-dock-item-room-ops"]')).toBeNull();
		expect(getByTestId(container, 'sidebar-attention-dock-item-dm-alice')).toBeTruthy();
	});

	it('opens a room when the attention dock item is clicked', async () => {
		dom = installTestDom();
		roomListState = {
			rooms: [
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-ops',
					kind: 'channel',
					subtitle: 'Operations room',
					title: 'Ops room',
					visibility: 'visible',
				},
				{
					attention: {
						badgeCount: 1,
						level: 'mention',
					},
					favorite: false,
					id: 'dm-alice',
					kind: 'dm',
					subtitle: '@alice',
					title: 'Alice Example',
					visibility: 'visible',
				},
			],
			version: 'room-list-v2',
		};

		const { container } = renderWithAppProviders(<AppShell roomId='room-ops' />);

		await waitFor(() => expect(getByTestId(container, 'sidebar-attention-dock-item-dm-alice')).toBeTruthy());
		mockNavigate.mockClear();

		await act(async () => {
			fireEvent.click(getByTestId(container, 'sidebar-attention-dock-item-dm-alice'));
		});

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith({
				params: {
					roomId: 'dm-alice',
				},
				to: '/app/rooms/$roomId',
			}),
		);
	});

	it('keeps sidebar scroll stable when inactive room attention changes without navigation intent', async () => {
		dom = installTestDom();
		roomListState = {
			rooms: [
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-ops',
					kind: 'channel',
					subtitle: 'Operations room',
					title: 'Ops room',
					visibility: 'visible',
				},
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-quiet',
					kind: 'channel',
					subtitle: 'Quiet room',
					title: 'Quiet room',
					visibility: 'visible',
				},
			],
			version: 'room-list-v1',
		};

		const { container, queryClient } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'sidebar-room-room-ops')).toBeTruthy());

		const sidebarBody = getByTestId(container, 'sidebar-body');
		const activeRoomButton = getByTestId(container, 'sidebar-room-room-ops');
		const inactiveRoomButton = getByTestId(container, 'sidebar-room-room-quiet');

		setElementBox(sidebarBody, {
			clientHeight: 120,
			height: 120,
			scrollTop: 0,
			top: 0,
			width: 260,
		});
		setElementBox(activeRoomButton, {
			height: 40,
			offsetTop: 80,
			top: 80,
			width: 240,
		});
		setElementBox(inactiveRoomButton, {
			height: 40,
			offsetTop: 16,
			top: 16,
			width: 240,
		});

		roomListState = {
			rooms: [
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-ops',
					kind: 'channel',
					subtitle: 'Operations room',
					title: 'Ops room',
					visibility: 'visible',
				},
				{
					attention: {
						badgeCount: 1,
						level: 'mention',
					},
					favorite: false,
					id: 'room-quiet',
					kind: 'channel',
					subtitle: 'Quiet room',
					title: 'Quiet room',
					visibility: 'visible',
				},
			],
			version: 'room-list-v2',
		};

		setElementBox(sidebarBody, {
			clientHeight: 90,
			height: 90,
			scrollTop: 0,
			top: 0,
			width: 260,
		});
		setElementBox(activeRoomButton, {
			height: 40,
			offsetTop: 80,
			top: 80,
			width: 240,
		});

		await act(async () => {
			await queryClient.invalidateQueries({
				queryKey: ['room-list'],
			});
		});

		await waitFor(() => expect(getByTestId(container, 'sidebar-attention-dock-item-room-quiet')).toBeTruthy());
		expect(sidebarBody.scrollTop).toBe(0);
	});

	it('keeps inactive-room browser notifications alive across sidebar rerenders while the timeline fetch is in flight', async () => {
		dom = installTestDom({
			localStorageSeed: {
				[BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY]: 'foreground',
			},
			notificationPermission: 'granted',
		});
		roomListState = {
			rooms: [
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-ops',
					kind: 'channel',
					subtitle: 'Operations room',
					title: 'Ops room',
					visibility: 'visible',
				},
				{
					attention: {
						level: 'none',
					},
					favorite: false,
					id: 'room-quiet',
					kind: 'channel',
					subtitle: 'Quiet room',
					title: 'Quiet room',
					visibility: 'visible',
				},
			],
			version: 'room-list-v1',
		};

		const recordedNotifications: Array<{ body?: string; tag?: string; title: string }> = [];
		class RecordingNotification {
			static permission: NotificationPermission = 'granted';

			static async requestPermission(): Promise<NotificationPermission> {
				return 'granted';
			}

			onclick: ((this: Notification, ev: Event) => unknown) | null = null;

			close() {}

			constructor(title: string, options?: NotificationOptions) {
				recordedNotifications.push({
					body: options?.body,
					tag: options?.tag,
					title,
				});
			}
		}

		Object.defineProperty(window, 'Notification', {
			configurable: true,
			value: RecordingNotification,
		});
		Object.defineProperty(globalThis, 'Notification', {
			configurable: true,
			value: RecordingNotification,
		});

		let resolveQuietTimeline: ((value: RoomTimelineSnapshot) => void) | null = null;
		const quietTimelinePromise = new Promise<RoomTimelineSnapshot>((resolve) => {
			resolveQuietTimeline = resolve;
		});
		mockRoomTimeline.mockImplementation(async (targetRoomId: string) => {
			if (targetRoomId === 'room-quiet') {
				return quietTimelinePromise;
			}

			return timelineState;
		});

		const { container, queryClient } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'sidebar-room-room-quiet')).toBeTruthy());

		await act(async () => {
			queryClient.setQueryData<RoomListSnapshot>(['room-list'], {
				rooms: [
					{
						attention: {
							level: 'none',
						},
						favorite: false,
						id: 'room-ops',
						kind: 'channel',
						subtitle: 'Operations room',
						title: 'Ops room',
						visibility: 'visible',
					},
					{
						attention: {
							badgeCount: 1,
							level: 'mention',
						},
						favorite: false,
						id: 'room-quiet',
						kind: 'channel',
						subtitle: 'Quiet room',
						title: 'Quiet room',
						visibility: 'visible',
					},
				],
				version: 'room-list-v2',
			});
		});

		await waitFor(() =>
			expect(
				mockRoomTimeline.mock.calls.some(([targetRoomId]) => targetRoomId === 'room-quiet'),
			).toBe(true),
		);

		await act(async () => {
			queryClient.setQueryData<RoomListSnapshot>(['room-list'], {
				rooms: [
					{
						attention: {
							level: 'none',
						},
						favorite: false,
						id: 'room-ops',
						kind: 'channel',
						subtitle: 'Operations room',
						title: 'Ops room',
						visibility: 'visible',
					},
					{
						attention: {
							badgeCount: 1,
							level: 'mention',
						},
						favorite: false,
						id: 'room-quiet',
						kind: 'channel',
						subtitle: 'Quiet room',
						title: 'Quiet room',
						visibility: 'visible',
					},
				],
				version: 'room-list-v3',
			});
		});

		await act(async () => {
			resolveQuietTimeline?.({
				messages: [
					{
						actions: {
							delete: true,
							edit: true,
						},
						author: {
							displayName: 'Alice Example',
							id: 'user-alice',
							username: 'alice',
						},
						body: {
							rawMarkdown: '@self urgent quiet mention',
						},
						createdAt: '2026-04-09T09:00:00.000Z',
						flags: {
							deleted: false,
							edited: false,
						},
						id: 'quiet-message-1',
						roomId: 'room-quiet',
					},
				],
				roomId: 'room-quiet',
				version: 'timeline-quiet-v1',
			});
			await Promise.resolve();
		});

		await waitFor(() => expect(recordedNotifications).toHaveLength(1));
		expect(recordedNotifications[0]?.title).toBe('Quiet room');
		expect(recordedNotifications[0]?.body).toContain('Alice Example');
		expect(recordedNotifications[0]?.body).toContain('@self urgent quiet mention');
	});

	it('queues a second favorite toggle instead of dropping it while the first mutation is still in flight', async () => {
		dom = installTestDom();
		apiModeState = 'api';
		AppShell = await loadAppShell();
		const firstFavoriteMutation = createDeferred<{ favorite: boolean; roomId: string; sync: {} }>();
		const secondFavoriteMutation = createDeferred<{ favorite: boolean; roomId: string; sync: {} }>();

		mockSetRoomFavorite.mockImplementationOnce(async (_roomId: string, { favorite }: { favorite: boolean }) => {
			roomListState = {
				...roomListState,
				rooms: roomListState.rooms.map((room) => (room.id === roomState.room.id ? { ...room, favorite } : room)),
			};
			roomState = {
				...roomState,
				room: {
					...roomState.room,
					favorite,
				},
			};
			return firstFavoriteMutation.promise;
		});
		mockSetRoomFavorite.mockImplementationOnce(async (_roomId: string, { favorite }: { favorite: boolean }) => {
			roomListState = {
				...roomListState,
				rooms: roomListState.rooms.map((room) => (room.id === roomState.room.id ? { ...room, favorite } : room)),
			};
			roomState = {
				...roomState,
				room: {
					...roomState.room,
					favorite,
				},
			};
			return secondFavoriteMutation.promise;
		});

		const { container, queryClient } = renderWithAppProviders(<AppShell roomId='room-ops' />);
		await waitFor(() => expect(getByTestId(container, 'room-favorite-toggle')).toBeTruthy());

		const favoriteToggle = getByTestId(container, 'room-favorite-toggle');
		act(() => {
			favoriteToggle.focus();
		});
		expect(document.activeElement).toBe(favoriteToggle);
		expect(favoriteToggle.getAttribute('aria-pressed')).toBe('false');

		await act(async () => {
			fireEvent.click(favoriteToggle);
		});

		await waitFor(() => expect(mockSetRoomFavorite).toHaveBeenCalledTimes(1));
		expect(favoriteToggle.getAttribute('aria-pressed')).toBe('true');

		await act(async () => {
			fireEvent.click(favoriteToggle);
		});

		expect(mockSetRoomFavorite).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(favoriteToggle);

		await act(async () => {
			firstFavoriteMutation.resolve({
				favorite: true,
				roomId: 'room-ops',
				sync: {},
			});
			await firstFavoriteMutation.promise;
		});

		await waitFor(() => expect(mockSetRoomFavorite).toHaveBeenCalledTimes(2));
		expect(mockSetRoomFavorite.mock.calls[1]).toEqual([
			'room-ops',
			{
				favorite: false,
			},
		]);

		await act(async () => {
			secondFavoriteMutation.resolve({
				favorite: false,
				roomId: 'room-ops',
				sync: {},
			});
			await secondFavoriteMutation.promise;
		});

		await waitFor(() => expect(favoriteToggle.getAttribute('aria-pressed')).toBe('false'));
		expect(document.activeElement).toBe(favoriteToggle);
	});
});
