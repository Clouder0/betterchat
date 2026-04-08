import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';

import type { PublicBootstrap } from '@betterchat/contracts';
import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId } from '@/test/domQueries';
import { renderWithAppProviders } from '@/test/renderWithAppProviders';

const mockNavigate = mock(async () => {});
const mockLogin = mock(async () => ({
	user: {
		displayName: 'Alice Example',
		id: 'user-alice',
		username: 'alice',
	},
}));
const mockPublicBootstrap = mock(async (): Promise<PublicBootstrap> => publicBootstrapState);
const mockWorkspace = mock(async () => {
	throw new Error('workspace should not be queried from LoginPage');
});

let dom: TestDomHarness;
let loginPageImportNonce = 0;
let mockedApiMode: 'fixture' | 'real' = 'real';
let publicBootstrapState: PublicBootstrap;

const createPublicBootstrap = (authenticated = false): PublicBootstrap => ({
	features: {
		registerEnabled: false,
	},
	login: {
		passwordEnabled: true,
		registeredProviders: [],
	},
	server: {
		siteName: 'Test Workspace',
		version: '7.6.0',
	},
	session: {
		authenticated,
	},
});

const settleLoginPageDom = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

const loadLoginPage = async () => {
	mock.restore();
	mock.module('@tanstack/react-router', () => ({
		useNavigate: () => mockNavigate,
	}));

	mock.module('@/lib/betterchat', () => ({
		betterChatApi: {
			login: mockLogin,
			mode: mockedApiMode,
			publicBootstrap: mockPublicBootstrap,
			workspace: mockWorkspace,
		},
		betterChatQueryKeys: {
			publicBootstrap: ['public-bootstrap'] as const,
			roomList: ['room-list'] as const,
			workspace: ['workspace'] as const,
		},
		isBetterChatApiError: (error: unknown): error is { code: string; message: string } =>
			typeof error === 'object'
			&& error !== null
			&& 'code' in error
			&& typeof (error as { code?: unknown }).code === 'string'
			&& 'message' in error
			&& typeof (error as { message?: unknown }).message === 'string',
	}));

	const module = await import(`./LoginPage.tsx?login-page-test=${loginPageImportNonce++}`);
	return module.LoginPage;
};

describe('LoginPage contracts', () => {
	beforeEach(() => {
		dom = installTestDom();
		mockedApiMode = 'real';
		publicBootstrapState = createPublicBootstrap(false);

		mockNavigate.mockClear();
		mockLogin.mockClear();
		mockPublicBootstrap.mockClear();
		mockWorkspace.mockClear();

		mockPublicBootstrap.mockImplementation(async () => publicBootstrapState);
		mockLogin.mockImplementation(async () => ({
			user: {
				displayName: 'Alice Example',
				id: 'user-alice',
				username: 'alice',
			},
		}));
		mockWorkspace.mockImplementation(async () => {
			throw new Error('workspace should not be queried from LoginPage');
		});
	});

	afterEach(async () => {
		await settleLoginPageDom();
		cleanup();
		await settleLoginPageDom();
		dom.cleanup();
		mock.restore();
	});

	const renderLoginPage = async () => {
		const LoginPage = await loadLoginPage();
		const rendered = renderWithAppProviders(<LoginPage />);
		await settleLoginPageDom();
		return rendered;
	};

	it('renders the anonymous login path from public bootstrap without probing workspace', async () => {
		const { container } = await renderLoginPage();

		await waitFor(() => expect(mockPublicBootstrap).toHaveBeenCalledTimes(1));

		expect(getByTestId(container, 'login-page')).toBeTruthy();
		expect(mockWorkspace).not.toHaveBeenCalled();
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it('redirects authenticated bootstrap sessions directly into the app shell', async () => {
		publicBootstrapState = createPublicBootstrap(true);

		const { container } = await renderLoginPage();

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith({
				replace: true,
				to: '/app',
			}),
		);
		expect(getByTestId(container, 'login-page')).toBeTruthy();
		expect(mockWorkspace).not.toHaveBeenCalled();
	});

	it('keeps the login error surface accessible when bootstrap fails', async () => {
		mockPublicBootstrap.mockImplementation(async () => {
			throw {
				code: 'UPSTREAM_UNAVAILABLE',
				message: 'Server connection failed',
			};
		});

		const { container } = await renderLoginPage();

		await waitFor(() => expect(getByTestId(container, 'login-error').textContent).toContain('Server connection failed'));

		const errorMessage = getByTestId(container, 'login-error');
		expect(errorMessage.getAttribute('role')).toBe('alert');
		expect(errorMessage.getAttribute('aria-live')).toBe('assertive');
	});

	it('submits credentials and navigates without relying on workspace bootstrap failures', async () => {
		mockedApiMode = 'fixture';
		const { container } = await renderLoginPage();

		await act(async () => {
			fireEvent.submit(getByTestId(container, 'login-form'));
		});

		await waitFor(() =>
			expect(mockLogin).toHaveBeenCalledWith({
				code: undefined,
				login: 'linche',
				password: 'demo',
			}),
		);
		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith({
				replace: true,
				to: '/app',
			}),
		);
		expect(mockWorkspace).not.toHaveBeenCalled();
	});
});
