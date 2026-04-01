import { beforeEach, describe, expect, it, jest } from 'bun:test';

import { BetterChatApiError } from './betterchat';
import {
	categorizeError,
	createMutationErrorHandler,
	getErrorMessage,
	MutationErrorCategory,
} from './mutationErrorHandler';

describe('mutationErrorHandler', () => {
	describe('categorizeError', () => {
		it('should categorize network errors', () => {
			const networkError = new TypeError('Failed to fetch');
			const result = categorizeError(networkError);
			expect(result).toBe('network');
		});

		it('should categorize auth errors from UNAUTHENTICATED code', () => {
			const authError = new BetterChatApiError('UNAUTHENTICATED', 'Not authenticated');
			const result = categorizeError(authError);
			expect(result).toBe('auth');
		});

		it('should categorize server errors from UPSTREAM_UNAVAILABLE code', () => {
			const serverError = new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'Service unavailable');
			const result = categorizeError(serverError);
			expect(result).toBe('server');
		});

		it('should categorize server errors from UPSTREAM_REJECTED code', () => {
			const serverError = new BetterChatApiError('UPSTREAM_REJECTED', 'Service rejected');
			const result = categorizeError(serverError);
			expect(result).toBe('server');
		});

		it('should categorize validation errors from VALIDATION_ERROR code', () => {
			const validationError = new BetterChatApiError('VALIDATION_ERROR', 'Invalid input');
			const result = categorizeError(validationError);
			expect(result).toBe('validation');
		});

		it('should categorize unknown errors for unrecognized error types', () => {
			const unknownError = new Error('Some random error');
			const result = categorizeError(unknownError);
			expect(result).toBe('unknown');
		});

		it('should categorize unknown errors for NOT_FOUND code', () => {
			const notFoundError = new BetterChatApiError('NOT_FOUND', 'Not found');
			const result = categorizeError(notFoundError);
			expect(result).toBe('unknown');
		});

		it('should categorize unknown errors for UNSUPPORTED_UPSTREAM_BEHAVIOR code', () => {
			const unsupportedError = new BetterChatApiError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Unsupported');
			const result = categorizeError(unsupportedError);
			expect(result).toBe('unknown');
		});

		it('should categorize unknown errors for null/undefined', () => {
			expect(categorizeError(null)).toBe('unknown');
			expect(categorizeError(undefined)).toBe('unknown');
		});
	});

	describe('getErrorMessage', () => {
		it('should return network error message', () => {
			const message = getErrorMessage('network');
			expect(message).toBe('网络连接失败，请检查网络后重试');
		});

		it('should return auth error message', () => {
			const message = getErrorMessage('auth');
			expect(message).toBe('登录已过期，请重新登录');
		});

		it('should return server error message', () => {
			const message = getErrorMessage('server');
			expect(message).toBe('服务器繁忙，请稍后重试');
		});

		it('should return validation error message', () => {
			const message = getErrorMessage('validation');
			expect(message).toBe('请求参数有误，请检查后重试');
		});

		it('should return unknown error message', () => {
			const message = getErrorMessage('unknown');
			expect(message).toBe('操作失败，请重试');
		});

		it('should return unknown message for unhandled category', () => {
			const message = getErrorMessage('unhandled' as MutationErrorCategory);
			expect(message).toBe('操作失败，请重试');
		});
	});

	describe('createMutationErrorHandler', () => {
		const mockShowToast = jest.fn();
		const mockInvalidateQueries = jest.fn();
		const mockQueryClient = {
			invalidateQueries: mockInvalidateQueries,
		} as unknown as Parameters<typeof createMutationErrorHandler>[0]['queryClient'];

		beforeEach(() => {
			mockShowToast.mockClear();
			mockInvalidateQueries.mockClear();
			mockInvalidateQueries.mockResolvedValue(undefined);
		});

		it('should show toast with error message on mutation error', () => {
			const handler = createMutationErrorHandler({
				showToast: mockShowToast,
				queryClient: mockQueryClient,
			});

			const error = new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'Server error');
			handler.onError(error, { favorite: true, targetRoomId: 'room-1' }, undefined);

			expect(mockShowToast).toHaveBeenCalledWith({
				message: '服务器繁忙，请稍后重试',
				type: 'error',
			});
		});

		it('should restore previous state on error with context', () => {
			const restoreState = jest.fn();
			const previousState = { favorite: false };

			const handler = createMutationErrorHandler<{ favorite: boolean; targetRoomId: string }, typeof previousState>({
				showToast: mockShowToast,
				queryClient: mockQueryClient,
				restoreState,
			});

			const error = new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'Network failed');
			handler.onError(error, { favorite: true, targetRoomId: 'room-1' }, previousState);

			expect(restoreState).toHaveBeenCalledWith(previousState);
		});

		it('should not restore state if no context provided', () => {
			const restoreState = jest.fn();

			const handler = createMutationErrorHandler<unknown, unknown>({
				showToast: mockShowToast,
				queryClient: mockQueryClient,
				restoreState,
			});

			const error = new BetterChatApiError('UPSTREAM_UNAVAILABLE', 'Server error');
			handler.onError(error, undefined, undefined);

			expect(restoreState).not.toHaveBeenCalled();
		});

		it('should handle errors for different error categories', () => {
			const handler = createMutationErrorHandler({
				showToast: mockShowToast,
				queryClient: mockQueryClient,
			});

			const testCases = [
				{ error: new TypeError('Failed to fetch'), expectedMessage: '网络连接失败，请检查网络后重试' },
				{ error: new BetterChatApiError('UNAUTHENTICATED', 'Auth failed'), expectedMessage: '登录已过期，请重新登录' },
				{ error: new BetterChatApiError('VALIDATION_ERROR', 'Invalid'), expectedMessage: '请求参数有误，请检查后重试' },
				{ error: new Error('Unknown'), expectedMessage: '操作失败，请重试' },
			];

			testCases.forEach(({ error, expectedMessage }) => {
				mockShowToast.mockClear();
				handler.onError(error, { favorite: true, targetRoomId: 'room-1' }, undefined);
				expect(mockShowToast).toHaveBeenCalledWith({
					message: expectedMessage,
					type: 'error',
				});
			});
		});
	});
});
