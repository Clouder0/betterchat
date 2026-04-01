# BetterChat Project Foundation

## Goal

Build a new standalone web client for Rocket.Chat that is compatible with Rocket.Chat `7.6.0`.

## Deployment context

- Rocket.Chat is deployed internally in an enterprise LAN environment.
- BetterChat will also be hosted internally.
- The Rocket.Chat server is owned and maintained by another team.
- BetterChat must not require server modifications for normal operation.

## Product position

- BetterChat is an optional internal client for our own team.
- It is not a fork of Rocket.Chat server.
- It does not need to replace the official web client for every user on day one.
- It must coexist with users who continue using the official Rocket.Chat web client.

## Non-goals

- Forking or replacing the Rocket.Chat server
- Depending on server-side modifications for basic operation
- Matching every Rocket.Chat UI behavior in the first iteration
- Rebuilding the entire Rocket.Chat product surface before the core chat workflow works well
- Requiring all users in the deployment to migrate to BetterChat

## Compatibility principles

- The client should work against an existing Rocket.Chat deployment.
- Browser traffic should go through a BetterChat-controlled backend/proxy by default.
- The project should prefer stable public surfaces:
  - REST endpoints
  - DDP subscriptions and streamer events
  - public settings and login provider endpoints
- Internal Meteor/Minimongo behavior may inform compatibility, but it should not become the primary client contract unless required.

## Experience goals

- The client should feel smooth, modern, and responsive in daily use.
- Performance matters at the interaction level:
  - fast room switching
  - fast timeline updates
  - low-friction message sending
  - predictable realtime behavior
- The goal is not theoretical maximum performance; it is consistently good perceived performance.

## Current architecture direction

- Frontend: standalone web app
- Backend: BetterChat service that fronts Rocket.Chat
- Upstream communication:
  - REST proxying for snapshots and mutations
  - DDP/WebSocket proxying for realtime updates
  - media/avatar/file proxying where cross-origin behavior is inconsistent

## Selected tech stack

- Workspace and runtime: `Bun`
- Backend: `Hono + TypeScript`
- Frontend: `React + TypeScript + Vite`
- Router: `TanStack Router`
- Server state: `TanStack Query`
- Validation and shared contracts: `Zod`
- UI primitives: `Radix Primitives`
- Styling: `CSS Modules + CSS variables`
- Virtualization: `TanStack Virtual`
- Integration testing: `Playwright`

Detailed rationale lives in `specs/tech-stack-v1.md`.

## Why the backend/proxy exists

- Rocket.Chat REST CORS is disabled by default.
- Media and avatar access rules differ from the REST API.
- A backend boundary gives us one place to normalize auth, uploads, avatar access, and realtime reconnection behavior.

## Delivery approach

- Spec first
- Integration harness early
- TDD for new BetterChat backend/frontend behavior
- End-to-end tests against a pinned Rocket.Chat `7.6.0` environment
- Agile, incremental delivery
- Core functionality first, broader parity later

## Initial product focus

The first BetterChat iterations should prioritize the common daily workflow:
- login
- bootstrap current user and workspace settings
- room list and room open
- room timeline
- send message
- edit and delete message
- unread and read state
- typing and basic realtime updates
- uploads and avatars

## Open decisions

- Transparent upstream proxy first vs. opinionated BFF first
- Same-origin deployment support vs. separate-origin-only support
- MVP scope for v1:
  - login
  - sidebar
  - room timeline
  - send message
  - edit/delete/react/thread
  - uploads
  - typing/read state
