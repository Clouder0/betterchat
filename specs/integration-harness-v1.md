# BetterChat Integration Harness v1

Date: 2026-03-24
Target upstream: Rocket.Chat `7.6.0`

## Objective

Create a repeatable integration environment that proves BetterChat works against a real Rocket.Chat `7.6.0` server.

The harness must validate:
- auth and bootstrap
- room list and explicit room open/hide
- timeline load and realtime updates
- uploads and avatars
- session and reconnect behavior

## Test philosophy

- Test against a real Rocket.Chat server, not mocked protocol responses
- Keep one fast mode for daily iteration
- Keep one realistic mode for compatibility confidence
- Prefer public APIs and real websocket flows in assertions
- Use direct database fixture injection only where it materially speeds up setup

## Services

The first harness should run these services:

- `mongo`
  - Rocket.Chat backing database
- `rocketchat`
  - pinned upstream `7.6.0`
- `betterchat-backend`
  - proxy or BFF in front of Rocket.Chat
- `betterchat-web`
  - standalone frontend under test
- `playwright`
  - end-to-end test runner

## Suggested local topology

Suggested host ports:
- Rocket.Chat upstream: `3100`
- BetterChat backend: `3200`
- BetterChat web: `3300`

Principle:
- Playwright talks to BetterChat web
- BetterChat web talks only to BetterChat backend
- BetterChat backend talks to Rocket.Chat upstream

This makes the proxy boundary explicit in every test.

## Test modes

### Fast mode

Purpose:
- fast local iteration
- broad regression coverage

Characteristics:
- Rocket.Chat runs with `TEST_MODE=true`
- initial users, rooms, and settings may be seeded directly in Mongo
- fixture setup can borrow patterns from Rocket.Chat's own e2e harness
- suitable for TDD while building BetterChat

### Realistic mode

Purpose:
- compatibility confidence
- catch assumptions hidden by fixture shortcuts

Characteristics:
- avoid direct DB writes after initial admin bootstrap
- create scenarios through public APIs or supported login flows
- use real BetterChat backend and realtime transport
- run on CI before merges that affect compatibility behavior

## Seed strategy

### Base fixture set

Seed these core actors:
- `admin`
- `alice`
- `bob`

Seed these core conversations:
- one public channel
- one private group
- one direct message between `alice` and `bob`

Seed these core message shapes:
- plain text message
- edited message
- deleted message
- thread parent plus replies
- uploaded file message

### Fast-mode implementation

Mirror Rocket.Chat upstream patterns:
- direct Mongo fixture injection
- deterministic users and passwords
- deterministic room ids only if needed for stable snapshots

Recommended source references:
- `apps/meteor/tests/e2e/config/global-setup.ts`
- `apps/meteor/tests/e2e/fixtures/inject-initial-data.ts`

### Realistic-mode implementation

Use:
- login as admin
- create users and rooms through supported APIs where practical
- create scenario messages through public chat routes

## Core assertions

The first Playwright suite should cover these scenarios:

1. Login through BetterChat with username and password.
2. Load public bootstrap before login.
3. Load authenticated bootstrap after login.
4. Render sidebar from rooms and subscriptions.
5. Open a room and load its initial timeline.
6. Hide and reopen a room through BetterChat-owned room-visibility endpoints.
7. Receive a live message from another user.
8. Send a message from BetterChat.
9. Edit and delete a message.
10. Mark a room as read and observe unread state changes.
11. Upload a file through BetterChat and render it back.
12. Load avatars through BetterChat backend.
13. Handle forced logout.
14. Reconnect after websocket interruption without duplicating messages.

## Required helper capabilities

The harness should include helpers for:
- admin login to upstream Rocket.Chat
- test-user login through BetterChat
- fixture creation and cleanup
- sending upstream messages as another user
- breaking and restoring websocket connectivity
- waiting for BetterChat room state to settle

## Observability

Each run should preserve enough artifacts to debug failures:
- Playwright traces
- browser console logs
- BetterChat backend logs
- Rocket.Chat container logs
- optional network captures for websocket and REST failures

## Acceptance criteria

The integration harness is ready when:
- one command starts the full stack
- one command runs the BetterChat integration suite
- fast mode is usable during day-to-day development
- realistic mode proves BetterChat against real Rocket.Chat behavior
- failed tests leave enough artifacts to explain protocol mismatches

## Immediate next implementation slice

1. Create the harness directory layout under `betterchat/`.
2. Choose the BetterChat backend and frontend runtimes.
3. Write the first stack definition for `mongo`, `rocketchat`, `betterchat-backend`, `betterchat-web`, and `playwright`.
4. Implement fixture bootstrap for `admin`, `alice`, `bob`, and one seeded public room.
5. Write the first three Playwright specs:
   - login
   - authenticated bootstrap
   - sidebar plus room open
