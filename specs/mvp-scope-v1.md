# BetterChat MVP Scope v1

Date: 2026-03-25
Status: Active baseline
Target upstream: Rocket.Chat `7.6.0`

## Purpose

Define the first Agile development cycle scope for BetterChat.

This document is intentionally narrower than the full product ambition.
Its job is to keep the first cycle:
- useful
- compatible
- testable
- reproducible

## Cycle objective

Deliver the first usable BetterChat read-and-navigate experience against a real Rocket.Chat `7.6.0` server, with a reproducible backend test environment and real-browser verification.

The first cycle should prove:
- BetterChat can authenticate against Rocket.Chat
- BetterChat can bootstrap user and workspace state
- BetterChat can present a usable sidebar and room timeline
- BetterChat can render the main content forms we care about
- BetterChat can be tested end-to-end in a repeatable way

## Fixed product decisions for this cycle

- Favorites should follow upstream Rocket.Chat semantics.
- Jump-to-room search should stay simple and workable.
- Good Chinese matching matters; advanced fuzzy logic is not required yet.
- Reverse reply inspection for "who replied to this post" is deferred.
- Image rendering is in scope.
- Image uploading and sending should land if the backend boundary stays explicit and testable.
- Register/signup is out of scope.

## In scope

### Backend

- Reproducible Rocket.Chat `7.6.0` test environment using Podman
- Scripted stack startup, teardown, and test execution
- BetterChat backend as a thin compatibility BFF/proxy
- Rocket.Chat compatibility tests at the backend/API boundary
- Integration tests against a real Rocket.Chat server

### Frontend

- Login screen
- Main authenticated shell
- Sidebar grouped into:
  - Favorites
  - Rooms
  - Direct Messages
- Unread items surfaced clearly
- Unread chats sorted to the top within their groups
- Simple jump-to-room search with good Chinese usability
- Main timeline rendering
- Right supplemental sidebar for room information
- Right sidebar closed by default
- Clear open and close interaction for the right sidebar
- Reply jump-to-original behavior
- Markdown rendering
- KaTeX rendering
- Quote block rendering
- Image rendering

### Cross-cutting

- Playwright-based browser tests against the real stack
- Spec-driven and script-driven workflow
- Durable notes updated when assumptions change

## Expected user-visible workflow

The first cycle should support this path:

1. Open BetterChat.
2. Login successfully.
3. Land in the main shell.
4. See grouped sidebar data with unread and favorites behavior.
5. Use jump-to-room search to open a target room.
6. Open a room and read its message history.
7. Render rich content correctly.
8. Open the room information sidebar on demand and close it again.
9. Jump from a reply to the original post.

## Strongly preferred in this cycle

These are important enough that they should be attempted if they fit cleanly:

- Plain text message sending
- Receiving a fresh incoming message during a live session
- Stable avatar and media proxy behavior for rendered content

If one of these threatens the whole cycle, keep the compatibility foundation first and defer the rest explicitly.

## Explicitly deferred

- Registration
- Reverse reply inspector for a replied-to post
- Full thread experience
- Reactions
- Edit and delete
- Advanced search ranking or fuzzy pinyin search
- Full attachment catalog
- Full mobile optimization

Clarification:
- backend compatibility endpoints for thread history, reactions, edit/delete, and read-state may still land ahead of the corresponding polished frontend UX so the frontend can integrate against stable BetterChat contracts

## Scope boundaries

The backend should not try to reproduce all of Rocket.Chat internals.

The frontend should not bind directly to raw Rocket.Chat contracts.

The first cycle should not attempt total parity with the official web client.

## Acceptance criteria

The cycle is successful when all of the following are true:

- One scripted command can start the local test stack.
- One scripted command can run the backend compatibility/integration suite.
- One scripted command can run the Playwright browser checks.
- Login works against a real Rocket.Chat `7.6.0` server.
- Sidebar grouping and unread/favorite ordering work against real data.
- Room open and initial timeline load work against real data.
- Markdown, math, quote blocks, code blocks, and images render acceptably in the real app shell.
- The right room info sidebar opens and closes predictably.
- Reply jump-to-original works in the real timeline UI.
- Any deferred feature is documented explicitly rather than silently missing.

## Quality bar

The first cycle is not allowed to be:
- visually incoherent
- manually tested only
- mock-only
- coupled directly to Rocket.Chat web internals without documentation

The first cycle may still be incomplete, but it must be:
- architecturally sound
- compatible on the chosen slice
- reproducible
- reviewable
