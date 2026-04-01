/**
 * Timeout configuration for different operation types
 */
export const TIMEOUTS = {
	default: 30000, // 30s
	sidebar: 10000, // Room list
	roomDetails: 15000, // Room metadata
	timeline: 15000, // Messages
	search: 20000, // Search
	sendMessage: 30000, // Send message
	fileUpload: 120000, // File uploads (2 min)
} as const;

export type TimeoutKey = keyof typeof TIMEOUTS;

/**
 * Custom error class for timeout scenarios
 */
export class TimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super('请求超时，请稍后重试');
		this.name = 'TimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Fetch with timeout support using AbortController
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @param fetchFn - Optional fetch function (for testing)
 * @returns Response from fetch
 * @throws TimeoutError if request times out
 */
export const fetchWithTimeout = async (
	url: string,
	options: RequestInit = {},
	timeout: number = TIMEOUTS.default,
	fetchFn: typeof fetch = fetch,
): Promise<Response> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetchFn(url, {
			...options,
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		return response;
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === 'AbortError') {
			throw new TimeoutError(timeout);
		}
		throw error;
	}
};
