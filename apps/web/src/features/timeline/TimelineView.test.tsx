import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';

import type { RoomTimelineSnapshot, TimelineMessage } from '@/lib/chatModels';
import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId, queryByTestId } from '@/test/domQueries';
import { setElementBox } from '@/test/layoutHarness';
import { renderWithAppProviders } from '@/test/renderWithAppProviders';

let timelineViewImportNonce = 0;

const loadTimelineView = async () => {
	mock.restore();
	mock.module('@/components/MarkdownContent', () => ({
		MarkdownContent: ({ source }: { source: string }) => <div data-testid='mock-markdown-content'>{source}</div>,
	}));

	mock.module('@/features/media/ImageGallery', () => ({
		GalleryImage: (props: { alt?: string; src: string }) => <img alt={props.alt ?? ''} src={props.src} />,
		TimelineImageGalleryProvider: ({ children }: PropsWithChildren) => <>{children}</>,
	}));

	mock.module('@/features/messages/ForwardedMessageCard', () => ({
		ForwardedMessageCard: ({ bodyMarkdown }: { bodyMarkdown: string }) => <div data-testid='mock-forwarded-card'>{bodyMarkdown}</div>,
	}));

	const module = await import(`./TimelineView.tsx?timeline-view-test=${timelineViewImportNonce++}`);
	return module.TimelineView as typeof import('./TimelineView').TimelineView;
};

const createMessage = ({
	attachments,
	authorDisplayName = 'Alice Example',
	authorId = 'user-alice',
	body = 'Hello world',
	createdAt = '2026-04-07T10:00:00.000Z',
	deleted = false,
	id,
	replyTo,
	submissionId,
}: {
	attachments?: TimelineMessage['attachments'];
	authorDisplayName?: string;
	authorId?: string;
	body?: string;
	createdAt?: string;
	deleted?: boolean;
	id: string;
	replyTo?: TimelineMessage['replyTo'];
	submissionId?: string;
}): TimelineMessage => ({
	actions: {
		delete: true,
		edit: true,
	},
	author: {
		displayName: authorDisplayName,
		id: authorId,
		username: authorDisplayName.toLowerCase().replace(/\s+/g, '.'),
	},
	attachments,
	body: {
		rawMarkdown: body,
	},
	createdAt,
	flags: {
		deleted,
		edited: false,
	},
	id,
	replyTo,
	reactions: [],
	roomId: 'room-ops',
	submissionId,
});

const createTimeline = (messages: TimelineMessage[]): RoomTimelineSnapshot => ({
	messages,
	roomId: 'room-ops',
	version: 'timeline-v1',
});

