import { describe, expect, it } from 'bun:test';

import { resolveImageUploadFailureMessage, resolveMaxUploadBytesFromError } from './imageUploadErrors';

describe('imageUploadErrors', () => {
	it('extracts max upload bytes from BetterChat API validation details', () => {
		expect(
			resolveMaxUploadBytesFromError({
				details: {
					maxUploadBytes: 4_194_304,
				},
			}),
		).toBe(4_194_304);

		expect(
			resolveMaxUploadBytesFromError({
				details: {
					maxUploadBytes: 'large',
				},
			}),
		).toBeNull();

		expect(resolveMaxUploadBytesFromError(new Error('no details'))).toBeNull();
	});

	it('formats a clear oversized-upload message without promising client-side compression', () => {
		expect(
			resolveImageUploadFailureMessage({
				details: {
					maxUploadBytes: 10 * 1024 * 1024,
				},
			}),
		).toBe('图片过大，超过后台 10.0 MB 上限。当前浏览器不会压缩或转码图片，请调整原图后重试。');

		expect(resolveImageUploadFailureMessage(new Error('plain failure'))).toBeNull();
	});
});
