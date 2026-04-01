import type { ReactNode } from 'react';

export interface RouteErrorFallbackProps {
	/** The error that was caught */
	error: Error;
	/** Function to reset the error boundary and retry rendering */
	reset: () => void;
}

/**
 * Fallback UI component for route-level errors.
 * Displays a user-friendly error message in Chinese with options to
 * refresh the page or navigate home.
 */
export function RouteErrorFallback({ error, reset }: RouteErrorFallbackProps): ReactNode {
	const handleRefresh = (): void => {
		// Reset the error boundary to retry rendering
		reset();
	};

	const handleGoHome = (): void => {
		// Navigate to home page
		window.location.href = '/';
	};

	return (
		<div
			role="alert"
			aria-live="assertive"
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '100vh',
				padding: '20px',
				textAlign: 'center',
				fontFamily: 'system-ui, -apple-system, sans-serif',
			}}
		>
			<div
				style={{
					maxWidth: '500px',
					padding: '40px',
					borderRadius: '12px',
					backgroundColor: '#fef2f2',
					border: '1px solid #fee2e2',
				}}
			>
				{/* Error icon */}
				<div
					style={{
						fontSize: '48px',
						marginBottom: '16px',
					}}
					aria-hidden="true"
				>
					⚠️
				</div>

				{/* Title - "Something went wrong" in Chinese */}
				<h1
					style={{
						fontSize: '24px',
						fontWeight: '600',
						color: '#dc2626',
						margin: '0 0 12px 0',
					}}
				>
					出错了
				</h1>

				{/* Error message */}
				<p
					style={{
						fontSize: '14px',
						color: '#7f1d1d',
						margin: '0 0 24px 0',
						wordBreak: 'break-word',
					}}
				>
					{error.message || '发生未知错误'}
				</p>

				{/* Action buttons */}
				<div
					style={{
						display: 'flex',
						gap: '12px',
						justifyContent: 'center',
						flexWrap: 'wrap',
					}}
				>
					<button
						type="button"
						onClick={handleRefresh}
						style={{
							padding: '10px 20px',
							fontSize: '14px',
							fontWeight: '500',
							color: '#ffffff',
							backgroundColor: '#dc2626',
							border: 'none',
							borderRadius: '6px',
							cursor: 'pointer',
							transition: 'background-color 0.2s',
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.backgroundColor = '#b91c1c';
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.backgroundColor = '#dc2626';
						}}
					>
						刷新页面
					</button>

					<button
						type="button"
						onClick={handleGoHome}
						style={{
							padding: '10px 20px',
							fontSize: '14px',
							fontWeight: '500',
							color: '#374151',
							backgroundColor: '#ffffff',
							border: '1px solid #d1d5db',
							borderRadius: '6px',
							cursor: 'pointer',
							transition: 'background-color 0.2s',
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.backgroundColor = '#f9fafb';
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.backgroundColor = '#ffffff';
						}}
					>
						返回首页
					</button>
				</div>
			</div>
		</div>
	);
}

export default RouteErrorFallback;
