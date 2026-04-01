import { describe, expect, it } from 'bun:test';

import type { TimelineMessage } from '@/lib/chatModels';

import {
	hasOlderHistory,
	mergeOlderHistoryPage,
	resolveOlderHistoryLoadCursor,
	resolveOlderHistoryNextCursor,
	type OlderHistoryState,
} from './olderHistoryState';

const createMessage = (id: string, createdAt: string): TimelineMessage => ({
	id,
	roomId: 'room-1',
	createdAt,
	author: {
		displayName: 'Alice',
		id: 'user-1',
	},
	body: {
		rawMarkdown: id,
	},
	flags: {
		deleted: false,
		edited: false,
	},
});

describe('olderHistoryState', () => {
	it('uses the base timeline cursor before any older page is loaded', () => {
		expect(resolveOlderHistoryLoadCursor({ baseNextCursor: 'cursor-1', olderHistory: undefined })).toBe('cursor-1');
		expect(resolveOlderHistoryNextCursor({ baseNextCursor: 'cursor-1', olderHistory: undefined })).toBe('cursor-1');
		expect(hasOlderHistory({ baseNextCursor: 'cursor-1', olderHistory: undefined })).toBe(true);
	});

	it('marks pagination exhausted when an older page arrives without a next cursor', () => {
		const merged = mergeOlderHistoryPage({
			current: undefined,
			page: {
				messages: [createMessage('message-older-1', '2026-03-30T10:00:00.000Z')],
			},
		});

		expect(merged.loadedNewMessages).toBe(true);
		expect(merged.state).toEqual<OlderHistoryState>({
			messages: [createMessage('message-older-1', '2026-03-30T10:00:00.000Z')],
			pagination: {
				kind: 'exhausted',
			},
		});
		expect(resolveOlderHistoryLoadCursor({ baseNextCursor: 'cursor-1', olderHistory: merged.state })).toBeNull();
		expect(resolveOlderHistoryNextCursor({ baseNextCursor: 'cursor-1', olderHistory: merged.state })).toBeUndefined();
		expect(hasOlderHistory({ baseNextCursor: 'cursor-1', olderHistory: merged.state })).toBe(false);
	});

	it('never falls back to the original base cursor after exhaustion', () => {
		const exhaustedState: OlderHistoryState = {
			messages: [createMessage('message-older-1', '2026-03-30T10:00:00.000Z')],
			pagination: {
				kind: 'exhausted',
			},
		};

		expect(resolveOlderHistoryLoadCursor({ baseNextCursor: 'cursor-from-first-page', olderHistory: exhaustedState })).toBeNull();
		expect(resolveOlderHistoryNextCursor({ baseNextCursor: 'cursor-from-first-page', olderHistory: exhaustedState })).toBeUndefined();
	});

	it('keeps following the explicit older-history cursor when more pages remain', () => {
		const current: OlderHistoryState = {
			messages: [createMessage('message-older-2', '2026-03-30T09:00:00.000Z')],
			pagination: {
				kind: 'ready',
				nextCursor: 'cursor-older-2',
			},
		};
		const merged = mergeOlderHistoryPage({
			current,
			page: {
				messages: [
					createMessage('message-older-1', '2026-03-30T08:00:00.000Z'),
					createMessage('message-older-2', '2026-03-30T09:00:00.000Z'),
				],
				nextCursor: 'cursor-older-1',
			},
		});

		expect(merged.loadedNewMessages).toBe(true);
		expect(resolveOlderHistoryLoadCursor({ baseNextCursor: 'cursor-from-first-page', olderHistory: merged.state })).toBe(
			'cursor-older-1',
		);
		expect(resolveOlderHistoryNextCursor({ baseNextCursor: 'cursor-from-first-page', olderHistory: merged.state })).toBe(
			'cursor-older-1',
		);
	});
});
