# BetterChat Backend

This app is the BetterChat compatibility edge for Rocket.Chat `7.6.0`.

Current state:
- Hono compatibility BFF for Rocket.Chat `7.6.0`
- explicit BetterChat-owned auth/workspace/directory/conversation/media endpoints
- encrypted BetterChat session cookie; no separate session service required
- canonical message creation through `POST /api/conversations/:conversationId/messages`
- canonical image upload through `POST /api/conversations/:conversationId/media`
- canonical realtime websocket endpoint through `GET /api/stream`
- strict media proxy allowlist for avatars and uploaded files only

Read before building:
- `../../handoffs/backend-session-01.md`
- `../../specs/backend-architecture-conversation-domain-v3.md`
- `../../specs/contracts-conversation-domain-v3.md`
- `../../specs/integration-harness-v1.md`

Ownership:
- `apps/backend/**`
- backend-facing harness scripts and tests when explicitly assigned

Useful commands:
- `bun --filter @betterchat/backend typecheck`
- `bun --filter @betterchat/backend test`
- [`backend-stack-start.sh`](/home/clouder/GitRepos/Rocket.Chat/betterchat/scripts/backend-stack-start.sh)
- [`backend-integration-test.sh`](/home/clouder/GitRepos/Rocket.Chat/betterchat/scripts/backend-integration-test.sh)
- [`backend-stack-stop.sh`](/home/clouder/GitRepos/Rocket.Chat/betterchat/scripts/backend-stack-stop.sh)

Required runtime env:
- `BETTERCHAT_SESSION_SECRET`
