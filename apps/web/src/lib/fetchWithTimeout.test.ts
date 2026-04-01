import { describe, expect, test, vi } from 'vitest';
import { fetchWithTimeout, TimeoutError, TIMEOUTS } from './fetchWithTimeout';

describe('fetchWithTimeout', () => {
	describe('TimeoutError', () => {
		test('should create TimeoutError with correct message', () => {
			const error = new TimeoutError(5000);
			expect(error.name).toBe('TimeoutError');
			expect(error.message).toBe('请求超时，请稍后重试');
			expect(error.timeoutMs).toBe(5000);
		});
	});

	describe('timeout constants', () => {
		test('should have correct timeout values for all operation types', () => {
			expect(TIMEOUTS.default).toBe(30000);
			expect(TIMEOUTS.sidebar).toBe(10000);
			expect(TIMEOUTS.roomDetails).toBe(15000);
			expect(TIMEOUTS.timeline).toBe(15000);
			expect(TIMEOUTS.search).toBe(20000);
			expect(TIMEOUTS.sendMessage).toBe(30000);
			expect(TIMEOUTS.fileUpload).toBe(120000);
		});
	});

	describe('request aborts after timeout', () => {
		test('should abort request and throw TimeoutError when request exceeds timeout', async () => {
			// Create an AbortController to simulate the timeout behavior
			const controller = new AbortController();

			// Mock fetch that checks the signal and throws AbortError when aborted
			const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
				return new Promise((_resolve, reject) => {
					if (options.signal?.aborted) {
						const error = new Error('The operation was aborted');
						error.name = 'AbortError';
						reject(error);
						return;
					}

					options.signal?.addEventListener('abort', () => {
						const error = new Error('The operation was aborted');
						error.name = 'AbortError';
						reject(error);
					});
				});
			});

			// Start the request
			const requestPromise = fetchWithTimeout('https://example.com', {}, 50, mockFetch);

			// Manually trigger the timeout by aborting
			setTimeout(() => controller.abort(), 10);

			await expect(requestPromise).rejects.toThrow(TimeoutError);
		});

		test('should throw TimeoutError with localized message', async () => {
			const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
				return new Promise((_resolve, reject) => {
					if (options.signal?.aborted) {
						const error = new Error('The operation was aborted');
						error.name = 'AbortError';
						reject(error);
						return;
					}

					options.signal?.addEventListener('abort', () => {
						const error = new Error('The operation was aborted');
						error.name = 'AbortError';
						reject(error);
					});
				});
			});

			try {
				await fetchWithTimeout('https://example.com', {}, 50, mockFetch);
				expect.fail('Should have thrown TimeoutError');
			} catch (error) {
				expect(error).toBeInstanceOf(TimeoutError);
				expect((error as TimeoutError).message).toBe('请求超时，请稍后重试');
			}
		});
	});

	describe('AbortError handling', () => {
		test('should throw TimeoutError when AbortError is received', async () => {
			const abortError = new Error('The operation was aborted');
			abortError.name = 'AbortError';

			const mockFetch = vi.fn().mockRejectedValue(abortError);

			await expect(fetchWithTimeout('https://example.com', {}, 100, mockFetch)).rejects.toThrow(
				TimeoutError,
			);
		});

		test('should preserve original error name as TimeoutError', async () => {
			const abortError = new Error('The operation was aborted');
			abortError.name = 'AbortError';

			const mockFetch = vi.fn().mockRejectedValue(abortError);

			try {
				await fetchWithTimeout('https://example.com', {}, 100, mockFetch);
				expect.fail('Should have thrown TimeoutError');
			} catch (error) {
				expect((error as Error).name).toBe('TimeoutError');
			}
		});
	});

	describe('slow network simulation', () => {
		test('should handle slow network that completes within timeout', async () => {
			const mockResponse = new Response('{}', { status: 200 });

			const mockFetch = vi.fn().mockImplementation(() => {
				return new Promise((resolve) => {
					setTimeout(() => resolve(mockResponse), 30);
				});
			});

			const result = await fetchWithTimeout('https://example.com', {}, 100, mockFetch);
			expect(result).toBe(mockResponse);
		});

		test('should timeout when network is too slow', async () => {
			const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
				return new Promise((_resolve, reject) => {
					// Check if already aborted
					if (options.signal?.aborted) {
						const error = new Error('The operation was aborted');
						error.name = 'AbortError';
						reject(error);
						return;
					}

					// Set up abort listener
					const timeoutId = setTimeout(() => {
						resolve(new Response('{}'));
					}, 200);

					options.signal?.addEventListener('abort', () => {
						clearTimeout(timeoutId);
						const error = new Error('The operation was aborted');
						error.name = 'AbortError';
						reject(error);
					});
				});
			});

			await expect(fetchWithTimeout('https://example.com', {}, 50, mockFetch)).rejects.toThrow(
				TimeoutError,
			);
		});
	});

	describe('cleanup and memory leaks', () => {
		test('should clear timeout when request completes successfully', async () => {
			const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
			const mockResponse = new Response('{}', { status: 200 });

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);

			await fetchWithTimeout('https://example.com', {}, 5000, mockFetch);
			expect(clearTimeoutSpy).toHaveBeenCalled();

			clearTimeoutSpy.mockRestore();
		});

		test('should clear timeout when request fails with non-AbortError', async () => {
			const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
			const networkError = new Error('Network error');

			const mockFetch = vi.fn().mockRejectedValue(networkError);

			await expect(fetchWithTimeout('https://example.com', {}, 5000, mockFetch)).rejects.toThrow(
				networkError,
			);
			expect(clearTimeoutSpy).toHaveBeenCalled();

			clearTimeoutSpy.mockRestore();
		});
	});

	describe('passes through options correctly', () => {
		test('should pass url, options, and signal to fetch', async () => {
			const mockResponse = new Response('{}', { status: 200 });
			const mockFetch = vi.fn().mockResolvedValue(mockResponse);

			const options = {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ test: true }),
			};

			await fetchWithTimeout('https://example.com', options, 5000, mockFetch);

			expect(mockFetch).toHaveBeenCalledWith(
				'https://example.com',
				expect.objectContaining({
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ test: true }),
					signal: expect.any(AbortSignal),
				}),
			);
		});
	});
});
