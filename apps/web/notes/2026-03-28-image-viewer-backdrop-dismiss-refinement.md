# Image Viewer Backdrop Dismiss Refinement

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

The image viewer still has dead backdrop space near the bottom edge:

- open the viewer
- click empty area below / around the image
- some bottom-area clicks do not dismiss the viewer

That makes the close affordance feel inconsistent.

## Root cause
Viewer dismissal classified the whole bottom controls dock as "controls".

That dock spans the viewer width, so clicks in visually empty bottom backdrop space were still landing on the dock container and getting treated as protected control clicks. The result was a bottom dead zone that refused to dismiss the viewer.

## Intended fix

1. Keep the semantic close rule:
   - click on image → keep open
   - click on the actual controls bar → keep open
   - any other viewer click → close
2. Narrow control-hit detection from the full dock container to the actual controls bar.
3. Add Playwright coverage for clicking the lower viewer backdrop area specifically.

## Verification

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "bottom edge of the viewer|keeps the viewer open when clicking the image itself and closes when clicking the background|opens markdown images with visible controls and non-looping navigation"`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- image-viewer.spec.ts`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
