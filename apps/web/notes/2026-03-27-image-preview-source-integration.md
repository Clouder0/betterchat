# Image Preview / Source Integration

Date: 2026-03-27
Owner: frontend session
Scope: BetterChat web frontend integration
Status: completed

## Backend contract now available

The BetterChat conversation attachment contract now exposes image assets as:

- `preview`: timeline-sized asset
- `source`: original uploaded asset

Confirmed from:

- `packages/contracts/src/index.ts`
- `apps/backend/src/conversation-domain.ts`
- backend tests covering preview/source normalization

## Frontend integration

Updated the web client to consume the split image contract end-to-end:

- timeline models and contract adapters now store `preview` + `source`
- fixture mode mirrors the same attachment shape
- timeline images render `preview.url`
- image viewer opens `source.url`
- forwarded image markdown uses the original source URL
- optimistic upload reconciliation transfers attachment state across preview/source hydration

## Verification

Passed:

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e -- --grep "uses preview assets in the timeline and original assets in the image viewer when BetterChat provides both|uploads an image through BetterChat and renders it in the live shell|sends the original image file without browser-side transcoding or recompression"`

## Result

The browser no longer needs to choose between thumbnail quality and original-quality viewing.

- timeline stays fast and appropriately sized with preview assets
- image viewer opens the original uploaded image
- uploads still send the raw file without browser-side transcoding
