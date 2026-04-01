import { BetterChatApiError } from './betterchat';

export type MutationErrorCategory = 'network' | 'auth' | 'server' | 'validation' | 'unknown';

const errorMessages: Record<MutationErrorCategory, string> = {
	network: '网络连接失败，请检查网络后重试',
	auth: '登录已过期，请重新登录',
	server: '服务器繁忙，请稍后重试',
	validation: '请求参数有误，请检查后重试',
	unknown: '操作失败，请重试',
};

export function categorizeError(error: unknown): MutationErrorCategory {
	// Handle network errors
	if (error instanceof TypeError) {
		return 'network';
	}

	// Handle BetterChatApiError with specific codes
	if (error instanceof BetterChatApiError) {
		switch (error.code) {
			case 'UNAUTHENTICATED':
				return 'auth';
			case 'UPSTREAM_UNAVAILABLE':
			case 'UPSTREAM_REJECTED':
				return 'server';
			case 'VALIDATION_ERROR':
				return 'validation';
			case 'NOT_FOUND':
			case 'UNSUPPORTED_UPSTREAM_BEHAVIOR':
			default:
				return 'unknown';
		}
	}

	// Handle null/undefined
	if (error === null || error === undefined) {
		return 'unknown';
	}

	return 'unknown';
}

export function getErrorMessage(category: MutationErrorCategory): string {
	return errorMessages[category] ?? errorMessages.unknown;
}

export interface ToastOptions {
	message: string;
	type: 'error' | 'success' | 'info';
}

export interface QueryClient {
	invalidateQueries: (options: { queryKey: unknown[] }) => Promise<void>;
}

export interface MutationErrorHandlerOptions<TVariables, TContext = unknown> {
	showToast: (options: ToastOptions) => void;
	queryClient: QueryClient;
	queryKeys?: unknown[][];
	restoreState?: (context: TContext) => void;
}

export interface MutationErrorHandler<TVariables, TContext = unknown> {
	onError: (error: unknown, variables: TVariables, context: TContext | undefined) => void;
}

export function createMutationErrorHandler<TVariables, TContext = unknown>(
	options: MutationErrorHandlerOptions<TVariables, TContext>,
): MutationErrorHandler<TVariables, TContext> {
	const { showToast, queryClient, queryKeys, restoreState } = options;

	return {
		onError: (error: unknown, variables: TVariables, context: TContext | undefined): void => {
			const category = categorizeError(error);
			const message = getErrorMessage(category);
			showToast({ message, type: 'error' });

			// Restore previous state if rollback is configured
			if (restoreState && context !== undefined) {
				restoreState(context);
			}
		},
	};
}
