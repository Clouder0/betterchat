import { describe, expect, it } from 'vitest';

import { hasComposerTransferImageFile, pickComposerTransferImageFile } from './composerTransfer';

describe('composerTransfer', () => {
	it('returns the first image file from transfer items', () => {
		const imageFile = new File(['png'], 'clipboard.png', { type: 'image/png' });
		const transferData = {
			items: [
				{
					kind: 'string',
					type: 'text/plain',
					getAsFile: () => null,
				},
				{
					kind: 'file',
					type: 'image/png',
					getAsFile: () => imageFile,
				},
			],
		};

		expect(pickComposerTransferImageFile(transferData)).toBe(imageFile);
	});

	it('falls back to the file list when transfer items are unavailable', () => {
		const imageFile = new File(['jpg'], 'fallback.jpg', { type: 'image/jpeg' });

		expect(
			pickComposerTransferImageFile({
				files: [imageFile],
			}),
		).toBe(imageFile);
	});

	it('normalizes transfer images that have no file name', () => {
		const unnamedImage = new File(['png'], '', { type: 'image/png' });

		const resolvedImage = pickComposerTransferImageFile({
			items: [
				{
					kind: 'file',
					type: 'image/png',
					getAsFile: () => unnamedImage,
				},
			],
		});

		expect(resolvedImage).not.toBeNull();
		expect(resolvedImage?.name).toBe('pasted-image.png');
		expect(resolvedImage?.type).toBe('image/png');
	});

	it('detects image files without materializing them first', () => {
		expect(
			hasComposerTransferImageFile({
				items: [
					{
						kind: 'string',
						type: 'text/plain',
						getAsFile: () => null,
					},
					{
						kind: 'file',
						type: 'image/webp',
						getAsFile: () => null,
					},
				],
			}),
		).toBe(true);
	});

	it('returns null when the transfer does not contain an image', () => {
		expect(
			pickComposerTransferImageFile({
				items: [
					{
						kind: 'string',
						type: 'text/plain',
						getAsFile: () => null,
					},
				],
				files: [],
			}),
		).toBeNull();
	});

	it('reports false when the transfer does not contain an image', () => {
		expect(
			hasComposerTransferImageFile({
				items: [
					{
						kind: 'string',
						type: 'text/plain',
						getAsFile: () => null,
					},
				],
				files: [],
			}),
		).toBe(false);
	});
});
