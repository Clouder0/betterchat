import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { initializeDocumentMotionPreference } from './app/motionPreference';
import { initializeDocumentTheme } from './app/themeDocument';
import { ErrorBoundary } from '@/components/error/ErrorBoundary';
import { RouteErrorFallback } from '@/components/error/RouteErrorFallback';

initializeDocumentMotionPreference();
initializeDocumentTheme();

// Global error handler for the root error boundary
const handleRootError = (error: Error, errorInfo: React.ErrorInfo): void => {
	console.error('Root error boundary caught an error:', error, errorInfo);
	// Could send to error tracking service here (e.g., Sentry)
};

// Create the root error fallback component
const RootErrorFallback = ({ error, reset }: { error: Error; reset: () => void }) => (
	<RouteErrorFallback error={error} reset={reset} />
);

createRoot(document.getElementById('root') as HTMLElement).render(
	<StrictMode>
		<ErrorBoundary
			fallback={<div style={{ padding: '20px', textAlign: 'center' }}>应用加载失败</div>}
			onError={handleRootError}
		>
			<App />
		</ErrorBoundary>
	</StrictMode>,
);
