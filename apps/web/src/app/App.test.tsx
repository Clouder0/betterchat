import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId } from '@/test/domQueries';

let dom: TestDomHarness;
let appImportNonce = 0;

const suspendedAppShell = new Promise<never>(() => {});

const settleAppDom = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

const loadApp = async () => {
	mock.restore();
	mock.module('@/features/app-shell/AppShell', () => ({
		AppShell: () => {
			throw suspendedAppShell;
		},
	}));

	const module = await import(`./App.tsx?app-test=${appImportNonce++}`);
	return module.App as typeof import('./App').App;
};

describe('App route loading states', () => {
	beforeEach(() => {
		dom = installTestDom({
			url: 'http://localhost:3300/app',
		});
	});

	afterEach(async () => {
		await settleAppDom();
		cleanup();
		await settleAppDom();
		dom.cleanup();
		mock.restore();
	});

	it('renders a non-blank fallback while the app shell route is still loading', async () => {
		const App = await loadApp();
		const { container } = render(<App />);

		await waitFor(() => expect(getByTestId(container, 'app-shell-route-fallback')).toBeTruthy());

		const fallback = getByTestId(container, 'app-shell-route-fallback');
		expect(fallback.getAttribute('aria-busy')).toBe('true');
		expect(fallback.getAttribute('aria-label')).toBe('正在加载工作区');
	});
});
