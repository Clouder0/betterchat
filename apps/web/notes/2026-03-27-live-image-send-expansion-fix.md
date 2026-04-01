# Live Image Send Expansion Fix

Date: 2026-03-27
Owner: frontend session
Scope: `apps/web/**`
Status: completed

## Problem

Freshly sent image messages could sometimes fold immediately after upload success.

This was intermittent because it depended on render timing between:

- trailing optimistic local image message
- hydrated server message arriving
- optimistic local message being removed

## Root cause

`findAppendedMessageIds()` used the very last previous message id as the append anchor.

When the previous tail was an optimistic local send:

- previous: `[...server, optimistic-image]`
- next: `[...server, hydrated-image, optimistic-image]`

the hydrated server image landed before the optimistic tail, so it was not recognized
as a newly appended live message.

That meant it could lose the default expanded state and fold immediately.

## Fix

Use the last non-optimistic previous message as the append anchor when possible.

This keeps hydrated server messages recognized as live appends even when they arrive
before trailing optimistic local sends.

## Verification

- `env BUN_TMPDIR=/tmp bun test apps/web/src/features/timeline/messageCollapsing.test.ts`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e -- --grep "uploads an image through BetterChat and renders it in the live shell"`
- `env BUN_TMPDIR=/tmp bun run build:web`
