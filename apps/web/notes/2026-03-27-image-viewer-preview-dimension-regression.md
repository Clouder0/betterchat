# Image Viewer Preview-Dimension Regression

Date: 2026-03-27
Owner: frontend session
Scope: BetterChat web image viewer
Status: completed

## Problem

User reported a long-standing regression:

- open an attachment image
- collapse the message
- expand it again
- reopen the image

The viewer could reopen with a minimized / preview-like presentation instead of
the intended full-source presentation.

## Root cause

Timeline attachment rendering passed:

- `viewerWidth = source.width ?? preview.width`
- `viewerHeight = source.height ?? preview.height`

So when the backend omitted source dimensions, the viewer was incorrectly given
preview dimensions and never had a chance to resolve the true source dimensions
itself.

## Fix

- extract timeline attachment media mapping into a small helper
- keep timeline rendering on preview dimensions
- pass viewer dimensions only from `source`
- when source dimensions are missing, leave them `undefined` so the image viewer
  resolves the natural dimensions from the source asset

## Regression coverage

- unit test for attachment media mapping
- fixture E2E with a square preview asset and a wide source asset
- E2E explicitly covers collapse -> expand -> reopen

## Verification

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "reopens attachment images with the full source aspect after collapsing and re-expanding a long image message"`
