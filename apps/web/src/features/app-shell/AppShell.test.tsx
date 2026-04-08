import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';

import type { WorkspaceBootstrap } from '@betterchat/contracts';
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
const mockRealtimeClose = mock(() => {});
const mockRealtimeSetWatchState = mock(() => {});

let workspaceState: WorkspaceBootstrap;
let workspaceError: unknown = null;
let roomListState: RoomListSnapshot;
let roomState: RoomSnapshot;
let timelineState: RoomTimelineSnapshot;
let appShellImportNonce = 0;

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
			mode: 'fixture',
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
			setRoomFavorite: mock(async () => ({
				favorite: true,
				roomId: roomState.room.id,
				sync: {},
			})),
			setRoomReadState: mock(async () => ({
				roomId: roomState.room.id,
				sync: {},
			})),
			setRoomVisibility: mock(async () => ({
				roomId: roomState.room.id,
				sync: {},
				visibility: 'visible',
			})),
			uploadImage: mock(async () => ({
				message: timelineState.messages[0]!,
			})),
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
		createBetterChatRealtimeController: () => ({
			close: mockRealtimeClose,
			setWatchState: mockRealtimeSetWatchState,
		}),
	}));

	mock.module('@/features/composer/loadLiveMarkdownEditor', () => ({
		loadLiveMarkdownEditor: () => new Promise(() => {}),
		preloadLiveMarkdownEditor: () => {},
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
		mockRealtimeClose.mockClear();
		mockRealtimeSetWatchState.mockClear();
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
});
