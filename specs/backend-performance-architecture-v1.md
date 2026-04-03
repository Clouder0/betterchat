# Backend Performance Architecture v1

Date: 2026-04-03
Status: Implemented through round 7

## Objective

Reduce API-mode message send and receive latency without changing user-visible behavior.

The fix must address the measured root causes, not mask them with client-side spinners or incidental micro-optimizations.

## Measured problems to solve

1. Create-message HTTP latency is materially higher than direct Rocket.Chat send.
2. Active-room realtime delivery adds substantial backend-side latency even after upstream send succeeds.
3. Fan-out scales poorly with multiple BetterChat websocket connections.
4. Directory watching adds separately measurable cost on top of active-room watching.

## Non-goals

- No product behavior changes
- No contract churn unless the current contract is already effectively unused and removing it reduces hot-path work
- No speculative UI optimization unrelated to measured API-mode bottlenecks
- No regression in auth, permissions, unread state, room visibility, media, replies, threads, or realtime correctness

## Constraints

- BetterChat serves multiple users; no cross-user sharing of authorization-sensitive state
- Realtime and snapshot logic must remain correct for public rooms, private rooms, DMs, hidden rooms, readonly rooms, replies, and threads
- Existing tests must remain green or be updated only when an intentional contract cleanup is proven safe

## Architecture direction

### A. Remove unnecessary synchronous mutation sync from the send hot path

Current create-message and media routes rebuild fresh snapshot sync state before returning.

For create-message/media, the web client currently consumes only the returned canonical message and relies on realtime plus targeted query invalidation for the rest.

Direction:
- stop materializing fresh snapshot sync in create-message and media hot paths
- preserve canonical normalized message response
- rely on realtime or explicit refetch to settle directory / room / timeline state

This is allowed because `CreateConversationMessageResponse.sync` is already optional in the contract.

### B. Coalesce same-session refresh work

The current stream path lets each websocket connection independently invalidate and rebuild snapshots.

Direction:
- introduce shared refresh primitives in the backend for:
  - directory refresh
  - conversation state + timeline refresh
  - thread refresh
- scope coalescing per authenticated BetterChat session identity
- ensure concurrent same-session refresh requests share one invalidation/load cycle

This does not yet require cross-user sharing.

### C. Prefer shared refresh work over per-connection rebuilds

A stronger future direction is a shared realtime/session hub per authenticated BetterChat session.

That refactor is in scope only if the earlier rounds still leave material, benchmarked benefit on the table.

### D. Treat websocket watch version hints as initial sync hints, not steady-state refresh triggers

The current web client feeds freshly updated directory / conversation / timeline versions back into `watch-*`.

That creates redundant backend refresh work after the same websocket connection has already received the newer snapshots.

Direction:
- keep version hints for initial watch and reconnect only
- do not replay `watch-directory` / `watch-conversation` on every pushed version change
- harden the backend stream to no-op exact same-version rewatchs on already watched directory / conversation / thread scopes

### E. Cache only stable auth metadata, briefly and explicitly

After rounds 1-3, the remaining send-path floor is largely route-local authorization/context loading.

Measured Rocket.Chat endpoint costs on the seeded stack:
- `permissions.listAll`: about 10 ms
- `rooms.info`: about 4 ms
- `me`: about 2-3 ms
- `subscriptions.getOne`: about 2-3 ms
- `settings.public`: about 2-3 ms

Direction:
- add a bounded short-lived cache only for stable metadata:
  - `getMe(session)`
  - `getPermissionDefinitions(session)`
  - `getPublicSettings(settingIds)`
- keep the cache explicit, local to `RocketChatClient`, and failure-safe
- do **not** broaden this to room, subscription, directory, timeline, or unread data without fresh evidence

### F. Prefer targeted directory entry refresh when realtime already identifies the changed room

After round 4, the remaining large receive-side cost is no longer active room refresh. The clearest residual hotspot is **distinct-session sidebar watching**.

