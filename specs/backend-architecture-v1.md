# BetterChat Backend Architecture v1

Date: 2026-03-25
Status: Active baseline
Target upstream: Rocket.Chat `7.6.0`

## Purpose

Define how the BetterChat backend should be structured for the first implementation cycle.

The backend is the compatibility edge between:
- BetterChat web
- Rocket.Chat upstream

## Backend role

The backend should be:
- thin
- explicit
- protocol-oriented
- testable

It should normalize Rocket.Chat behavior where needed, but it should not become a large business-logic layer in cycle 1.

## Core principle

The browser talks only to BetterChat backend.

BetterChat backend talks to Rocket.Chat using:
- REST for bootstrap, snapshots, and mutations
- media/avatar/file proxying where needed
- BetterChat-owned realtime websocket outward
- Rocket.Chat DDP inward for live event intake
- versioned HTTP snapshots plus websocket invalidation outward

## Responsibilities

Backend owns:
- session normalization
- Rocket.Chat auth transport
- public bootstrap aggregation
- authenticated bootstrap aggregation
- sidebar snapshot normalization
- room metadata normalization
- timeline snapshot normalization
- avatar and image proxy support
- reproducible integration environment
- compatibility and integration testing

Backend does not own:
- frontend grouping presentation
- design-system decisions
- ad hoc product state beyond session and normalization concerns

## Session model

Recommended cycle-1 model:
- browser submits credentials to BetterChat backend
- backend performs upstream Rocket.Chat login
- backend stores or encapsulates upstream session material
- browser receives a BetterChat-owned session cookie

Rules:
- browser should not manage Rocket.Chat `X-User-Id` / `X-Auth-Token` directly
- frontend should not need to know upstream auth transport details
- BetterChat may encapsulate upstream session material inside an encrypted httpOnly cookie rather than introducing a separate session service
- if the implementation changes between encrypted cookie state and a server-side session store, keep the browser contract the same

## Upstream strategy

Preferred upstream boundary for cycle 1:
- `GET /api/info`
- `GET /api/v1/settings.public`
- `GET /api/v1/settings.oauth`
- `POST /api/v1/login`
- `GET /api/v1/me`
- `POST /api/v1/logout`
- `GET /api/v1/subscriptions.get`
- `GET /api/v1/rooms.get`
- `GET /api/v1/subscriptions.getOne`
- `GET /api/v1/rooms.info`
- `POST /api/v1/rooms.open`
- `POST /api/v1/rooms.hide`
- `GET /api/v1/channels.messages`
- `GET /api/v1/groups.messages`
- `GET /api/v1/im.messages`
- `GET /api/v1/chat.getMessage`
- `GET /api/v1/chat.getThreadMessages`
- `POST /api/v1/chat.sendMessage`
- `POST /api/v1/subscriptions.read`
- `POST /api/v1/subscriptions.unread`
- `POST /api/v1/rooms.favorite`
- `POST /api/v1/chat.update`
- `POST /api/v1/chat.delete`
- `POST /api/v1/chat.react`
- `POST /api/v1/rooms.media/:rid`
- `POST /api/v1/rooms.mediaConfirm/:rid/:fileId`
- Rocket.Chat DDP `/websocket`
- avatar / media routes as proxied reads

Avoid Meteor-method dependence unless the public contracts prove insufficient and the gap is documented.
`chat.syncMessages` can remain available for later incremental work, but it is not the current initial-snapshot path.

## Suggested backend API surface

Cycle-1 BetterChat endpoints should be explicit and frontend-oriented.

Suggested initial endpoints:

