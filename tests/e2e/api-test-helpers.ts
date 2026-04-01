import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import { waitForRoomLoadingToFinish } from './test-helpers';

type SeedManifest = {
	messages: Record<
		string,
		{
			messageId?: string;
			roomKey: string;
			text?: string;
		}
	>;
	rooms: Record<
		string,
		{
			roomId: string;
			title: string;
		}
	>;
	users: Record<
		string,
		{
			displayName: string;
			username: string;
		}
	>;
};

type BetterChatSession = {
	cookieHeader: string;
};

const seedManifestPath = process.env.BETTERCHAT_TEST_SEED_MANIFEST_PATH ?? '/tmp/betterchat-seed-manifest.json';

export const apiModeEnabled = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';
export const betterChatApiBaseUrl = process.env.BETTERCHAT_E2E_API_BASE_URL ?? 'http://127.0.0.1:3200';

const unwrapApiEnvelope = async <T,>(response: Response): Promise<T> => {
	const payload = (await response.json()) as { data?: T; error?: { message?: string }; ok?: boolean };
	if (!response.ok || !payload.ok || payload.data === undefined) {
		throw new Error(payload.error?.message ?? `Unexpected BetterChat response: ${response.status}`);
	}

	return payload.data;
};

export const readSeedManifest = (): SeedManifest => JSON.parse(readFileSync(seedManifestPath, 'utf8')) as SeedManifest;

export const loginAsApiUser = async (
	page: Page,
	credentials: {
		login: string;
		password: string;
	},
) => {
	await page.goto('/login');
	await expect(page.getByTestId('login-page')).toBeVisible();

	await page.getByTestId('login-input').fill(credentials.login);
	await page.getByTestId('password-input').fill(credentials.password);
	await page.getByRole('button', { name: '登录' }).click();

	await expect(page.getByTestId('app-shell')).toBeVisible();
	await waitForRoomLoadingToFinish(page);
};

export const createBetterChatSession = async ({
	login,
	password,
}: {
	login: string;
	password: string;
}): Promise<BetterChatSession> => {
	const response = await fetch(new URL('/api/session/login', betterChatApiBaseUrl), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			login,
			password,
		}),
	});
	await unwrapApiEnvelope(response);

	const setCookie = response.headers.get('set-cookie');
	const cookieHeader = setCookie?.match(/^[^;]+/)?.[0];
	if (!cookieHeader) {
		throw new Error('BetterChat login did not return a session cookie.');
	}

	return { cookieHeader };
};

export const betterChatPostJson = async <T,>(
	session: BetterChatSession,
	path: string,
	body: Record<string, unknown>,
): Promise<T> => {
	return betterChatRequestJson<T>(session, {
		body,
		method: 'POST',
		path,
	});
};

export const betterChatGetJson = async <T,>(session: BetterChatSession, path: string): Promise<T> => {
	const response = await fetch(new URL(path, betterChatApiBaseUrl), {
		headers: {
			cookie: session.cookieHeader,
		},
	});

	return unwrapApiEnvelope<T>(response);
};

export const betterChatRequestJson = async <T,>(
	session: BetterChatSession,
	{
		body,
		method,
		path,
	}: {
		body: Record<string, unknown>;
		method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
		path: string;
	},
): Promise<T> => {
	const response = await fetch(new URL(path, betterChatApiBaseUrl), {
		method,
		headers: {
			'Content-Type': 'application/json',
			cookie: session.cookieHeader,
		},
		body: JSON.stringify(body),
	});

	return unwrapApiEnvelope<T>(response);
};

export const betterChatUploadImage = async <T,>(
	session: BetterChatSession,
	path: string,
	{
		buffer,
		fileName,
		mimeType,
		text,
	}: {
		buffer: Buffer;
		fileName: string;
		mimeType: string;
		text?: string;
	},
): Promise<T> => {
	const formData = new FormData();
	formData.set('file', new Blob([buffer], { type: mimeType }), fileName);
	if (text) {
		formData.set('text', text);
	}

	const response = await fetch(new URL(path, betterChatApiBaseUrl), {
		method: 'POST',
		headers: {
			cookie: session.cookieHeader,
		},
		body: formData,
	});

	return unwrapApiEnvelope<T>(response);
};
