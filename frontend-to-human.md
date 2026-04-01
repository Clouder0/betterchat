# Frontend To Human

Date: 2026-03-31
Source: `frontend-tasks.md`

## Status

The `frontend-tasks.md` pass is complete, including the mention-completeness task.

## Implemented

1. Notifications
   - Browser notifications now honor subscribed-vs-normal room preference, active-room attended state, and hidden / unfocused page state.
   - Hidden active-room notifications now trigger from `lastActivityAt` advancement, which closes the earlier active-room background gap.
2. Readonly room UX
   - Readonly rooms now fully disable the composer and show `此房间不允许发送消息。` in the composer footer.
3. Header subscribe control
   - The room subscribe toggle is now in the header, between the title region and the rest of the header actions.
4. Link hover feedback
   - Main-timeline markdown links now have clearer hover feedback without heavy visual noise.
5. Global motion toggle
   - Added one explicit motion preference in settings.
   - It is persisted client-side and applied document-wide through `html[data-motion='on'|'off']`.
   - Timeline jump animations and CSS transitions both respect that single contract.
6. Older-history smoothness / performance
   - Older history now uses an explicit two-phase path: prefetch early, then reveal the prefetched page before the viewport fully reaches the top edge.
   - The preload state is now owned explicitly in `AppShell` instead of being inferred indirectly from query cache behavior, which removed the old "warm request but still top-hit reveal" mismatch.
   - Prepend restoration is stable and no longer drops the viewport to the top on prefetched loads.
   - Older-history loading is now gated to deliberate upward motion instead of any threshold re-entry.
7. Mention integration
   - Composer mention suggestions now come from backend `mention-candidates`, including backend-owned ordering and `insertText`.
   - Timeline inline mention interaction now resolves against backend `participants`, so users who never authored in the loaded timeline still resolve correctly.
   - Fixture parity now includes participant rosters, special mentions for non-DM rooms, and participant seeding for newly created fixture DMs.

## Product answer

1. Left-sidebar right-click panel
   - I recommend not adding it for now.
   - Current room actions are already covered by the header and right sidebar.
   - A sidebar context menu would duplicate controls and increase UI weight without enough user value.

## Verification

1. Passed:
   - `env BUN_TMPDIR=/tmp bun run test:web`
   - `env BUN_TMPDIR=/tmp bun run typecheck:web`
   - `env BUN_TMPDIR=/tmp bun run build:web`
2. Fixture Playwright coverage passed for:
   - subscription priority behavior
   - history restore / prefetch behavior
   - motion-off behavior
   - markdown link hover behavior
3. Live API Playwright coverage passed for:
   - header subscribe toggle and browser notifications
   - readonly composer UX
   - older-history restore and prefetch
   - older-history pre-reveal before the hard top edge
   - motion-off
   - markdown link hover
   - inline mention quick panel from a backend-backed participant target
   - backend mention-candidate suggestions and special mentions

## Remaining frontend follow-up

1. The main remaining performance risk is bundle size.
   - The build still warns about large `LiveMarkdownEditor` and main `index` chunks.

## Additional note

1. Readonly room bottom-lane fix
   - Readonly rooms no longer render the writable sendbox UI.
   - The shell now swaps that region to a compact readonly notice and removes the resize handle in readonly rooms.
   - Added fixture parity for this path plus fixture/live Playwright coverage.
   - Room-switch loading no longer flashes a fake sendbox lane when leaving a readonly room for a writable room; the loading shell now uses a neutral bottom boundary instead.
