import { describe, expect, it } from 'bun:test';

import type { TimelineMessage } from '@/lib/chatModels';

import {
	findDroppedTimelineHead,
	hasOlderHistory,
	mergeOlderHistoryPage,
	olderHistoryStatesEqual,
	resolveRetainedOlderHistory,
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

	it('detects when a later base refetch becomes a narrower suffix of the already loaded window', () => {
		const previousLoadedMessages = [
			createMessage('message-1', '2026-03-30T08:00:00.000Z'),
			createMessage('message-2', '2026-03-30T09:00:00.000Z'),
			createMessage('message-3', '2026-03-30T10:00:00.000Z'),
			createMessage('message-4', '2026-03-30T11:00:00.000Z'),
		];
		const nextBaseMessages = previousLoadedMessages.slice(2);

		expect(
			findDroppedTimelineHead({
				nextBaseMessages,
				previousLoadedMessages,
			}),
		).toEqual(previousLoadedMessages.slice(0, 2));
	});

	it('retains a dropped expanded initial-page prefix as older history and preserves the deeper cursor', () => {
		const previousLoadedMessages = [
			createMessage('message-1', '2026-03-30T08:00:00.000Z'),
			createMessage('message-2', '2026-03-30T09:00:00.000Z'),
			createMessage('message-3', '2026-03-30T10:00:00.000Z'),
			createMessage('message-4', '2026-03-30T11:00:00.000Z'),
		];
		const nextBaseMessages = previousLoadedMessages.slice(2);

		expect(
			resolveRetainedOlderHistory({
				current: undefined,
				nextBaseMessages,
				previousLoadedMessages,
				previousNextCursor: 'cursor-before-message-1',
			}),
		).toEqual<OlderHistoryState>({
			messages: previousLoadedMessages.slice(0, 2),
			pagination: {
				kind: 'ready',
				nextCursor: 'cursor-before-message-1',
			},
		});
	});

	it('merges a dropped expanded-page prefix into existing older history without losing the older pagination cursor', () => {
		const current: OlderHistoryState = {
			messages: [createMessage('message-0', '2026-03-30T07:00:00.000Z')],
			pagination: {
				kind: 'ready',
				nextCursor: 'cursor-before-message-0',
			},
		};
		const previousLoadedMessages = [
			createMessage('message-1', '2026-03-30T08:00:00.000Z'),
			createMessage('message-2', '2026-03-30T09:00:00.000Z'),
			createMessage('message-3', '2026-03-30T10:00:00.000Z'),
			createMessage('message-4', '2026-03-30T11:00:00.000Z'),
		];
		const nextBaseMessages = previousLoadedMessages.slice(2);

		expect(
			resolveRetainedOlderHistory({
				current,
				nextBaseMessages,
				previousLoadedMessages,
				previousNextCursor: 'cursor-before-message-1',
			}),
		).toEqual<OlderHistoryState>({
			messages: [
				createMessage('message-0', '2026-03-30T07:00:00.000Z'),
				createMessage('message-1', '2026-03-30T08:00:00.000Z'),
				createMessage('message-2', '2026-03-30T09:00:00.000Z'),
			],
			pagination: {
				kind: 'ready',
				nextCursor: 'cursor-before-message-0',
			},
		});
	});

	it('compares older-history states by message window and pagination', () => {
		const state: OlderHistoryState = {
			messages: [createMessage('message-1', '2026-03-30T08:00:00.000Z')],
			pagination: {
				kind: 'exhausted',
			},
		};

		expect(olderHistoryStatesEqual(state, state)).toBe(true);
		expect(
			olderHistoryStatesEqual(state, {
				messages: [createMessage('message-1', '2026-03-30T08:00:00.000Z')],
				pagination: {
					kind: 'exhausted',
				},
			}),
		).toBe(true);
		expect(
			olderHistoryStatesEqual(state, {
				messages: [createMessage('message-2', '2026-03-30T09:00:00.000Z')],
				pagination: {
					kind: 'exhausted',
				},
			}),
		).toBe(false);
	});
});
