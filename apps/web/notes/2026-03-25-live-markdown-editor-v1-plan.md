# Live Markdown Editor V1 Plan

Date: 2026-03-25
Owner: frontend session
Scope: `apps/web/**`

## Product intent

Improve authoring quality in BetterChat without turning the message composer into a document editor.

Target interaction:
- raw markdown remains the source of truth
- users edit markdown directly
- the editor styles markdown semantically while typing
- no separate split-preview is required for v1

Examples:
- `**bold**` stays editable as markdown while the content reads visually as strong text
- headings, blockquotes, links, inline code, and fenced code become easier to scan as users type

## V1 boundary

### In scope

- Replace the plain composer `textarea` with a CodeMirror 6 editor
- Keep send / reply / shortcut / optimistic-send behavior unchanged
- Preserve existing BetterChat markdown payload semantics
- Add calm live styling for:
  - headings
  - bold / italic / strike
  - blockquotes
  - lists
  - links
  - inline code
  - fenced code blocks
- Keep markdown markers visible but quieter than content
- Keep the inline composer compact and low-noise
- Maintain stable selectors for Playwright

### Out of scope for v1

- split preview
- fullscreen long-form compose mode
- inline rendered image widgets inside the editor
- inline rendered block-math widgets inside the editor
- aggressive syntax hiding that risks cursor confusion
- slash commands / autocomplete / mentions overhaul

## Technical approach

Use CodeMirror 6 as an imperative editor surface:
- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/commands`
- `@codemirror/language`
- `@codemirror/lang-markdown`
- `@lezer/highlight`

Integration principles:
- CodeMirror owns the live editable surface
- React does not control DOM text directly on each keystroke
- composer shell state still derives from editor content for send/error UI
- markdown decorations should operate on visible ranges where practical

## Testing plan

### Frontend verification

- existing send/reply/multiline tests remain green
- add e2e coverage for:
  - editor accepts input via stable selector
  - semantic live styling appears for representative markdown
  - send still posts raw markdown correctly

### Build verification

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- targeted e2e first, then full e2e if stable

## Risks

- IME and selection behavior must remain correct
- generated CodeMirror DOM should not break Playwright ergonomics
- styling must stay quiet and enterprise-lean, not code-editor flashy
- bundle growth should be measured after landing