describe('TimelineView component contracts', () => {
	let dom: TestDomHarness;
	let TimelineView: typeof import('./TimelineView').TimelineView;

	beforeEach(async () => {
		dom = installTestDom();
		TimelineView = await loadTimelineView();
	});

	afterEach(async () => {
		cleanup();
		await dom.flushAnimationFrames();
		await Promise.resolve();
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
		dom.cleanup();
		mock.restore();
	});

	it('renders the unread divider at the configured unread anchor', () => {
		const timeline: RoomTimelineSnapshot = {
			...createTimeline([
				createMessage({
					id: 'message-before',
				}),
				createMessage({
					body: 'Unread starts here',
					createdAt: '2026-04-07T10:03:00.000Z',
					id: 'message-unread',
				}),
			]),
			unreadAnchorMessageId: 'message-unread',
		};

		const { container } = renderWithAppProviders(<TimelineView timeline={timeline} />, {
			withTheme: false,
		});

		expect(getByTestId(container, 'timeline-unread-divider').textContent).toContain('未读');
		expect(getByTestId(container, 'timeline-message-message-unread').getAttribute('data-message-id')).toBe('message-unread');
	});

	it('keeps deleted tombstones inside the same visual author group continuity', () => {
		const timeline = createTimeline([
			createMessage({
				createdAt: '2026-04-07T10:00:00.000Z',
				id: 'message-1',
			}),
			createMessage({
				body: '',
				createdAt: '2026-04-07T10:01:00.000Z',
				deleted: true,
				id: 'message-2',
			}),
			createMessage({
				body: 'Follow-up after the tombstone',
				createdAt: '2026-04-07T10:02:00.000Z',
				id: 'message-3',
			}),
		]);

		const { container } = renderWithAppProviders(<TimelineView timeline={timeline} />, {
			withTheme: false,
		});

		expect(getByTestId(container, 'timeline-message-message-1').getAttribute('data-grouped-next')).toBe('true');
		expect(getByTestId(container, 'timeline-message-message-2').getAttribute('data-grouped-prev')).toBe('true');
		expect(getByTestId(container, 'timeline-message-message-3').getAttribute('data-grouped-prev')).toBe('true');
		expect(getByTestId(container, 'timeline-message-content-message-2').textContent).toContain('该消息已删除。');
	});

	it('surfaces failed-message actions through direct retry/remove buttons', () => {
		const onRetryFailedMessage = mock(() => {});
		const onRemoveFailedMessage = mock(() => {});
		const timeline = createTimeline([
			createMessage({
				id: 'message-failed',
			}),
		]);

		const { container } = renderWithAppProviders(
			<TimelineView
				failedMessageActions={{
					'message-failed': {
						errorMessage: 'Temporary upstream failure',
					},
				}}
				messageDeliveryStates={{
					'message-failed': 'failed',
				}}
				onRemoveFailedMessage={onRemoveFailedMessage}
				onRetryFailedMessage={onRetryFailedMessage}
				timeline={timeline}
			/>,
			{
				withTheme: false,
			},
		);

		fireEvent.click(getByTestId(container, 'timeline-message-retry-message-failed'));
		fireEvent.click(getByTestId(container, 'timeline-message-remove-message-failed'));

		expect(onRetryFailedMessage).toHaveBeenCalledWith('message-failed');
		expect(onRemoveFailedMessage).toHaveBeenCalledWith('message-failed');
		expect(getByTestId(container, 'timeline-message-error-message-failed').textContent).toContain('Temporary upstream failure');
	});

	it('captures reply-jump reading position and returns to it deterministically', async () => {
		const timeline = createTimeline([
			createMessage({
				body: 'Original message',
				id: 'message-target',
			}),
			createMessage({
				body: 'Reply message',
				createdAt: '2026-04-07T10:03:00.000Z',
				id: 'message-source',
				replyTo: {
					authorName: 'Alice Example',
					excerpt: 'Original message',
					long: false,
					messageId: 'message-target',
				},
			}),
		]);

		const { container } = renderWithAppProviders(<TimelineView motionPreference='disabled' timeline={timeline} />, {
			withTheme: false,
		});

		const messageStream = getByTestId(container, 'timeline');
		const targetMessage = getByTestId(container, 'timeline-message-message-target');
		const sourceMessage = getByTestId(container, 'timeline-message-message-source');

		setElementBox(messageStream, {
			clientHeight: 200,
			height: 200,
			offsetHeight: 200,
			scrollHeight: 520,
			scrollTop: 380,
			width: 640,
		});
		setElementBox(targetMessage, {
			height: 100,
			offsetHeight: 100,
			offsetTop: 0,
			top: 0,
			width: 640,
		});
		setElementBox(sourceMessage, {
			height: 100,
			offsetHeight: 100,
			offsetTop: 400,
			top: 400,
			width: 640,
		});

		fireEvent.click(getByTestId(container, 'reply-jump-message-source'));

		await waitFor(() => expect(getByTestId(container, 'timeline-return-button')).toBeTruthy());
		await waitFor(() => expect((messageStream as HTMLDivElement).scrollTop).toBe(0));

		fireEvent.click(getByTestId(container, 'timeline-return-button'));

		await waitFor(() => expect((messageStream as HTMLDivElement).scrollTop).toBe(320));
		await waitFor(() => expect(queryByTestId(container, 'timeline-return-button')).toBeNull());
	});

	it('preserves visual-media expansion when a local optimistic upload is replaced by the canonical message id', async () => {
		const baseMessage = createMessage({
			id: 'message-base',
		});
		const optimisticUpload = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-local',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: 'blob:http://127.0.0.1/local-preview',
					},
					source: {
						url: 'blob:http://127.0.0.1/local-preview',
					},
				},
			],
			body: '附上一张截图',
			id: 'room-ops-optimistic-upload',
		});
		const canonicalUpload = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-canonical',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: '/api/media/file-upload/thumb-1/upload.png',
						width: 360,
						height: 270,
					},
					source: {
						url: '/api/media/file-upload/file-1/upload.png',
					},
				},
			],
			body: '附上一张截图',
			id: 'message-canonical-upload',
		});

		const rendered = renderWithAppProviders(
			<TimelineView
				forceScrollToBottomToken={0}
				localOutgoingMessageIds={new Set<string>()}
				timeline={createTimeline([baseMessage])}
			/>,
			{
				withTheme: false,
			},
		);

		rendered.rerender(
			<TimelineView
				forceScrollToBottomToken={1}
				localOutgoingMessageIds={new Set<string>(['room-ops-optimistic-upload'])}
				timeline={createTimeline([baseMessage, optimisticUpload])}
			/>,
		);

		await waitFor(() =>
			expect(getByTestId(rendered.container, 'timeline-message-content-room-ops-optimistic-upload').getAttribute('data-collapsed')).toBe(
				'false',
			),
		);

		rendered.rerender(
			<TimelineView
				forceScrollToBottomToken={1}
				localOutgoingMessageIds={new Set<string>()}
				timeline={createTimeline([baseMessage, canonicalUpload])}
			/>,
		);

		await waitFor(() =>
			expect(getByTestId(rendered.container, 'timeline-message-content-message-canonical-upload').getAttribute('data-collapsed')).toBe(
				'false',
			),
		);
	});

	it('expands a failed image message when retry requests re-open its media surface', async () => {
		const failedImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-failed',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
					source: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
				},
			],
			body: '附上一张截图',
			id: 'message-failed-image',
		});

		const rendered = renderWithAppProviders(
			<TimelineView
				messageDeliveryStates={{
					'message-failed-image': 'failed',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
			{
				withTheme: false,
			},
		);

		expect(getByTestId(rendered.container, 'timeline-message-content-message-failed-image').getAttribute('data-collapsed')).toBe('true');

		rendered.rerender(
			<TimelineView
				expansionRequest={{
					messageId: 'message-failed-image',
					token: 1,
				}}
				messageDeliveryStates={{
					'message-failed-image': 'sending',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(getByTestId(rendered.container, 'timeline-message-content-message-failed-image').getAttribute('data-collapsed')).toBe(
				'false',
			),
		);
	});

	it('keeps a retried image expanded when the canonical message id replaces the local submission id', async () => {
		const localSubmissionId = 'room-ops-submission-image';
		const failedImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-failed',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
					source: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
				},
			],
			body: '附上一张截图',
			id: localSubmissionId,
			submissionId: localSubmissionId,
		});
		const canonicalImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-canonical',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: '/api/media/file-upload/upload-thumb.png',
					},
					source: {
						url: '/api/media/file-upload/upload.png',
					},
				},
			],
			body: '附上一张截图',
			id: 'message-canonical-image',
			submissionId: localSubmissionId,
		});

		const rendered = renderWithAppProviders(
			<TimelineView
				messageDeliveryStates={{
					[localSubmissionId]: 'failed',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
			{
				withTheme: false,
			},
		);

		rendered.rerender(
			<TimelineView
				expansionRequest={{
					messageId: localSubmissionId,
					token: 1,
				}}
				messageDeliveryStates={{
					[localSubmissionId]: 'sending',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(getByTestId(rendered.container, `timeline-message-content-${localSubmissionId}`).getAttribute('data-collapsed')).toBe(
				'false',
			),
		);

		rendered.rerender(
			<TimelineView
				timeline={createTimeline([canonicalImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(
				getByTestId(rendered.container, 'timeline-message-content-message-canonical-image').getAttribute('data-collapsed'),
			).toBe('false'),
		);
	});

	it('keeps a canonical retry image expanded when its delivery state settles from sending to sent without another id change', async () => {
		const localSubmissionId = 'room-ops-submission-image';
		const failedImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-failed',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
					source: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
				},
			],
			body: '附上一张截图',
			id: localSubmissionId,
			submissionId: localSubmissionId,
		});
		const canonicalImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-canonical',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: '/api/media/file-upload/upload-thumb.png',
					},
					source: {
						url: '/api/media/file-upload/upload.png',
					},
				},
			],
			body: '附上一张截图',
			id: 'message-canonical-image',
			submissionId: localSubmissionId,
		});

		const rendered = renderWithAppProviders(
			<TimelineView
				messageDeliveryStates={{
					[localSubmissionId]: 'failed',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
			{
				withTheme: false,
			},
		);

		rendered.rerender(
			<TimelineView
				expansionRequest={{
					messageId: localSubmissionId,
					token: 1,
				}}
				messageDeliveryStates={{
					[localSubmissionId]: 'sending',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(getByTestId(rendered.container, `timeline-message-content-${localSubmissionId}`).getAttribute('data-collapsed')).toBe(
				'false',
			),
		);

		rendered.rerender(
			<TimelineView
				localOutgoingMessageIds={new Set<string>(['message-canonical-image'])}
				messageDeliveryStates={{
					'message-canonical-image': 'sending',
				}}
				timeline={createTimeline([canonicalImageMessage])}
			/>,
		);

		rendered.rerender(
			<TimelineView
				timeline={createTimeline([canonicalImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(
				getByTestId(rendered.container, 'timeline-message-content-message-canonical-image').getAttribute('data-collapsed'),
			).toBe('false'),
		);
	});

	it('keeps a retried image expanded when the canonical row appears after a transient gap', async () => {
		const localSubmissionId = 'room-ops-submission-image';
		const failedImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-failed',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
					source: {
						url: 'blob:http://127.0.0.1/retry-preview',
					},
				},
			],
			body: '附上一张截图',
			id: localSubmissionId,
			submissionId: localSubmissionId,
		});
		const canonicalImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-canonical',
					title: 'betterchat-e2e-upload.png',
					preview: {
						url: '/api/media/file-upload/upload-thumb.png',
					},
					source: {
						url: '/api/media/file-upload/upload.png',
					},
				},
			],
			body: '附上一张截图',
			id: 'message-canonical-image',
			submissionId: localSubmissionId,
		});

		const rendered = renderWithAppProviders(
			<TimelineView
				messageDeliveryStates={{
					[localSubmissionId]: 'failed',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
			{
				withTheme: false,
			},
		);

		rendered.rerender(
			<TimelineView
				expansionRequest={{
					messageId: localSubmissionId,
					token: 1,
				}}
				messageDeliveryStates={{
					[localSubmissionId]: 'sending',
				}}
				timeline={createTimeline([failedImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(getByTestId(rendered.container, `timeline-message-content-${localSubmissionId}`).getAttribute('data-collapsed')).toBe(
				'false',
			),
		);

		rendered.rerender(<TimelineView timeline={createTimeline([])} />);
		await waitFor(() => expect(queryByTestId(rendered.container, `timeline-message-content-${localSubmissionId}`)).toBeNull());
		rendered.rerender(
			<TimelineView
				timeline={createTimeline([canonicalImageMessage])}
			/>,
		);

		await waitFor(() =>
			expect(
				getByTestId(rendered.container, 'timeline-message-content-message-canonical-image').getAttribute('data-collapsed'),
			).toBe('false'),
		);
	});
});
