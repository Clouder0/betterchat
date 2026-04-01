import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSpec = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('spec parity', () => {
  test('contracts v3 documents the canonical HTTP and stream surface', () => {
    const contractsSpec = readSpec('../../../specs/contracts-conversation-domain-v3.md');

    expect(contractsSpec).toContain('GET /api/directory');
    expect(contractsSpec).toContain('GET /api/users/:userId/direct-conversation');
    expect(contractsSpec).toContain('PUT /api/users/:userId/direct-conversation');
    expect(contractsSpec).toContain('GET /api/conversations/:conversationId/participants');
    expect(contractsSpec).toContain('GET /api/conversations/:conversationId/mention-candidates');
    expect(contractsSpec).toContain('GET /api/conversations/:conversationId/timeline');
    expect(contractsSpec).toContain('PATCH /api/conversations/:conversationId/messages/:messageId');
    expect(contractsSpec).toContain('DELETE /api/conversations/:conversationId/messages/:messageId');
    expect(contractsSpec).toContain('POST /api/conversations/:conversationId/messages/:messageId/reactions');
    expect(contractsSpec).toContain('membership.inbox');
    expect(contractsSpec).toContain('replyCount');
    expect(contractsSpec).toContain('preview');
    expect(contractsSpec).toContain('source');
    expect(contractsSpec).toContain('only true one-to-one directs qualify');
    expect(contractsSpec).toContain('read checkpoint `ls || ts`');
    expect(contractsSpec).toContain('actual conversation activity, not a user read checkpoint');
    expect(contractsSpec).toContain('self-authored post-checkpoint messages do not create an unread anchor');
    expect(contractsSpec).toContain('echoToConversation=true');
    expect(contractsSpec).toContain('unsafe or malformed media URLs are dropped');
    expect(contractsSpec).toContain('participants = authoritative roster truth');
    expect(contractsSpec).toContain('mention-candidates = composer suggestion truth');
    expect(contractsSpec).toContain("type: 'directory.entry.upsert'");
    expect(contractsSpec).toContain("type: 'directory.entry.remove'");
    expect(contractsSpec).toContain("type: 'typing.updated'");

    expect(contractsSpec).toContain('/api/realtime');
    expect(contractsSpec).toContain('/api/rooms/*');
    expect(contractsSpec).toContain('Explicitly removed');
  });

  test('architecture v3 captures inbox projection and directory patch streaming', () => {
    const architectureSpec = readSpec('../../../specs/backend-architecture-conversation-domain-v3.md');

    expect(architectureSpec).toContain('inbox projection');
    expect(architectureSpec).toContain('replyCount');
    expect(architectureSpec).toContain('direct-conversation ensure/open/create by stable user id');
    expect(architectureSpec).toContain('GET /api/conversations/:conversationId/participants');
    expect(architectureSpec).toContain('GET /api/conversations/:conversationId/mention-candidates');
    expect(architectureSpec).toContain('use subscription `ls || ts` as the read checkpoint');
    expect(architectureSpec).toContain('reconcile exact main-timeline unread counts from messages updated since the checkpoint');
    expect(architectureSpec).toContain('directory.entry.upsert/remove');
    expect(architectureSpec).toContain('inactive conversations must update without per-room frontend polling');
    expect(architectureSpec).toContain('GET /api/stream');
    expect(architectureSpec).toContain('attachment.image_url');
    expect(architectureSpec).toContain('attachment.title_link');
    expect(architectureSpec).toContain('explicit per-refresh fact scopes');
    expect(architectureSpec).toContain('authenticated upstream `403` stays a permission rejection');
    expect(architectureSpec).toContain('exact first unread main-timeline message id');
    expect(architectureSpec).toContain('participants route = authoritative conversation roster');
    expect(architectureSpec).toContain('mention-candidates route = ranked composer candidates');
    expect(architectureSpec).toContain('project room ordering/activity timestamps from actual room activity');
    expect(architectureSpec).toContain('multi-user Rocket.Chat `t: \'d\'` rooms are private-group conversations');
  });
});
