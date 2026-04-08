import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const host = process.env.BETTERCHAT_E2E_HOST ?? '127.0.0.1';
const apiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase();
const defaultPort = apiMode === 'api' ? '3411' : '3401';
const port = Number(process.env.BETTERCHAT_E2E_PORT ?? defaultPort);
const baseURL = process.env.BETTERCHAT_E2E_BASE_URL ?? `http://${host}:${port}`;
const apiBaseUrl = process.env.BETTERCHAT_E2E_API_BASE_URL ?? 'http://127.0.0.1:3200';
const requestedChromiumExecutablePath = process.env.BETTERCHAT_E2E_CHROMIUM_PATH;
const systemChromiumExecutablePath = '/usr/bin/chromium';
const chromiumExecutablePath =
	requestedChromiumExecutablePath
		?? (existsSync(systemChromiumExecutablePath) ? systemChromiumExecutablePath : undefined);

export default defineConfig({
	testDir: '.',
	fullyParallel: false,
	workers: 1,
	timeout: 45_000,
	expect: {
		timeout: 8_000,
	},
	reporter: [['list']],
	use: {
		baseURL,
		headless: true,
		viewport: {
			width: 1440,
			height: 960,
		},
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		...(chromiumExecutablePath
			? {
					launchOptions: {
						executablePath: chromiumExecutablePath,
					},
			  }
			: {}),
	},
	webServer: {
		command: `bun run dev -- --host ${host} --port ${port} --strictPort`,
		cwd: new URL('../../apps/web', import.meta.url).pathname,
		url: baseURL,
		reuseExistingServer: true,
		timeout: 120_000,
		env: {
			BUN_TMPDIR: '/tmp',
			VITE_BETTERCHAT_API_MODE: apiMode,
			...(apiMode === 'api' ? { VITE_BETTERCHAT_API_PROXY_TARGET: apiBaseUrl } : {}),
		},
	},
});
