import { describe, expect, it, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
	let writeTextSpy: ReturnType<typeof spyOn>;
	let savedClipboard: Clipboard | undefined;

	beforeEach(() => {
		savedClipboard = navigator.clipboard;

		if (!navigator.clipboard) {
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: () => Promise.resolve() },
				configurable: true,
				writable: true,
			});
		}
		writeTextSpy = spyOn(navigator.clipboard, 'writeText').mockImplementation(() => Promise.resolve());
	});

	afterEach(() => {
		writeTextSpy.mockRestore();
		Object.defineProperty(navigator, 'clipboard', {
			value: savedClipboard,
			configurable: true,
			writable: true,
		});
	});

	const removeClipboard = () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: undefined,
			configurable: true,
			writable: true,
		});
	};

	/** Set up a mock document for the execCommand fallback path. */
	const withMockDocument = async (execCommandResult: boolean, fn: () => Promise<void>) => {
		const savedDocument = globalThis.document;
		const mockExecCommand = mock(() => execCommandResult);
		const mockTextarea = {
			value: '',
			setAttribute: mock(() => {}),
			style: {} as CSSStyleDeclaration,
			select: mock(() => {}),
		};
		// @ts-ignore — replacing globalThis.document with a minimal mock
		globalThis.document = {
			createElement: mock(() => mockTextarea),
			body: {
				appendChild: mock(() => {}),
				removeChild: mock(() => {}),
			},
			execCommand: mockExecCommand,
		};
		try {
			await fn();
		} finally {
			globalThis.document = savedDocument;
		}
		return { mockExecCommand };
	};

	describe('successful copy', () => {
		it('should return success when navigator.clipboard.writeText succeeds', async () => {
			writeTextSpy.mockImplementation(() => Promise.resolve());

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({ success: true });
			expect(writeTextSpy).toHaveBeenCalledWith('test text');
		});

		it('should use fallback when navigator.clipboard is not available', async () => {
			removeClipboard();

			const { mockExecCommand } = await withMockDocument(true, async () => {
				const result = await copyTextToClipboard('test text');
				expect(result).toEqual({ success: true });
			});
			expect(mockExecCommand).toHaveBeenCalledWith('copy');
		});
	});

	describe('permission denied error', () => {
		it('should return permission-denied error when writeText throws NotAllowedError', async () => {
			const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
			writeTextSpy.mockImplementation(() => Promise.reject(notAllowedError));

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'permission-denied',
				message: '复制失败：请检查权限设置',
			});
		});

		it('should return permission-denied error when writeText throws SecurityError', async () => {
			const securityError = new DOMException('Security error', 'SecurityError');
			writeTextSpy.mockImplementation(() => Promise.reject(securityError));

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'permission-denied',
				message: '复制失败：请检查权限设置',
			});
		});
	});

	describe('clipboard not supported', () => {
		it('should return write-failed error when both clipboard API and execCommand fail', async () => {
			removeClipboard();

			await withMockDocument(false, async () => {
				const result = await copyTextToClipboard('test text');
				expect(result).toEqual({
					success: false,
					error: 'write-failed',
					message: '复制失败：无法访问剪贴板',
				});
			});
		});
	});

	describe('write failed error', () => {
		it('should return write-failed error when clipboard.writeText throws generic error', async () => {
			writeTextSpy.mockImplementation(() => Promise.reject(new Error('Generic error')));

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'write-failed',
				message: '复制失败：无法访问剪贴板',
			});
		});

		it('should return write-failed error for unknown error types', async () => {
			writeTextSpy.mockImplementation(() => Promise.reject('string error'));

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'write-failed',
				message: '复制失败：无法访问剪贴板',
			});
		});
	});

	describe('non-secure context (HTTP)', () => {
		it('should return write-failed error when in non-secure context', async () => {
			removeClipboard();

			await withMockDocument(false, async () => {
				const result = await copyTextToClipboard('test text');
				expect(result).toEqual({
					success: false,
					error: 'write-failed',
					message: '复制失败：无法访问剪贴板',
				});
			});
		});
	});
});
