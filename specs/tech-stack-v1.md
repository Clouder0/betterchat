# BetterChat Tech Stack v1

Date: 2026-03-24
Target upstream: Rocket.Chat `7.6.0`

## Purpose

Lock the initial BetterChat technology stack so implementation can start without reopening basic platform choices.

This is the v1 stack for the first iterations of BetterChat.

## Design goals behind the stack

- Keep the architecture explicit.
- Optimize for a smooth chat SPA, not a generic web app.
- Use tools that fit Bun well.
- Keep the backend thin and protocol-oriented.
- Keep the frontend modern, type-safe, and easy to evolve incrementally.
- Avoid unnecessary framework surface area.

## Locked choices

### Workspace and runtime

- Monorepo and package manager: `Bun`
- Script runner: `Bun`
- Backend runtime: `Bun`

## Backend

- Framework: `Hono`
- Language: `TypeScript`

### Why Hono

- Thin HTTP abstraction
- Explicit request and response handling
- Good Bun support
- Good fit for a proxy or BFF boundary
- Less framework coupling than more opinionated Bun-native alternatives

### Why not Elysia for v1

- Elysia is a valid Bun-native option
- but BetterChat backend is primarily a protocol edge and proxy layer
- Hono is the safer fit for explicit HTTP, auth, upload, and websocket boundary work

## Frontend

- Framework: `React`
- Language: `TypeScript`
- Build tool and dev server: `Vite`

### Why not a full-stack React framework

- BetterChat already needs a dedicated backend/proxy service
- SSR is not the main product need
- the hard problems are chat UX, realtime state, and protocol compatibility
- a frontend-only SPA keeps responsibilities clearer

## Routing

- Router: `TanStack Router`

### Why TanStack Router

- Strong TypeScript integration
- Better typed route params and search params
- Good fit with SPA-style URL state
- Pairs naturally with `TanStack Query`
- Better suited than `React Router` for this application's type-driven frontend needs

## Data and state

- Server state and async caching: `TanStack Query`
- Local UI state: plain React state and context by default

### State policy

- `TanStack Query` is the primary owner of server-derived state
- websocket and realtime updates should patch query cache state
- do not introduce Redux-style global state by default
- add a dedicated local store only if plain React state becomes insufficient

## Validation and shared contracts

- Validation and schema library: `Zod`

### Why Zod

- Strong ecosystem
- Strong developer ergonomics
- Good fit for shared frontend and backend contracts
- Good enough performance unless validation is proven to be a hot path

### Alternative considered

- `Valibot` was considered as a lighter alternative
- `Zod` was chosen for lower adoption risk and stronger ecosystem

## UI primitives

- Primitive component library: `Radix Primitives`

### Why Radix

- Accessibility-focused primitives
- No imposed visual style
- Good fit for building our own interface rather than inheriting a design system

## Styling

- Styling approach: `CSS Modules`
- Design tokens: `CSS variables`

### Styling policy

- prefer explicit component-level styles
- keep design tokens centralized through CSS variables
- allow a very small internal utility layer only if repeated patterns emerge
- do not adopt utility-first CSS as the primary styling system

### Why not Tailwind or UnoCSS

- BetterChat is a product UI, not a generic dashboard
- CSS Modules keeps styling explicit and readable
- chat UI state is often easier to express in real CSS than large utility class sets
- we want stronger control over design language and long-term maintainability

## Virtualization

- Virtualization library: `TanStack Virtual`

### Why TanStack Virtual

- Headless and flexible
- good fit for room lists and eventually timeline virtualization
- keeps control in our code instead of imposing a higher-level message-list abstraction

## Testing

- End-to-end and integration testing: `Playwright`
- Unit testing for backend and shared packages: `bun test`

### Testing policy

- prioritize integration testing against a real Rocket.Chat `7.6.0` environment
- add dedicated frontend component/unit test tooling later only if needed

## Backend and frontend boundary

The browser should talk only to BetterChat backend.

### Browser to BetterChat backend

- HTTP JSON for snapshots and mutations
- websocket for BetterChat realtime events

### BetterChat backend to Rocket.Chat

- REST for snapshots and mutations
- DDP/WebSocket bridge or adapter for realtime
- proxied access for uploads, avatars, and media

## Intentionally not chosen for v1

- `Next.js`
- `Remix`
- `React Router`
- `Redux`
- `Tailwind CSS`
- `UnoCSS`
- heavyweight UI kits like `MUI` or `Ant Design`
- direct browser-to-Rocket.Chat integration
- reproducing Rocket.Chat's Meteor client architecture

## Suggested repo shape

```text
betterchat/
  apps/
    web/
    backend/
  packages/
    contracts/
    test-utils/
```

## Expected first implementation focus

- login
- bootstrap current user and workspace settings
- room list
- room open
- room timeline
- send, edit, and delete message
- unread and read state
- typing and basic realtime updates
- uploads and avatars

## Revisit criteria

Revisit stack choices only if one of these becomes true:
- Bun runtime limitations materially block implementation
- Zod becomes a proven runtime hotspot
- TanStack Router creates route-level complexity not justified by the app
- timeline virtualization needs a more specialized library than `TanStack Virtual`
