import { describe, expect, it } from 'bun:test';

import { resolveInlineMentionTone, resolveMentionInteractionUser, splitMentionSegments } from './mentions';

describe('mentions', () => {
	it('splits inline mentions only at valid boundaries', () => {
		expect(splitMentionSegments('请 @alice 看一下，邮箱 alice@example.com 不算。')).toEqual([
			{ kind: 'text', value: '请 ' },
			{ kind: 'mention', value: '@alice' },
			{ kind: 'text', value: ' 看一下，邮箱 alice@example.com 不算。' },
		]);
	});

	it('uses a distinct tone for mentions that target the current viewer', () => {
		const currentUser = {
			displayName: 'Alice Chen',
			username: 'alice',
		};

		expect(
			resolveInlineMentionTone({
				currentUser,
				token: '@alice',
			}),
		).toBe('self');
		expect(
			resolveInlineMentionTone({
				currentUser,
				token: '@bob',
			}),
		).toBe('default');
	});

	it('resolves an inline mention token to an interactive user target by username or display name', () => {
		const users = [
			{
				displayName: '林澈',
				id: 'user-linche',
				username: 'linche',
			},
			{
				displayName: '周岚',
				id: 'user-zhou',
				username: 'zhoulan',
			},
		];

		expect(resolveMentionInteractionUser({ token: '@linche', users })).toEqual(users[0]);
		expect(resolveMentionInteractionUser({ token: '@周岚', users })).toEqual(users[1]);
		expect(resolveMentionInteractionUser({ token: '@unknown', users })).toBeNull();
	});

	it('does not create interactive targets for the current user or ambiguous display-name matches', () => {
		const users = [
			{
				displayName: 'Alex',
				id: 'user-alex-1',
				username: 'alex',
			},
			{
				displayName: 'Alex',
				id: 'user-alex-2',
				username: 'alex-ops',
			},
			{
				displayName: '同名',
				id: 'user-dup-1',
				username: 'dup-one',
			},
			{
				displayName: '同名',
				id: 'user-dup-2',
				username: 'dup-two',
			},
		];

		expect(
			resolveMentionInteractionUser({
				currentUserId: 'user-alex-1',
				token: '@alex',
				users,
			}),
		).toBeNull();
		expect(resolveMentionInteractionUser({ token: '@同名', users })).toBeNull();
	});
});
