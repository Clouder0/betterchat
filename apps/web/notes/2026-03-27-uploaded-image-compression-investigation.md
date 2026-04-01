# Uploaded Image Compression Investigation

Date: 2026-03-27
Owner: frontend session
Scope: frontend investigation only
Status: completed

## Question

User reported that uploaded images look badly compressed.

Need to determine whether the browser client is:

- transcoding or recompressing before upload
- rendering the wrong asset afterward
- or whether the backend / upstream media contract is exposing a thumbnail instead of the original upload

## Frontend findings

The browser upload path is raw:

- `betterChatApi.uploadImage()` sends the original `File` via `FormData`
- no canvas path
- no `toBlob`
- no `image/webp`
- no resize / quality transform

Existing API Playwright regression already verifies this:

- `tests/e2e/api-integration.spec.ts`
- test: `sends the original image file without browser-side transcoding or recompression`

## Live probe result

Probe uploaded a generated PNG through the real BetterChat backend + Rocket.Chat stack.

Observed:

- uploaded file: `probe-image.png`
- uploaded mime: `image/png`
- uploaded bytes: `456726`
- BetterChat attachment URL returned: `/api/media/file-upload/<thumb-id>/probe-image.png`
- fetched media bytes: `223672`
- fetched media decoded size: `360x360`

So the media currently shown to the frontend is not the original uploaded asset.

## Upstream Rocket.Chat raw message evidence

Direct Rocket.Chat message payload for the same upload contained both:

- original file:
  - `file._id = 69c65137c0a0ed496e6e24c8`
  - `title_link = /file-upload/69c65137c0a0ed496e6e24c8/probe-image.png`
  - size `456726`
- generated thumbnail:
  - `files[1]._id = 69c65137c0a0ed496e6e24c9`
  - `image_url = /file-upload/69c65137c0a0ed496e6e24c9/probe-image.png`
  - size `223672`
  - `image_dimensions = 360x360`

## BetterChat backend normalization issue

Current backend normalization prefers:

- `attachment.image_url || attachment.title_link`

That means BetterChat is exposing Rocket.Chat's thumbnail URL first.

Because the current contract only exposes a single attachment `url`, the frontend has no clean way to choose the original asset instead.

## Conclusion

This is not a browser-side compression bug.

It is a backend / contract issue:

- BetterChat currently surfaces the thumbnail URL as the canonical image attachment URL
- frontend then faithfully renders that downscaled image

## Recommended backend follow-up

Two valid directions:

1. Minimal fix
   - prefer `title_link` over `image_url` for `ConversationAttachment.url`
   - likely enough to restore original uploaded quality immediately

2. Better contract
   - expose both preview and original URLs explicitly
   - use preview in the timeline
   - use original in the image viewer

The current single-URL contract cannot express that distinction cleanly.

## Verification

- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e -- --grep "sends the original image file without browser-side transcoding or recompression"`
- live manual probe against local BetterChat + Rocket.Chat stack