Direction:
- extend realtime sidebar change callbacks to carry the changed `conversationId` when Rocket.Chat provides it
- add a targeted directory-entry refresh path for the known room instead of rebuilding the full directory snapshot
- preserve the existing full-directory refresh fallback when:
  - the room id is unknown
  - a force-resync is required
  - the client has no remembered directory baseline yet

Constraints:
- preserve exact directory ordering/version semantics
- preserve remove vs upsert behavior
- preserve per-user unread / mention / reply / thread activity semantics
- keep the optimization session-local; do not cross-share authorization-sensitive state across users

### G. Reuse truly stable metadata across distinct sessions when identity or global scope makes it safe

After round 5, the remaining distinct-session active-room cost still includes stable metadata reads that are duplicated across separate auth tokens.

Direction:
- widen reuse only where the data is actually stable enough:
  - `permissions.listAll` should be cached globally per backend process / upstream client
  - `getMe` may be cached per stable user identity rather than per auth token
- keep failure handling explicit and TTL-bounded
- do **not** generalize this to room info, subscriptions, unread state, directory entries, or timelines

Constraints:
- never share authorization-sensitive room/subscription state across different users
- if a cache entry can differ by user, key it by user identity, not by token
- keep the TTL short enough that profile/role/display-name edits still converge quickly

### H. Coalesce stream refresh work across distinct sessions of the same user

After round 6, the remaining bounded backend gap is still on the **same-user distinct-session** stream refresh path.

Current problem:
- same-session stream refreshes already coalesce well, but distinct auth tokens for the same BetterChat user still rebuild the same directory / conversation / thread state independently
- the clean current benchmarks still show a material same-user gap on distinct-session fan-out, especially on active-room watching

Direction:
- keep steady-state reads and normal HTTP snapshot access session-scoped
- run the existing per-connection upstream realtime wait/auth steps first
- then share only the **in-flight stream refresh rebuild** across distinct auth tokens for the same user
- keep auth failure handling explicit: if a shared refresh fails because one token is invalid, other same-user sessions must retry on their own token rather than inheriting that auth failure

Constraints:
- never share refresh work across different users
- do not turn general snapshot reads into global or user-wide memoized state
- preserve logout / token invalidation semantics for the specific cleared session
- avoid broadening this into longer-lived user-scoped snapshot caches without new evidence

## Acceptance criteria

### Performance

Measure before/after with the existing API-mode benchmark scripts.

Minimum success criteria for this pass:
- materially reduce BetterChat create-message latency
- materially reduce same-session watcher fan-out cost
- preserve realtime delivery behavior

### Correctness

Must preserve:
- send / upload / edit / delete / reaction behavior
- reply and thread behavior
- room visibility and unread behavior
- websocket watch semantics and resync behavior
- integration and E2E behavior

### Verification

Required checks after each round:
- backend unit tests
- backend integration tests
- web tests/typechecks/build if touched
- live E2E tests for affected flows
- perf scripts before/after comparison

## Round structure

### Round 1
- remove unnecessary create-message/media sync materialization
- add tests covering the adjusted hot path contract and behavior
- benchmark and compare

### Round 2
- add same-session refresh coalescing for stream-driven directory/conversation/thread refresh
- add focused unit tests for coalescing behavior
- benchmark and compare

### Round 3
- eliminate steady-state watch-hint replay churn and add backend no-op guards for exact same-version rewatchs
- validate with unit tests, targeted live E2E, and perf recheck

### Round 4
- add bounded short-lived caching for stable auth metadata
- re-benchmark send, active receive, and fan-out paths
- stop if the remaining gap is small and the next wins require materially larger architecture work

### Round 5
- if data still justifies it, prefer targeted sidebar entry refresh for known room changes before any larger refactor

### Round 6
- if data still justifies it, refine stable metadata cache scope for distinct-session reuse

### Round 7
- only if data still justifies it, add same-user in-flight stream refresh coalescing before considering a larger realtime/session-hub refactor

## Stop condition

Stop when the next refactor is unlikely to buy meaningful measured improvement relative to complexity and regression risk.
