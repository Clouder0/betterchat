import { expect, type Locator, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

export const tinyPngFixture = {
	buffer: Buffer.from([
		137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0,
		181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 1, 255, 165, 84, 17,
		202, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
	]),
	fileName: 'betterchat-e2e-upload.png',
	mimeType: 'image/png',
} as const;

export const createLargeBmpFixture = ({
	height,
	width,
}: {
	height: number;
	width: number;
}) => {
	const bytesPerPixel = 3;
	const rowSize = (width * bytesPerPixel + 3) & ~3;
	const pixelArraySize = rowSize * height;
	const fileSize = 54 + pixelArraySize;
	const buffer = Buffer.alloc(fileSize);

	buffer.write('BM', 0, 'ascii');
	buffer.writeUInt32LE(fileSize, 2);
	buffer.writeUInt32LE(54, 10);
	buffer.writeUInt32LE(40, 14);
	buffer.writeInt32LE(width, 18);
	buffer.writeInt32LE(height, 22);
	buffer.writeUInt16LE(1, 26);
	buffer.writeUInt16LE(24, 28);
	buffer.writeUInt32LE(pixelArraySize, 34);
	buffer.writeInt32LE(2_835, 38);
	buffer.writeInt32LE(2_835, 42);

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = 54 + y * rowSize + x * bytesPerPixel;
			buffer[offset] = (x * 13 + y * 7) % 256;
			buffer[offset + 1] = (x * 5 + y * 11) % 256;
			buffer[offset + 2] = (x * 3 + y * 17) % 256;
		}
	}

	return {
		buffer,
		fileName: `betterchat-large-${width}x${height}.bmp`,
		mimeType: 'image/bmp',
	};
};

const crcTable = new Uint32Array(256).map((_, index) => {
	let crc = index;
	for (let round = 0; round < 8; round += 1) {
		crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) >>> 0 : crc >>> 1;
	}
	return crc >>> 0;
});

const crc32 = (buffer: Buffer) => {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
};

const createPngChunk = (type: string, data: Buffer) => {
	const typeBuffer = Buffer.from(type, 'ascii');
	const lengthBuffer = Buffer.alloc(4);
	lengthBuffer.writeUInt32BE(data.length, 0);
	const crcBuffer = Buffer.alloc(4);
	crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
	return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
};

export const createLargePngFixture = ({
	height,
	width,
}: {
	height: number;
	width: number;
}) => {
	const rowStride = width * 4 + 1;
	const raw = Buffer.alloc(rowStride * height);

	for (let y = 0; y < height; y += 1) {
		const rowOffset = y * rowStride;
		raw[rowOffset] = 0;
		for (let x = 0; x < width; x += 1) {
			const offset = rowOffset + 1 + x * 4;
			raw[offset] = (x * 13 + y * 7) % 256;
			raw[offset + 1] = (x * 5 + y * 11) % 256;
			raw[offset + 2] = (x * 17 + y * 3) % 256;
			raw[offset + 3] = 255;
		}
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	header[10] = 0;
	header[11] = 0;
	header[12] = 0;

	const buffer = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		createPngChunk('IHDR', header),
		createPngChunk('IDAT', deflateSync(raw, { level: 9 })),
		createPngChunk('IEND', Buffer.alloc(0)),
	]);

	return {
		buffer,
		fileName: `betterchat-large-${width}x${height}.png`,
		mimeType: 'image/png',
	};
};

export const loginAsFixtureUser = async (
	page: Page,
	credentials: {
		login?: string;
		password?: string;
	} = {},
) => {
	await page.goto('/login');
	await expect(page.getByTestId('login-page')).toBeVisible();

	await page.getByTestId('login-input').fill(credentials.login ?? 'linche');
	await page.getByTestId('password-input').fill(credentials.password ?? 'demo');
	await page.getByRole('button', { name: '登录' }).click();

	await expect(page).toHaveURL(/\/app\/rooms\/ops-handoff$/);
	await expect(page.getByTestId('app-shell')).toBeVisible();
	await waitForRoomLoadingToFinish(page);
};

export const openRoom = async (page: Page, roomId: string) => {
	await page.getByTestId(`sidebar-room-${roomId}`).click();
	await expect(page).toHaveURL(new RegExp(`/app/rooms/${roomId}$`));
	await waitForRoomLoadingToFinish(page);
};

