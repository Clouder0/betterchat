# Deleted Message Canonical Persistence v2

Date: 2026-04-07
Status: proposed
Scope: `apps/backend/src/**`, `tests/**`

## Design goal

Make deleted-message behavior a durable, backend-owned part of BetterChat's canonical snapshot model.

This should survive:

- refetch
- browser refresh
- backend restart

And it should do so through one consistent backend read path, not scattered snapshot-specific merge logic.

## First-principles truth

For BetterChat, deletion is not "message absence plus UI workaround".

Deletion is a **message lifecycle state transition**:

- active message
- deleted tombstone

If BetterChat's canonical contract promises tombstones, that state must exist in BetterChat-owned canonical backend state.

## Code-grounded constraints

Review of the current codebase shows four important truths:

### 1. Deleted-state normalization is already good

`apps/backend/src/conversation-domain.ts` already projects deleted semantics from:

- `message.t === 'rm'`
- `message._deletedAt`

and already ensures:

- `state.deleted === true`
- `state.edited === false` for deleted messages
- deleted reply parents render `该消息已删除。`

So the correct seam remains: feed better canonical upstream-shaped data into existing normalization.

### 2. The current lookup seams are still upstream-first and incomplete

Today these paths still depend on upstream message existence:

- timeline page collection in `conversation-snapshots.ts`
- message-context anchor lookup via `client.findMessage(...)`
- thread-root lookup via `getThreadRootMessage(...)`
- helper lookups like `getRoomMessage(...)`

This means v1 fixes visible timeline persistence for BetterChat-initiated deletes, but deleted anchors / roots are not yet modeled through one canonical source.

### 3. Realtime external deletes only carry ids

`apps/backend/src/upstream-realtime.ts` receives:

- `${roomId}/deleteMessage`
- `${roomId}/deleteMessageBulk`

but those events only tell us that deletion happened, not the full original message payload.

So BetterChat cannot recreate the same author lane / authored timestamp for an externally deleted message unless it has already remembered enough message identity locally.

### 4. Current pagination is offset-based

`apps/backend/src/pagination.ts` exposes cursors as raw upstream offsets.

That works for pure upstream history, but it is not a fully correct canonical cursor once BetterChat injects additional tombstones into the timeline ordering.

So a complete design must eventually evolve the cursor model.

## Recommended architecture

### 1. Durable canonical message ledger

Do not persist only tombstones.

Persist a **minimal message identity ledger** for messages BetterChat has observed, with optional deleted state.

Recommended table-level mental model:

- one row per `(conversationId, messageId)`
- stores the minimal envelope needed to later synthesize a deleted message
- optionally stores deleted-state metadata when BetterChat knows the message is deleted

Recommended stored envelope:

- message id
- conversation id
- authored timestamp
- author identity
- thread metadata needed for layout (`tmid`, `tshow`, `tcount`, `tlm`)
- observation timestamp

Recommended deleted-state metadata:

- `deletedAt`
- `deletedSource`
- `deletedObservedAt`

This is more unified than a tombstone-only store because external delete events only provide ids; BetterChat needs previously observed message identity to reconstruct a stable tombstone.

This is also more reductive than a full local message database because it stores only the minimum metadata needed for canonical deleted-state recovery.

Recommended storage engine:

- SQLite

Reason:

- explicit
- durable
- battle-tested
- avoids inventing ad-hoc file persistence
- good enough for single-node BetterChat today
- adapter can later be swapped for another backend

### 2. One canonical message source

Do **not** let each snapshot builder own delete-specific merge behavior forever.

Instead introduce one backend seam, conceptually:

- `CanonicalConversationMessageSource`

Responsibilities:

- fetch upstream room history / parents / context pages
- record observed upstream messages into the ledger
- materialize deleted tombstones from ledger rows when upstream no longer returns the message
- return canonical `UpstreamMessage[]` and canonical single-message lookups before normalization

Then these code paths depend on one primitive instead of custom fallback logic:

- timeline snapshot
- message-context anchor lookup
- reply-parent lookup
- thread-root lookup where feasible
- route-level canonical message lookup

### 3. Preserve the current best runtime primitive: synthetic `UpstreamMessage`

Do not invent a BetterChat-only tombstone DTO.

At runtime, synthesize deleted state as an upstream-shaped message:

- same `_id`
- same `rid`
- same `ts`
- same author
- `t = 'rm'`
- `msg = ''`
- cleared attachments / reactions / rich-content fields

This keeps normalization and rendering unified.

Important refinement:

