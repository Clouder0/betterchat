import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_BETTERCHAT_API_PROXY_TARGET || process.env.VITE_BETTERCHAT_API_BASE_URL || '';

export default defineConfig({
	plugins: [react()],
	server: {
		port: 3300,
		...(apiProxyTarget
			? {
					proxy: {
						'/api': {
							target: apiProxyTarget,
						},
					},
			  }
			: {}),
	},
	resolve: {
		alias: {
			'@': new URL('./src', import.meta.url).pathname,
			'@betterchat/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url).pathname,
		},
	},
});