export const pasteImageIntoComposer = async (
	page: Page,
	{
		buffer,
		fileName,
		mimeType,
	}: {
		buffer: Buffer;
		fileName: string;
		mimeType: string;
	},
) => {
	const composerInput = page.getByTestId('composer-textarea');
	await composerInput.focus();

	await composerInput.evaluate(
		(node, payload) => {
			const file = new File([Uint8Array.from(payload.bytes)], payload.fileName, {
				type: payload.mimeType,
			});
			const clipboardData = new DataTransfer();
			clipboardData.items.add(file);
			const pasteEvent = new Event('paste', {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(pasteEvent, 'clipboardData', {
				value: clipboardData,
			});
			node.dispatchEvent(pasteEvent);
		},
		{
			bytes: [...buffer],
			fileName,
			mimeType,
		},
	);
};

export const dragImageIntoComposer = async (
	page: Page,
	{
		buffer,
		fileName,
		mimeType,
	}: {
		buffer: Buffer;
		fileName: string;
		mimeType: string;
	},
) => {
	const composerShell = page.getByTestId('composer-editor-shell');

	await composerShell.evaluate(
		(node, payload) => {
			const file = new File([Uint8Array.from(payload.bytes)], payload.fileName, {
				type: payload.mimeType,
			});
			const dataTransfer = new DataTransfer();
			dataTransfer.items.add(file);

			const dispatchDragEvent = (type: 'dragenter' | 'dragover' | 'drop') => {
				const dragEvent = new DragEvent(type, {
					bubbles: true,
					cancelable: true,
					dataTransfer,
				});
				node.dispatchEvent(dragEvent);
			};

			dispatchDragEvent('dragenter');
			dispatchDragEvent('dragover');
			dispatchDragEvent('drop');
		},
		{
			bytes: [...buffer],
			fileName,
			mimeType,
		},
	);
};

export const scrollTimelineToBottom = async (page: Page) => {
	const timeline = page.getByTestId('timeline');
	await timeline.evaluate((node) => {
		node.scrollTo({
			top: node.scrollHeight,
			behavior: 'auto',
		});
	});

	await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
};

export const readTimelineBottomGap = async (timeline: Locator) =>
	timeline.evaluate((node) => Math.max(node.scrollHeight - (node.scrollTop + node.clientHeight), 0));

const commandOrControl = process.platform === 'darwin' ? 'Meta' : 'Control';

export const waitForSidebarTransitionEnd = async (page: Page) => {
	await expect
		.poll(async () => {
			const workspace = page.getByTestId('app-workspace');
			return workspace.getAttribute('data-sidebar-transitioning');
		})
		.not.toBe('true');
};

export const collapseSidebar = async (page: Page) => {
	await page.keyboard.press(`${commandOrControl}+b`);
	await waitForSidebarTransitionEnd(page);
};

export const expandSidebar = async (page: Page) => {
	await page.keyboard.press(`${commandOrControl}+b`);
	await waitForSidebarTransitionEnd(page);
};

export const isSidebarCollapsed = async (page: Page): Promise<boolean> => {
	const collapsed = await page.getByTestId('app-sidebar').getAttribute('data-collapsed');
	return collapsed === 'true';
};

export const readSidebarShellState = async (page: Page) =>
	page.evaluate(() => {
		const sidebar = document.querySelector('[data-testid="app-sidebar"]');
		const search = document.querySelector('[data-testid="sidebar-search"]');
		if (!(sidebar instanceof HTMLElement) || !(search instanceof HTMLElement)) {
			return null;
		}

		const sidebarStyle = window.getComputedStyle(sidebar);
		const searchStyle = window.getComputedStyle(search);
		const rect = sidebar.getBoundingClientRect();
		return {
			collapsed: sidebar.getAttribute('data-collapsed') === 'true',
			searchVisible:
				rect.width > 0 &&
				rect.height > 0 &&
				sidebarStyle.visibility !== 'hidden' &&
				searchStyle.visibility !== 'hidden' &&
				searchStyle.display !== 'none' &&
				Number.parseFloat(searchStyle.opacity || '1') !== 0,
			sidebarClientWidth: sidebar.clientWidth,
			sidebarWidth: rect.width,
		};
	});

export const waitForSidebarCollapsedShell = async (page: Page) => {
	await expect
		.poll(async () => readSidebarShellState(page))
		.toEqual({
			collapsed: true,
			searchVisible: false,
			sidebarClientWidth: 0,
			sidebarWidth: 0,
		});
};

export const waitForSidebarPreviewState = async (
	page: Page,
	{
		collapsed,
		maxWidth,
		minWidth,
		searchVisible,
	}: {
		collapsed: boolean;
		maxWidth: number;
		minWidth: number;
		searchVisible: boolean;
	},
) => {
	await expect
		.poll(async () => {
			const state = await readSidebarShellState(page);
			return Boolean(
				state &&
					state.collapsed === collapsed &&
					state.searchVisible === searchVisible &&
					state.sidebarWidth >= minWidth &&
					state.sidebarWidth <= maxWidth,
			);
		})
		.toBe(true);
};

export const waitForSidebarExpandedPreview = async (page: Page) => {
	await waitForSidebarPreviewState(page, {
		collapsed: false,
		maxWidth: Number.POSITIVE_INFINITY,
		minWidth: 200,
		searchVisible: true,
	});
};

export const waitForSidebarCollapsedSettle = async (page: Page) => {
	await waitForSidebarTransitionEnd(page);
	await waitForSidebarCollapsedShell(page);
};

export const waitForRoomLoadingToFinish = async (page: Page) => {
	await expect(page.getByTestId('room-loading-skeleton')).toHaveCount(0);
	await expect
		.poll(async () => {
			const timeline = page.getByTestId('timeline');
			if ((await timeline.count()) === 0) {
				return 0;
			}

			return timeline.evaluate((node) => {
				const rect = node.getBoundingClientRect();
				const style = window.getComputedStyle(node);
				if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') === 0) {
					return 0;
				}

				return rect.height;
			});
		})
		.toBeGreaterThan(48);
};
