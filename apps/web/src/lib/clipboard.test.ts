import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { copyTextToClipboard, type ClipboardResult } from './clipboard';

describe('copyTextToClipboard', () => {
	let mockWriteText: ReturnType<typeof mock>;
	let mockExecCommand: ReturnType<typeof mock>;
	let mockCreateElement: ReturnType<typeof mock>;
	let mockAppendChild: ReturnType<typeof mock>;
	let mockRemoveChild: ReturnType<typeof mock>;
	let mockSelect: ReturnType<typeof mock>;

	beforeEach(() => {
		mockWriteText = mock(() => Promise.resolve());
		mockExecCommand = mock(() => true);
		mockSelect = mock(() => {});
		mockAppendChild = mock(() => {});
		mockRemoveChild = mock(() => {});

		// Create a mock textarea element
		const mockTextarea = {
			value: '',
			setAttribute: mock(() => {}),
			style: {},
			select: mockSelect,
		};

		mockCreateElement = mock(() => mockTextarea);

		// Reset navigator.clipboard mock
		Object.defineProperty(globalThis, 'navigator', {
			value: {
				clipboard: {
					writeText: mockWriteText,
				},
			},
			writable: true,
			configurable: true,
		});

		// Mock document methods
		Object.defineProperty(globalThis, 'document', {
			value: {
				createElement: mockCreateElement,
				body: {
					appendChild: mockAppendChild,
					removeChild: mockRemoveChild,
				},
				execCommand: mockExecCommand,
			},
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		mockWriteText.mockClear();
		mockExecCommand.mockClear();
		mockCreateElement.mockClear();
		mockAppendChild.mockClear();
		mockRemoveChild.mockClear();
		mockSelect.mockClear();
	});

	describe('successful copy', () => {
		it('should return success when navigator.clipboard.writeText succeeds', async () => {
			mockWriteText.mockImplementation(() => Promise.resolve());

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({ success: true });
			expect(mockWriteText).toHaveBeenCalledWith('test text');
		});

		it('should use fallback when navigator.clipboard is not available', async () => {
			// Remove clipboard API
			Object.defineProperty(globalThis, 'navigator', {
				value: {},
				writable: true,
				configurable: true,
			});

			mockExecCommand.mockImplementation(() => true);

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({ success: true });
			expect(mockCreateElement).toHaveBeenCalledWith('textarea');
			expect(mockExecCommand).toHaveBeenCalledWith('copy');
		});
	});

	describe('permission denied error', () => {
		it('should return permission-denied error when writeText throws NotAllowedError', async () => {
			const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
			mockWriteText.mockImplementation(() => Promise.reject(notAllowedError));

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'permission-denied',
				message: '复制失败：请检查权限设置',
			});
		});

		it('should return permission-denied error when writeText throws SecurityError', async () => {
			const securityError = new DOMException('Security error', 'SecurityError');
			mockWriteText.mockImplementation(() => Promise.reject(securityError));

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
			// Remove clipboard API
			Object.defineProperty(globalThis, 'navigator', {
				value: {},
				writable: true,
				configurable: true,
			});

			// execCommand returns false (failure)
			mockExecCommand.mockImplementation(() => false);

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'write-failed',
				message: '复制失败：无法访问剪贴板',
			});
		});
	});

	describe('write failed error', () => {
		it('should return write-failed error when clipboard.writeText throws generic error', async () => {
			mockWriteText.mockImplementation(() => Promise.reject(new Error('Generic error')));

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'write-failed',
				message: '复制失败：无法访问剪贴板',
			});
		});

		it('should return write-failed error for unknown error types', async () => {
			mockWriteText.mockImplementation(() => Promise.reject('string error'));

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
			// Simulate non-secure context by removing clipboard entirely
			Object.defineProperty(globalThis, 'navigator', {
				value: {},
				writable: true,
				configurable: true,
			});

			mockExecCommand.mockImplementation(() => false);

			const result = await copyTextToClipboard('test text');

			expect(result).toEqual({
				success: false,
				error: 'write-failed',
				message: '复制失败：无法访问剪贴板',
			});
		});
	});
});
