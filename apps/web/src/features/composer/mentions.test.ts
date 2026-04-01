import { describe, expect, it } from 'bun:test';
import type { ConversationMentionCandidate, ConversationParticipant } from '@betterchat/contracts';

import { applyComposerEdit } from './composerEditing';
import {
	createMentionCompletionEdit,
	getActiveMentionMatch,
	getMentionCandidateSecondaryLabel,
	hasDistinctMentionHandle,
	toComposerMentionCandidates,
	toMentionInteractionUsers,
} from './mentions';

describe('mentions', () => {
	it('adapts backend mention candidates into stable composer candidates and preserves backend insert text', () => {
		const backendCandidates: ConversationMentionCandidate[] = [
			{
				kind: 'user',
				user: {
					id: 'user-zhoulan',
					username: 'zhoulan',
					displayName: '周岚',
				},
				insertText: '@zhoulan',
			},
			{
				kind: 'special',
				key: 'all',
				label: 'Notify everyone in this conversation',
				insertText: '@all',
			},
		];

		expect(toComposerMentionCandidates(backendCandidates)).toEqual([
			{
				displayName: '周岚',
				id: 'user-zhoulan',
				insertText: '@zhoulan',
				kind: 'user',
				username: 'zhoulan',
			},
			{
				description: 'Notify everyone in this conversation',
				displayName: '@all',
				id: 'special-all',
				insertText: '@all',
				kind: 'special',
			},
		]);
	});

	it('detects an active mention token only at a valid token boundary', () => {
		expect(
			getActiveMentionMatch({
				selection: {
					anchor: '请 @zh'.length,
					head: '请 @zh'.length,
				},
				value: '请 @zh',
			}),
		).toEqual({
			from: 2,
			query: 'zh',
			signature: '2:5:zh',
			to: 5,
		});

		expect(
			getActiveMentionMatch({
				selection: {
					anchor: 'ops@zhou'.length,
					head: 'ops@zhou'.length,
				},
				value: 'ops@zhou',
			}),
		).toBeNull();
	});

	it('maps authoritative participants into mention interaction users without relying on timeline authors', () => {
		const participants: ConversationParticipant[] = [
			{
				self: true,
				user: {
					id: 'user-linche',
					username: 'linche',
					displayName: '林澈',
				},
			},
			{
				self: false,
				user: {
					id: 'user-zhoulan',
					username: 'zhoulan',
					displayName: '周岚',
				},
			},
		];

		expect(toMentionInteractionUsers(participants)).toEqual([
			{
				id: 'user-linche',
				username: 'linche',
				displayName: '林澈',
			},
			{
				id: 'user-zhoulan',
				username: 'zhoulan',
				displayName: '周岚',
			},
		]);
	});

	it('inserts backend-owned mention text with a trailing space and preserves distinct secondary labels only for user mentions', () => {
		const value = '请联系 @zh 尽快确认';
		const match = getActiveMentionMatch({
			selection: {
				anchor: '请联系 @zh'.length,
				head: '请联系 @zh'.length,
			},
			value,
		});

		expect(match).not.toBeNull();
		if (!match) {
			throw new Error('expected an active mention match');
		}

		const edit = createMentionCompletionEdit({
			candidate: {
				displayName: '周岚',
				id: 'user-zhoulan',
				insertText: '@zhoulan',
				kind: 'user',
				username: 'zhoulan',
			},
			match,
			value,
		});

		expect(applyComposerEdit(value, edit)).toBe('请联系 @zhoulan 尽快确认');
		expect(edit.selection).toEqual({
			anchor: '请联系 @zhoulan'.length,
			head: '请联系 @zhoulan'.length,
		});

		expect(
			hasDistinctMentionHandle({
				displayName: '周岚',
				id: 'user-zhoulan',
				insertText: '@zhoulan',
				kind: 'user',
				username: 'zhoulan',
			}),
		).toBe(true);
		expect(
			hasDistinctMentionHandle({
				displayName: 'linche',
				id: 'user-linche',
				insertText: '@linche',
				kind: 'user',
				username: 'linche',
			}),
		).toBe(false);
		expect(
			getMentionCandidateSecondaryLabel({
				description: 'Notify everyone in this conversation',
				displayName: '@all',
				id: 'special-all',
				insertText: '@all',
				kind: 'special',
			}),
		).toBe('Notify everyone in this conversation');
	});
});
