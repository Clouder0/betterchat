import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { RouteErrorFallback } from './RouteErrorFallback';
import { Window } from 'happy-dom';

describe('ErrorBoundary', () => {
	let win: Window;

	beforeEach(() => {
		win = new Window({ url: 'http://localhost:3000' });
		globalThis.window = win as unknown as Window & typeof globalThis;
		globalThis.document = win.document as unknown as Document;
		globalThis.navigator = win.navigator as unknown as Navigator;
	});

	afterEach(() => {
		delete (globalThis as { window?: unknown }).window;
		delete (globalThis as { document?: unknown }).document;
		delete (globalThis as { navigator?: unknown }).navigator;
	});

	function render(element: React.ReactElement) {
		const container = win.document.createElement('div');
		win.document.body.appendChild(container);
		const root = createRoot(container as unknown as HTMLElement);
		root.render(element);
		return { container, root };
	}

	function findByTestId(container: HTMLElement, testId: string): HTMLElement | null {
		const allElements = container.getElementsByTagName('*');
		for (const el of allElements) {
			if (el.getAttribute('data-testid') === testId) {
				return el as HTMLElement;
			}
		}
		return null;
	}

	const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
		if (shouldThrow) {
			throw new Error('Test error message');
		}
		return <div data-testid="success-content">Working normally</div>;
	};

	const ThrowDifferentError = ({ errorType }: { errorType: string }) => {
		if (errorType === 'type') {
			throw new TypeError('Type error message');
		}
		if (errorType === 'range') {
			throw new RangeError('Range error message');
		}
		return <div data-testid="success-content">Working normally</div>;
	};

	it('renders children when no error occurs', async () => {
		const { container } = render(
			<ErrorBoundary fallback={<div>Error occurred</div>}>
				<div data-testid="child-content">Hello World</div>
			</ErrorBoundary>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const content = findByTestId(container as unknown as HTMLElement, 'child-content');
		expect(content).toBeDefined();
		expect(content?.textContent).toBe('Hello World');
	});

	it('catches render errors and shows fallback UI', async () => {
		const { container } = render(
			<ErrorBoundary fallback={<div data-testid="fallback">Error occurred</div>}>
				<ThrowError shouldThrow={true} />
			</ErrorBoundary>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const fallback = findByTestId(container as unknown as HTMLElement, 'fallback');
		const successContent = findByTestId(container as unknown as HTMLElement, 'success-content');

		expect(fallback).toBeDefined();
		expect(fallback?.textContent).toBe('Error occurred');
		expect(successContent).toBeNull();
	});

	it('catches TypeError and shows fallback UI', async () => {
		const { container } = render(
			<ErrorBoundary fallback={<div data-testid="fallback">Type error caught</div>}>
				<ThrowDifferentError errorType="type" />
			</ErrorBoundary>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const fallback = findByTestId(container as unknown as HTMLElement, 'fallback');
		expect(fallback).toBeDefined();
		expect(fallback?.textContent).toBe('Type error caught');
	});

	it('catches RangeError and shows fallback UI', async () => {
		const { container } = render(
			<ErrorBoundary fallback={<div data-testid="fallback">Range error caught</div>}>
				<ThrowDifferentError errorType="range" />
			</ErrorBoundary>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const fallback = findByTestId(container as unknown as HTMLElement, 'fallback');
		expect(fallback).toBeDefined();
		expect(fallback?.textContent).toBe('Range error caught');
	});

	it('calls onError callback when error occurs', async () => {
		const onError = mock(() => {});

		render(
			<ErrorBoundary fallback={<div>Error occurred</div>} onError={onError}>
				<ThrowError shouldThrow={true} />
			</ErrorBoundary>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(onError).toHaveBeenCalled();
		const [error] = onError.mock.calls[0];
		expect(error).toBeInstanceOf(Error);
	});

	it('resets error state when resetKeys change', async () => {
		function TestComponent() {
			const [resetKey, setResetKey] = useState(0);
			const [shouldThrow, setShouldThrow] = useState(true);

			return (
				<div>
					<ErrorBoundary
						fallback={
							<div>
								<p data-testid="error-message">出错了</p>
								<button
									type="button"
									data-testid="retry-button"
									onClick={() => {
										setShouldThrow(false);
										setResetKey((k) => k + 1);
									}}
								>
									重试
								</button>
							</div>
						}
						resetKeys={[resetKey]}
					>
						<ThrowError shouldThrow={shouldThrow} />
					</ErrorBoundary>
				</div>
			);
		}

		const { container } = render(<TestComponent />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const errorMessage = findByTestId(container as unknown as HTMLElement, 'error-message');
		expect(errorMessage).toBeDefined();

		const retryButton = findByTestId(container as unknown as HTMLElement, 'retry-button');
		retryButton?.click();

		await new Promise((resolve) => setTimeout(resolve, 10));

		const successContent = findByTestId(container as unknown as HTMLElement, 'success-content');
		expect(successContent).toBeDefined();
	});
});

describe('RouteErrorFallback', () => {
	let win: Window;

	beforeEach(() => {
		win = new Window({ url: 'http://localhost:3000' });
		globalThis.window = win as unknown as Window & typeof globalThis;
		globalThis.document = win.document as unknown as Document;
		globalThis.navigator = win.navigator as unknown as Navigator;
	});

	afterEach(() => {
		delete (globalThis as { window?: unknown }).window;
		delete (globalThis as { document?: unknown }).document;
		delete (globalThis as { navigator?: unknown }).navigator;
	});

	function render(element: React.ReactElement) {
		const container = win.document.createElement('div');
		win.document.body.appendChild(container);
		const root = createRoot(container as unknown as HTMLElement);
		root.render(element);
		return { container, root };
	}

	it('renders Chinese error message', async () => {
		const mockError = new Error('Router error');
		const mockReset = mock(() => {});

		const { container } = render(<RouteErrorFallback error={mockError} reset={mockReset} />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(container.textContent).toContain('出错了');
	});

	it('displays error message', async () => {
		const mockError = new Error('Test router error');
		const mockReset = mock(() => {});

		const { container } = render(<RouteErrorFallback error={mockError} reset={mockReset} />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(container.textContent).toContain('Test router error');
	});

	it('has refresh page button', async () => {
		const mockError = new Error('Test error');
		const mockReset = mock(() => {});

		const { container } = render(<RouteErrorFallback error={mockError} reset={mockReset} />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(container.textContent).toContain('刷新页面');
	});

	it('has return home button', async () => {
		const mockError = new Error('Test error');
		const mockReset = mock(() => {});

		const { container } = render(<RouteErrorFallback error={mockError} reset={mockReset} />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(container.textContent).toContain('返回首页');
	});

	it('calls reset when refresh button clicked', async () => {
		const mockError = new Error('Test error');
		const mockReset = mock(() => {});

		const { container } = render(<RouteErrorFallback error={mockError} reset={mockReset} />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		// Find and click the refresh button
		const buttons = container.getElementsByTagName('button');
		let refreshButton: HTMLButtonElement | null = null;

		for (const button of buttons) {
			if (button.textContent?.includes('刷新页面')) {
				refreshButton = button as HTMLButtonElement;
				break;
			}
		}

		expect(refreshButton).toBeDefined();
		refreshButton?.click();

		expect(mockReset).toHaveBeenCalled();
	});

	it('navigates to home when home button clicked', async () => {
		const mockError = new Error('Test error');
		const mockReset = mock(() => {});

		const { container } = render(<RouteErrorFallback error={mockError} reset={mockReset} />);

		await new Promise((resolve) => setTimeout(resolve, 10));

		// Find and click the home button
		const buttons = container.getElementsByTagName('button');
		let homeButton: HTMLButtonElement | null = null;

		for (const button of buttons) {
			if (button.textContent?.includes('返回首页')) {
				homeButton = button as HTMLButtonElement;
				break;
			}
		}

		expect(homeButton).toBeDefined();
		homeButton?.click();

		expect(win.location.href).toBe('http://localhost:3000/');
	});
});
