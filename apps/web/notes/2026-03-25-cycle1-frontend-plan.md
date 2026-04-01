# Frontend Cycle 1 Plan

Date: 2026-03-25
Owner: frontend session

## Scope

Land the first real product shell while preserving review routes:
- `/login`
- `/app`
- `/app/rooms/$roomId`

## Constraints carried into implementation

- Browser consumes BetterChat contracts only.
- Backend is still scaffold-only, so fixture mode is the default execution path for this session.
- Design language stays aligned with the frozen shell/content demo.
- TanStack Query owns server-derived state.
- Plain React state owns UI-only concerns.

## Planned slices

1. Add contract-backed frontend data layer with explicit fixture mode.
2. Add small pure helpers for sidebar grouping/sorting/search and cover them with Bun tests first.
3. Restructure routing so review routes stay inside the review frame while product routes get a dedicated app shell.
4. Implement login page against `public/bootstrap` + `session/login` contracts.
5. Implement authenticated app shell:
   - grouped sidebar
   - jump-to-room search
   - room route navigation
   - right room-info sidebar toggle
6. Implement timeline snapshot rendering:
   - unread divider
   - rich markdown/code/quote/math/images
   - reply jump-to-original
   - long-message collapse
7. Refine room-level affordances inside the product shell:
   - room-title toggle for the info sidebar
   - local favorite toggle UX in fixture mode and default frontend mode
   - persist UI-only preference state without inventing backend contracts
8. Land live markdown editor v1 in the composer:
   - raw markdown remains canonical
   - source-preserving semantic styling while typing
   - no split preview and no inline media/math widgets yet
9. Verify `build:web` and targeted frontend tests.

## Known risks before coding

- Contracts include `open` on sidebar entries but do not yet define an explicit open-room mutation; frontend will avoid inventing one.
- Contracts expose favorite read state but do not yet define a favorite mutation; frontend may ship a local-only override as an interim UX layer and record the gap in memory.
- A CodeMirror-based composer materially increases bundle weight; v1 is acceptable, but code-splitting or lazy loading may be needed in a follow-up slice.
- Backend is not ready yet, so real-endpoint integration remains blocked after fixture mode is complete.
