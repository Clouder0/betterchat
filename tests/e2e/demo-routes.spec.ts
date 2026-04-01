import { expect, test } from '@playwright/test';

const demoRoutes = [
	{ path: '/', text: '现代、克制、优雅。' },
	{ path: '/shell', text: '用中文重新检验整个壳层' },
	{ path: '/content', text: 'Markdown、代码块与数学公式' },
	{ path: '/system', text: '色板、基础组件与中文排版' },
] as const;

test.describe('review routes', () => {
	for (const route of demoRoutes) {
		test(`renders ${route.path}`, async ({ page }) => {
			await page.goto(route.path);
			await expect(page.getByText(route.text)).toBeVisible();
		});
	}
});