- persist the **minimal ledger envelope**
- synthesize the deleted `UpstreamMessage` on read

instead of persisting large arbitrary upstream JSON blobs for every observed message.

This is safer, smaller, and more explicit.

### 4. Write path and dual-write discipline

On BetterChat delete success:

1. fetch authoritative pre-delete message
2. upsert its ledger envelope
3. call upstream delete
4. mark the ledger row as deleted
5. invalidate / rebuild snapshots

If later BetterChat ingests upstream realtime delete events from other clients, they write into the same overlay store.

Why this order:

- writing the envelope before delete is always safe; it is just an observation
- deleted state is only marked after upstream success
- if BetterChat crashes between steps 3 and 4, a later external delete signal can still be reconciled from the saved envelope

### 5. Reconciliation rules

Canonical history should be built from:

- upstream visible messages
- upstream-native deleted messages (`t = 'rm'`) if present
- BetterChat ledger-backed deleted tombstones when upstream no longer returns the row

If upstream later starts returning the same message as a tombstone canonically, BetterChat may keep or compact its local overlay; behavior should remain identical.

### 6. Read-through observation policy

To support external deletes elegantly, BetterChat should remember message envelopes whenever it already legitimately sees a message:

- conversation timeline reads
- message-context reads
- thread timeline reads
- `findMessage(...)` lookups used by mutations
- successful send / update / upload responses

This is a read-through/write-through ledger, not a speculative cache.

### 7. Cursor evolution

For a fully correct canonical timeline, BetterChat should eventually move away from exposing a raw-offset-only cursor.

Recommended direction:

- keep cursor opaque
- evolve payload from `{ offset }`
- toward something like `{ offsetHint, beforeAuthoredAt, beforeMessageId }`

Rationale:

- `offsetHint` keeps upstream fetching efficient
- `(beforeAuthoredAt, beforeMessageId)` defines the canonical upper bound for overlay/tombstone membership
- later pages can then include deleted tombstones without duplication or silent skips

This is the clean path to making tombstones correct on all pages, not just the initial page.

### 8. Message-context semantics

If a deleted message still exists canonically in BetterChat, permalink/context behavior should follow that same truth.

Therefore the canonical message source should support:

- `findCanonicalMessage(conversationId, messageId)`

which:

- prefers upstream when available
- falls back to a ledger-backed deleted tombstone when upstream no longer has the row

Then message-context anchor lookup can remain canonical after deletion.

### 9. Explicit boundary: thread-root resurrection is harder

The upstream thread endpoint may itself require the thread root message to still exist upstream.

So BetterChat can likely support:

- deleted thread-root identity rendering if it has the envelope

but cannot guarantee full thread-history recovery after an upstream hard-delete of the root without a larger local materialization of thread history.

That boundary should stay explicit instead of being hidden.

## Why this is better than the current v1

v1 is correct in direction, but still transitional:

- merge logic is still snapshot-local
- persistence is in-memory only
- restart loses tombstones
- external delete recovery is not possible without remembered message identity
- deleted message-context anchors still depend on upstream existence

v2 makes the abstraction explicit:

- one canonical source of deleted-message truth
- one durable persistence boundary
- one message-identity ledger that makes external delete recovery possible
- one read-model seam reused across timeline, context, and lookup paths

## Why not simply depend on Rocket.Chat settings

Because BetterChat semantics should be explicit, not accidental.

Depending on upstream `Message_ShowDeletedStatus` alone would mean:

- behavior changes when upstream settings drift
- behavior is deployment-dependent
- BetterChat contract is no longer fully owned by BetterChat

Upstream tombstones should be accepted as an input, not trusted as the only guarantee.

## Recommended phased rollout

### Phase 1

- replace in-memory tombstone map with durable SQLite-backed ledger
- keep current BetterChat-initiated delete behavior
- preserve current tests
- add restart-survival coverage

### Phase 2

- extract shared canonical message-source seam
- route timeline/context/parent lookups through it
- add ledger observation on normal reads and successful writes

### Phase 3

- materialize external delete tombstones from realtime delete ids when a ledger envelope exists
- optionally consume `chat.syncMessages` deleted ids for catch-up
- add pruning / retention policy for non-deleted envelopes

## Acceptance criteria

- deleted tombstones survive backend restart
- timeline, context, and reply-parent rendering all use the same canonical source
- BetterChat can reconstruct deleted tombstones from previously observed message identity
- upstream-native `rm` and BetterChat ledger-backed tombstones normalize identically
- tests cover unit, integration, and live API-mode browser restart/reload paths
