# BetterChat Backend Architecture Conversation Domain v2

Date: 2026-03-27
Status: Canonical backend architecture target
Target upstream: Rocket.Chat `7.6.0`

## Direction

BetterChat backend is no longer modeled as a thin room/sidebar compatibility shim.

It is now the canonical conversation-domain boundary that:

- owns stable BetterChat semantics
- normalizes upstream-specific behavior
- keeps frontend independent from Rocket.Chat payload shape
- remains simple to host as a single-node service

## Public nouns

- workspace
- directory
- conversation
- membership
- timeline
- thread
- live state
- stream

## Boundary split

Keep these concerns distinct:

- adapter layer: Rocket.Chat-specific transport and quirks
- domain normalization: BetterChat-owned canonical shapes
- snapshot service: versioned projections per session
- route layer: HTTP parsing and response envelopes
- stream gateway: realtime watch orchestration and semantic update events

## Canonical HTTP surface

- `GET /api/public/bootstrap`
- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/workspace`
- `GET /api/directory`
- `GET /api/conversations/:conversationId`
- `GET /api/conversations/:conversationId/timeline`
- `GET /api/conversations/:conversationId/messages/:messageId/context`
- `GET /api/conversations/:conversationId/threads/:threadId/timeline`
- `POST /api/conversations/:conversationId/messages`
- `POST /api/conversations/:conversationId/media`
- `POST /api/conversations/:conversationId/membership/commands`
- `GET /api/stream`
- `GET /api/media/*`

## Stream policy

`/api/stream` is the canonical realtime transport.

Design rules:

- watch the directory explicitly instead of pretending room-local watches can replace sidebar semantics
- directory updates come from upstream subscription/user-stream changes
- watched conversation updates come from upstream room-message and room-state streams
- thread watches are explicit
- typing and presence remain separate live-state events
- when an exact incremental patch is not worth fabricating, send a resynced snapshot or `resync.required`

## Why directory watch exists

Rocket.Chat can update inactive-room attention in the sidebar without the user actively viewing that room.

That means:

- room-local watches alone are insufficient for sidebar correctness
- the backend must expose a directory-level watch primitive
- frontend should not try to infer inactive-room attention from the current room timeline

## Hosting model

Keep the hosting story simple:

- no Redis requirement
- no extra durable state service
- session-scoped snapshot and stream state can stay in memory
- rebuild from upstream truth when resync is needed

## Compatibility stance

Legacy v1 room/sidebar routes may remain temporarily during transition work, but they are not the design center anymore.

The canonical integration target is the conversation-domain surface above.
