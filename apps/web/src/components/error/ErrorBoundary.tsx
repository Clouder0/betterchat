import { Component, type ReactNode, type ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
	children: ReactNode;
	fallback: ReactNode;
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
	resetKeys?: Array<string | number>;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error Boundary component that catches JavaScript errors anywhere in its child component tree,
 * logs those errors, and displays a fallback UI instead of crashing the whole app.
 *
 * Must be a class component as React error boundaries require getDerivedStateFromError
 * and componentDidCatch lifecycle methods which are only available in class components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	private lastError: Error | null = null;
	private originalResetKeys: Array<string | number> = [];

	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
		};
		this.originalResetKeys = props.resetKeys ?? [];
	}

	/**
	 * Update state so the next render will show the fallback UI.
	 * This is called during the render phase, so side effects are not permitted.
	 */
	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return {
			hasError: true,
			error,
		};
	}

	/**
	 * Check if resetKeys have changed to trigger a reset.
	 * This lifecycle is called after render but before componentDidUpdate.
	 */
	componentDidUpdate(prevProps: ErrorBoundaryProps) {
		const { hasError } = this.state;
		const { resetKeys } = this.props;

		if (hasError && resetKeys !== undefined && prevProps.resetKeys !== resetKeys) {
			// Check if any resetKey has changed
			const hasResetKeyChanged =
				prevProps.resetKeys?.length !== resetKeys.length ||
				prevProps.resetKeys?.some((key, index) => key !== resetKeys[index]);

			if (hasResetKeyChanged) {
				this.resetErrorBoundary();
			}
		}
	}

	/**
	 * Reset the error boundary to its initial state.
	 * This allows children to re-render without errors.
	 */
	resetErrorBoundary = (): void => {
		this.lastError = null;
		this.setState({
			hasError: false,
			error: null,
		});
	};

	/**
	 * Log error information and call the onError callback.
	 * This is called during the commit phase, so side effects are permitted.
	 */
	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		// Prevent duplicate error logging for the same error
		if (this.lastError === error) {
			return;
		}
		this.lastError = error;

		// Log to console for debugging
		console.error('ErrorBoundary caught an error:', error, errorInfo);

		// Call optional error callback
		if (this.props.onError) {
			this.props.onError(error, errorInfo);
		}
	}

	render(): ReactNode {
		const { hasError } = this.state;
		const { children, fallback } = this.props;

		if (hasError) {
			return fallback;
		}

		return children;
	}
}

export default ErrorBoundary;
