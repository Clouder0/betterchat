import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId, queryByTestId } from '@/test/domQueries';
import { renderWithAppProviders } from '@/test/renderWithAppProviders';

const mockRoomMentionCandidates = mock(async () => ({
	conversationId: 'room-1',
	entries: [],
	query: '',
}));

mock.module('@/lib/betterchat', () => ({
	betterChatApi: {
		roomMentionCandidates: mockRoomMentionCandidates,
	},
	betterChatQueryKeys: {
		roomMentionCandidates: (roomId: string, query: string) => ['room-mention-candidates', roomId, query] as const,
	},
}));

mock.module('./loadLiveMarkdownEditor', () => ({
	loadLiveMarkdownEditor: () => new Promise(() => {}),
	preloadLiveMarkdownEditor: () => {},
}));

const { ComposerBar } = await import('./ComposerBar');

const settleComposerDom = async (dom: TestDomHarness) => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await dom.flushAnimationFrames();
		await Promise.resolve();
	});
};

describe('ComposerBar component contracts', () => {
	let dom: TestDomHarness;
	const onSend = mock(async () => {});
	const onClearReply = mock(() => {});
	const onClearEdit = mock(() => {});
	const createObjectUrl = mock(() => 'blob:composer-selected-image');
	const revokeObjectUrl = mock(() => {});

	beforeEach(() => {
		dom = installTestDom();
		Object.defineProperty(globalThis.URL, 'createObjectURL', {
			configurable: true,
			value: createObjectUrl,
		});
		Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
			configurable: true,
			value: revokeObjectUrl,
		});

		onSend.mockClear();
		onClearReply.mockClear();
		onClearEdit.mockClear();
		createObjectUrl.mockClear();
		revokeObjectUrl.mockClear();
		mockRoomMentionCandidates.mockClear();
		mockRoomMentionCandidates.mockImplementation(async () => ({
			conversationId: 'room-1',
			entries: [],
			query: '',
		}));
	});

	const renderComposerBar = async (ui: ReactElement) => {
		const rendered = renderWithAppProviders(ui);
		await settleComposerDom(dom);
		return rendered;
	};

	afterEach(async () => {
		await settleComposerDom(dom);
		cleanup();
		await settleComposerDom(dom);
		dom.cleanup();
		mock.restore();
	});

	it('submits plain text payload and clears the fallback textarea', async () => {
		const { container } = await renderComposerBar(
			<ComposerBar
				editTarget={{
					messageId: 'message-send',
					originalText: 'Ship the fix today',
				}}
				onSend={onSend}
				sendShortcut='enter-send'
			/>,
		);

		const textarea = getByTestId(container, 'composer-textarea') as HTMLTextAreaElement;
		await waitFor(() => expect((getByTestId(container, 'composer-raw-value') as HTMLInputElement).value).toBe('Ship the fix today'));
		await act(async () => {
			fireEvent.focus(textarea);
		});
		await waitFor(() => expect(getByTestId(container, 'composer-send').getAttribute('data-ready')).toBe('true'));

		await act(async () => {
			fireEvent.click(getByTestId(container, 'composer-send'));
		});

		await waitFor(() =>
			expect(onSend).toHaveBeenCalledWith({
				imageDimensions: undefined,
				imageFile: undefined,
				text: 'Ship the fix today',
			}),
		);
		expect((getByTestId(container, 'composer-raw-value') as HTMLInputElement).value).toBe('');
		expect(textarea.value).toBe('');
	});

	it('renders reply and edit context controls and forwards cancel actions', async () => {
		const { container } = await renderComposerBar(
			<ComposerBar
				editTarget={{
					messageId: 'message-42',
					originalText: 'Original edit text',
				}}
				onClearEdit={onClearEdit}
				onClearReply={onClearReply}
				onSend={onSend}
				replyTo={{
					authorName: 'Alice Example',
					excerpt: 'Reply excerpt',
					long: false,
					messageId: 'message-41',
				}}
				sendShortcut='enter-send'
			/>,
		);

		expect(getByTestId(container, 'composer-reply-context').textContent).toContain('回复 Alice Example');
		expect(getByTestId(container, 'composer-edit-context').textContent).toContain('编辑消息');

		fireEvent.click(getByTestId(container, 'composer-reply-cancel'));
		fireEvent.click(getByTestId(container, 'composer-edit-cancel'));

		expect(onClearReply).toHaveBeenCalledTimes(1);
		expect(onClearEdit).toHaveBeenCalledTimes(1);
	});

	it('shows image preview for a selected file and removes it cleanly', async () => {
		const { container } = await renderComposerBar(<ComposerBar canUploadImages onSend={onSend} sendShortcut='enter-send' />);

		const imageInput = getByTestId(container, 'composer-image-input') as HTMLInputElement;
		const selectedFile = new File(['png-bytes'], 'diagram.png', {
			type: 'image/png',
		});

		await act(async () => {
			fireEvent.change(imageInput, {
				target: {
					files: [selectedFile],
				},
			});
		});

		await waitFor(() => expect(getByTestId(container, 'composer-image-preview')).toBeTruthy());
		expect(createObjectUrl).toHaveBeenCalledTimes(1);

		fireEvent.click(getByTestId(container, 'composer-image-remove'));

		await waitFor(() => expect(queryByTestId(container, 'composer-image-preview')).toBeNull());
		expect(revokeObjectUrl).toHaveBeenCalledWith('blob:composer-selected-image');
	});

	it('waits for selected image dimensions before sending so optimistic image layout starts stable', async () => {
		const originalImage = globalThis.Image;
		const pendingImageLoads: Array<() => void> = [];

		class DeferredImage {
			complete = false;
			height = 40;
			naturalHeight = 40;
			naturalWidth = 60;
			onerror: ((this: GlobalEventHandlers, ev: Event | string) => unknown) | null = null;
			onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
			width = 60;
			#src = '';

			get src() {
				return this.#src;
			}

			set src(nextSrc: string) {
				this.#src = nextSrc;
				pendingImageLoads.push(() => {
					this.complete = true;
					this.onload?.call(this as unknown as GlobalEventHandlers, new Event('load'));
				});
			}
		}

		Object.defineProperty(globalThis, 'Image', {
			configurable: true,
			value: DeferredImage,
		});

		try {
			const { container } = await renderComposerBar(<ComposerBar canUploadImages onSend={onSend} sendShortcut='enter-send' />);

			const imageInput = getByTestId(container, 'composer-image-input') as HTMLInputElement;
			const textarea = getByTestId(container, 'composer-textarea') as HTMLTextAreaElement;
			const selectedFile = new File(['png-bytes'], 'diagram.png', {
				type: 'image/png',
			});

			await act(async () => {
				fireEvent.change(imageInput, {
					target: {
						files: [selectedFile],
					},
				});
			});

			await waitFor(() => expect(getByTestId(container, 'composer-image-preview')).toBeTruthy());

			await act(async () => {
				fireEvent.change(textarea, {
					target: {
						value: '附上一张截图',
					},
				});
			});

			await act(async () => {
				fireEvent.click(getByTestId(container, 'composer-send'));
			});

			expect(onSend).not.toHaveBeenCalled();

			await act(async () => {
				pendingImageLoads.splice(0).forEach((resolveLoad) => resolveLoad());
				await Promise.resolve();
			});

			await waitFor(() =>
				expect(onSend).toHaveBeenCalledWith({
					imageDimensions: {
						height: 40,
						width: 60,
					},
					imageFile: selectedFile,
					text: '附上一张截图',
				}),
			);
		} finally {
			Object.defineProperty(globalThis, 'Image', {
				configurable: true,
				value: originalImage,
			});
		}
	});

	it('opens mention candidates and inserts the selected mention into the raw composer value', async () => {
		mockRoomMentionCandidates.mockImplementation(async (_roomId: string, options: { query?: string }) => ({
			conversationId: 'room-1',
			entries: [
				{
					insertText: '@alice',
					kind: 'user',
					user: {
						displayName: 'Alice Example',
						id: 'user-alice',
						username: 'alice',
					},
				},
			],
			query: options.query ?? '',
		}));

		const { container } = await renderComposerBar(
			<ComposerBar
				editTarget={{
					messageId: 'message-mention',
					originalText: '@ali',
				}}
				onSend={onSend}
				roomId='room-1'
				sendShortcut='enter-send'
			/>,
		);

		const textarea = getByTestId(container, 'composer-textarea') as HTMLTextAreaElement;
		await waitFor(() => expect((getByTestId(container, 'composer-raw-value') as HTMLInputElement).value).toBe('@ali'));
		await act(async () => {
			fireEvent.focus(textarea);
		});
		textarea.setSelectionRange(4, 4);
		fireEvent.select(textarea);

		await waitFor(() => expect(mockRoomMentionCandidates).toHaveBeenCalled());
		await waitFor(() => expect(getByTestId(container, 'composer-mention-menu')).toBeTruthy());

		await act(async () => {
			fireEvent.mouseDown(getByTestId(container, 'composer-mention-option-user-alice'));
		});

		await waitFor(() => expect((getByTestId(container, 'composer-raw-value') as HTMLInputElement).value).toBe('@alice '));
	});
});
