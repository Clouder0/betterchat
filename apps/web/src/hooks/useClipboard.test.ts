import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useClipboard } from './useClipboard';
import type { ClipboardResult } from '@/lib/clipboard';

// Mock the clipboard module
const mockCopyTextToClipboard = mock(() => Promise.resolve({ success: true } as ClipboardResult));

mock.module('@/lib/clipboard', () => ({
	copyTextToClipboard: mockCopyTextToClipboard,
}));

describe('useClipboard', () => {
	beforeEach(() => {
		mockCopyTextToClipboard.mockClear();
	});

	describe('initial state', () => {
		it('should have idle state initially', () => {
			const { result } = renderHook(() => useClipboard());

			expect(result.current.state).toBe('idle');
			expect(result.current.error).toBeNull();
		});
	});

	describe('successful copy', () => {
		it('should set state to copied after successful copy', async () => {
			mockCopyTextToClipboard.mockImplementation(() =>
				Promise.resolve({ success: true } as ClipboardResult),
			);

			const { result } = renderHook(() => useClipboard());

			await act(async () => {
				await result.current.copy('test text');
			});

			expect(result.current.state).toBe('copied');
			expect(result.current.error).toBeNull();
		});

		it('should reset to idle after specified timeout', async () => {
			mockCopyTextToClipboard.mockImplementation(() =>
				Promise.resolve({ success: true } as ClipboardResult),
			);

			const { result } = renderHook(() => useClipboard({ resetAfter: 100 }));

			await act(async () => {
				await result.current.copy('test text');
			});

			expect(result.current.state).toBe('copied');

			// Wait for reset
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 150));
			});

			expect(result.current.state).toBe('idle');
		});
	});

	describe('error handling', () => {
		it('should set state to error on permission denied', async () => {
			mockCopyTextToClipboard.mockImplementation(() =>
				Promise.resolve({
					success: false,
					error: 'permission-denied',
					message: '复制失败：请检查权限设置',
				} as ClipboardResult),
			);

			const { result } = renderHook(() => useClipboard());

			await act(async () => {
				await result.current.copy('test text');
			});

			expect(result.current.state).toBe('error');
			expect(result.current.error).toBe('复制失败：请检查权限设置');
		});

		it('should set state to error on write failed', async () => {
			mockCopyTextToClipboard.mockImplementation(() =>
				Promise.resolve({
					success: false,
					error: 'write-failed',
					message: '复制失败：无法访问剪贴板',
				} as ClipboardResult),
			);

			const { result } = renderHook(() => useClipboard());

			await act(async () => {
				await result.current.copy('test text');
			});

			expect(result.current.state).toBe('error');
			expect(result.current.error).toBe('复制失败：无法访问剪贴板');
		});

		it('should reset error state after specified timeout', async () => {
			mockCopyTextToClipboard.mockImplementation(() =>
				Promise.resolve({
					success: false,
					error: 'permission-denied',
					message: '复制失败：请检查权限设置',
				} as ClipboardResult),
			);

			const { result } = renderHook(() => useClipboard({ resetAfter: 100 }));

			await act(async () => {
				await result.current.copy('test text');
			});

			expect(result.current.state).toBe('error');
			expect(result.current.error).toBe('复制失败：请检查权限设置');

			// Wait for reset
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 150));
			});

			expect(result.current.state).toBe('idle');
			expect(result.current.error).toBeNull();
		});
	});

	describe('manual reset', () => {
		it('should allow manual reset to idle', async () => {
			mockCopyTextToClipboard.mockImplementation(() =>
				Promise.resolve({ success: true } as ClipboardResult),
			);

			const { result } = renderHook(() => useClipboard({ resetAfter: 5000 }));

			await act(async () => {
				await result.current.copy('test text');
			});

			expect(result.current.state).toBe('copied');

			act(() => {
				result.current.reset();
			});

			expect(result.current.state).toBe('idle');
			expect(result.current.error).toBeNull();
		});
	});
});