- `GET /healthz`
- `GET /readyz`
- `GET /api/public/bootstrap`
- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/workspace`
- `GET /api/rooms`
- `GET /api/rooms/:roomId`
- `PUT /api/rooms/:roomId/visibility`
- `PUT /api/rooms/:roomId/favorite`
- `PUT /api/rooms/:roomId/read-state`
- `GET /api/rooms/:roomId/timeline`
- `GET /api/rooms/:roomId/messages/:messageId/context`
- `GET /api/rooms/:roomId/threads/:threadId/timeline`
- `POST /api/rooms/:roomId/messages`
- `POST /api/rooms/:roomId/threads/:threadId/messages`
- `PATCH /api/rooms/:roomId/messages/:messageId`
- `DELETE /api/rooms/:roomId/messages/:messageId`
- `POST /api/rooms/:roomId/messages/:messageId/reactions`
- `POST /api/rooms/:roomId/images`
- `POST /api/rooms/:roomId/threads/:threadId/images`
- `GET /api/realtime`
- `GET /api/media/*`

## Normalization rule

The backend should return BetterChat contracts, not upstream Rocket.Chat payloads with minimal wrapping.

That means:
- flatten and rename fields where it materially improves frontend clarity
- keep room kinds explicit
- make favorite and unread semantics explicit
- keep room visibility mutations explicit rather than hidden inside snapshot reads
- provide timeline message shapes suitable for UI rendering
- normalize reply preview data for both main-timeline quote replies and thread parent previews
- normalize reactions into a frontend-safe list shape
- expose snapshot-sync versions on mutations instead of raw upstream mutation payloads

## Internal structure

Suggested `apps/backend/src/` structure:

```text
src/
  server.ts
  config/
  routes/
  middleware/
  auth/
  upstream/
  services/
  contracts/
  test/
```

### Upstream layer

Owns:
- Rocket.Chat REST client
- auth headers/cookies
- low-level upstream error mapping
- strict validation of any proxied media path before it is sent upstream

### Service layer

Owns:
- public bootstrap assembly
- authenticated bootstrap assembly
- room-list normalization
- room details normalization
- timeline normalization
- structured DM peer presence normalization for sidebar/details snapshots
- media proxy routing decisions

### Route layer

Owns:
- request parsing
- response shaping
- error envelope consistency

## Error model

Backend should return explicit BetterChat errors with stable codes.

At minimum:
- `UNAUTHENTICATED`
- `UPSTREAM_UNAVAILABLE`
- `UPSTREAM_REJECTED`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `UNSUPPORTED_UPSTREAM_BEHAVIOR`

Do not leak raw upstream error shapes to the frontend by default.

## Operational behavior

Cycle-1 backend operations should stay explicit and low-complexity.

- expose `GET /healthz` for local process liveness
- expose `GET /readyz` for real upstream readiness
- include a stable `x-request-id` header on both success and error responses
- coalesce concurrent identical snapshot loads in-flight, but do not rely on stale result caching as part of the public consistency model

## Testing strategy

Backend testing must be reproducible and script-driven.

### Unit tests

Use `bun test` for:
- normalization logic
- envelope shaping
- parsing / validation helpers

### Integration tests

Use a real Rocket.Chat `7.6.0` stack for:
- login
- bootstrap
- room-list load
- room open
- timeline load
- avatar/image proxy behavior

### Environment

Use Podman-based scripts so the environment is:
- repeatable
- disposable
- reviewable

No manual setup should be required for the core test path.

## Harness ownership

For the first cycle, backend owns:
- stack scripts
- fixture bootstrap scripts
- backend integration tests
- logs and artifacts needed to debug compatibility failures

This is appropriate because the backend is the compatibility boundary under test.

## Realtime policy for cycle 1

Cycle-1 realtime uses a BetterChat-owned websocket endpoint for events and keeps HTTP as the snapshot/command plane.

Current shape:
1. browser connects to BetterChat websocket
2. backend authenticates using the BetterChat session cookie
3. backend opens an upstream DDP websocket with the stored Rocket.Chat auth token
4. backend subscribes to the minimum useful stream families:
   - `notify-user/*` for sidebar changes and forced logout
   - `room-messages/*` for watched-room message pushes
   - `notify-room/*` for delete and user-activity updates
   - `user-presence` for DM peer presence updates
5. backend materializes versioned BetterChat snapshots on demand from REST
6. `watch-room` may include current room/timeline versions so the backend can suppress a redundant initial invalidate
   `watch-thread` may include current thread version so the backend can suppress a redundant initial invalidate
7. on relevant DDP events, backend refreshes the affected snapshot versions and emits BetterChat room-list/room/thread/session/typing events
   - thread-only replies can still invalidate the main room timeline when the visible parent message's thread summary changes
   - DM peer presence updates invalidate room-list snapshots and any watched DM room details, but do not force room-timeline or watched-thread refreshes on their own
8. after DDP reconnect, backend re-subscribes and emits fresh room-list, watched-room, or watched-thread invalidations so clients resync from HTTP snapshots
9. frontend refetches BetterChat REST snapshots on invalidate and uses `typing` as-is

Image upload handling:
- BetterChat validates upload target/shape before consuming the full multipart body when possible
- accepted image bodies are spooled to temporary files instead of being fully buffered in backend memory
- temp upload artifacts are cleaned after success, rejection, or upstream failure

`ready` should only be emitted after step 4 completes for the mandatory user streams.

Why:
- keeps the browser on BetterChat contracts only
- gives immediate push for typing, incoming messages, sidebar changes, DM presence changes, and upstream token/session invalidation
- keeps HTTP as the canonical data plane and websocket as the event plane
- makes resync explicit with resource versions instead of hidden backend polling

Still deferred:
- exact Rocket.Chat DDP parity for ordering and replay semantics
- richer patch-complete message/sidebar payloads
- thread-scoped typing and other secondary stream families that are not yet needed for the current MVP surface

## Mutation response policy

Room and message mutation endpoints should:
- use BetterChat-owned request and response shapes
- avoid tunneling raw Rocket.Chat mutation responses to the browser
- return authoritative normalized entities where useful
- return BetterChat snapshot versions for the affected resources so the client can refetch canonical snapshots deterministically

This keeps the HTTP command plane aligned with the invalidate-first realtime model.

## Pagination policy

Room and thread history endpoints may use BetterChat-owned opaque cursors that are backed by upstream pagination state.

Rules:
- cursors are not part of the upstream contract
- each response page is normalized oldest -> newest
- `nextCursor` always means older history is available
- the current pagination design is intended for interactive backfill, not full archival sync semantics
