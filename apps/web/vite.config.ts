import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_BETTERCHAT_API_PROXY_TARGET || process.env.VITE_BETTERCHAT_API_BASE_URL || '';
const editorMarkdownChunkPackages = ['@codemirror/lang-markdown'];
const editorCoreChunkPackages = [
	'@codemirror/commands',
	'@codemirror/language',
	'@codemirror/state',
	'@codemirror/view',
	'@lezer/',
	'@marijn/find-cluster-break',
	'crelt',
	'style-mod',
	'w3c-keyname',
];
const markdownHighlightChunkPackages = ['hast-util-to-text', 'highlight.js', 'lowlight'];
const katexChunkPackages = ['katex', 'rehype-katex'];
const markdownCoreChunkPackages = [
	'character-entities',
	'comma-separated-tokens',
	'decode-named-character-reference',
	'mdast-util-',
	'micromark',
	'property-information',
	'react-markdown',
	'remark-gfm',
	'remark-math',
	'space-separated-tokens',
	'unist-util-',
];

const matchesChunkPackage = (id: string, packageName: string) => id.includes(`/node_modules/${packageName}`);

export default defineConfig({
	plugins: [react()],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('/node_modules/')) {
						return undefined;
					}

					if (editorMarkdownChunkPackages.some((packageName) => matchesChunkPackage(id, packageName))) {
						return 'editor-markdown-vendor';
					}

					if (editorCoreChunkPackages.some((packageName) => matchesChunkPackage(id, packageName))) {
						return 'editor-vendor';
					}

					if (markdownHighlightChunkPackages.some((packageName) => matchesChunkPackage(id, packageName))) {
						return 'markdown-highlight-vendor';
					}

					if (katexChunkPackages.some((packageName) => matchesChunkPackage(id, packageName))) {
						return 'katex-vendor';
					}

					if (markdownCoreChunkPackages.some((packageName) => matchesChunkPackage(id, packageName))) {
						return 'markdown-vendor';
					}

					return undefined;
				},
			},
		},
	},
	server: {
		port: 3300,
		...(apiProxyTarget
			? {
					proxy: {
						'/api': {
							changeOrigin: true,
							target: apiProxyTarget,
							ws: true,
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
