# BetterChat Design System v1

Date: 2026-03-25
Status: MVP baseline

## Purpose

Capture the current BetterChat design system as the baseline for MVP implementation.

This is no longer a loose review draft.
It is the current visual and interaction contract for:
- shared tokens
- shared primitives
- shell structure
- content rendering
- Chinese-first product tone

If implementation needs to diverge from this document, that should be an explicit design decision, not accidental drift.

## Product context

BetterChat is an internal standalone web client for Rocket.Chat `7.6.0`.

Primary language:
- Simplified Chinese first
- English second

The product should feel:
- faster than the official web client
- calmer than the official web client
- more deliberate than the official web client
- compatible with existing server deployments and legacy clients

This is a work tool.
It is not a marketing site, not a design showcase, and not a generic SaaS dashboard.

## Chosen direction

Working aesthetic:
- precision modernist
- quiet enterprise
- concise, not decorative

Why this direction remains correct:
- it supports dense chat information without becoming dashboard noise
- it allows Chinese-heavy content to stay readable and ordered
- it keeps light and dark themes in the same product family
- it makes the shell feel intentional without performing novelty

## Core design truths

The design system should optimize for:
- reading order before ornament
- timeline-first visual hierarchy
- quiet chrome around high-value content
- low-noise state signaling
- explicit, disciplined surfaces

The system should avoid:
- glossy or attention-seeking styling
- gradient-heavy UI chrome
- oversized pills and consumer-chat softness
- repeated nested cards
- special-case widgets that break the product language

## Theme model

BetterChat supports two first-class themes:
- light: warm stone canvas, restrained panel hierarchy, dark ink text
- dark: charcoal canvas, controlled panel depth, warm text hierarchy

The two themes should feel like the same product under different lighting conditions.
They must not drift into unrelated skins.

## Color system

Primary color roles:
- cypress: action, selection, focus, primary emphasis
- olive: structural support, secondary emphasis, contextual quiet color
- clay: warmth, pressure, warning tone, sparing contrast
- stone neutrals: main canvas and panel family

Rules:
- hierarchy should come from contrast and spacing before color
- cypress carries the main signal burden
- olive supports structure and calm emphasis
- clay appears sparingly
- semantic colors should never become the main personality of the interface
- backgrounds should stay quiet and material, not illustrative

## Token model

The system currently uses explicit CSS variable layers for:
- canvas and panel surfaces
- softer inset surfaces for fields and secondary content
- quiet accent-tinted surfaces
- code surfaces
- quote surfaces
- focus ring
- panel and stronger modal shadows

Practical token rule:
- page and component styling should consume shared surface tokens instead of inventing local gradients or one-off card materials

## Typography

Primary typography:
- UI/body: Chinese-first sans stack centered on `PingFang SC` / `Hiragino Sans GB` / `Noto Sans CJK SC`
- mono/data: `IBM Plex Mono` and compatible Chinese-capable monospace fallbacks

Typography rules:
- evaluate all important surfaces in Chinese first
- keep headings compact and deliberate
- avoid Latin-centric tracking habits on Chinese display text
- metadata should stay readable, not mechanically monospaced
- mixed Chinese/English content should read naturally
- pangu-style spacing is part of the reading system, not an optional decoration

Density rules:
- shell body text should be compact but not thin
- metadata should remain readable under dense enterprise usage
- long-form markdown and chat markdown should share one voice, with different density settings

## Geometry and surfaces

Core surface types:
- canvas: application field
- panel: main bounded product surface
- soft panel: quieter inset material
- field: controls, command bars, composer, and input-like containers
- accent surface: subtle selected or active state
- content surface: code blocks, quotes, tables, and other rendered content

Geometry rules:
- use controlled radii, generally tighter than consumer-chat products
- preserve a clear difference between full panels and compact controls
- borders are structural
- shadows should support material separation, not advertise polish
- gradients, if present, should be very restrained and usually structural rather than decorative

## Layout principles

Primary workspace shape:
- sidebar
- timeline
- context panel

Rules:
- the timeline is the visual anchor
- sidebar and context panel should support the timeline, not compete with it
- panels should feel like one shell, not a stack of unrelated cards
- right-side context should remain sparse and secondary
- the scroll experience should feel intentional, with content breathing room but edge-aware scrollbars

## Interaction language

Interaction goal:
- orientation, not spectacle

Interaction rules:
- hover should be fast and quiet
- focus should be explicit and shared through one ring language
- primary actions can carry slightly more weight, but still stay controlled
- floating jump controls should behave like reading aids, not product chrome
- avoid large soft motion or decorative transitions

## Shared primitives

Current primitive set:
- panel
- metric card
- tag
- button
- input
- tabs
- dialog
- theme switch
- shell navigation rows

Primitive rules:
- primitives should feel like part of one material family
- tags should read as restrained metadata chips, not playful pills
- buttons should feel firm, compact, and slightly elevated only when justified
- secondary surfaces should use quiet field material rather than custom local styling
- tabs should rely on underline and text emphasis, not boxed segmentation

## Shell-specific rules

The shell is now the primary product reference surface.

### Sidebar

- active room state should be obvious but low-noise
- selected state uses a quiet tinted surface and structural border
- no decorative active stripe
- command surfaces should feel like product controls, not decorative demo elements

### Timeline

- message reading order is the top priority
- read and unread content should remain visually related, not fade into separate worlds
- unread divider should feel like a structural reading marker
- long messages should support collapse and expansion
- floating navigation should show only one reading aid at a time:
  - unread jump
  - latest jump

### Context panel

- context panel should remain sparse
- it should feel like support information, not a second dashboard

## Message patterns

Current message language includes:
- compact author/meta row
- long-message collapse and expand
- reply preview surface
- thread metadata row
- unread divider
- inline and block rich content

Message rules:
- replies should read as a quiet contextual inset, not a nested mini-card system
- thread metadata should remain secondary to the root message
- content blocks inside messages must still feel like part of one timeline

## Content rendering

BetterChat treats content rendering as part of the product, not as raw third-party output.

Important content types:
- paragraphs and headings
- lists and task lists
- blockquotes
- tables
- inline code
- fenced code blocks
- inline math
- block math

### Code blocks

Code blocks should feel:
- technical
- precise
- theme-aware
- integrated into the product

Current rules:
- dedicated header with language label
- copy action is part of the block
- light and dark themes each have deliberate code surfaces
- header and body must remain distinguishable in both themes
- code should never look like pasted documentation chrome

### Quotes

Quote blocks should feel:
- editorial enough to separate quoted thinking
- quiet enough not to compete with main content

Current rules:
- left structural rail remains visible
- quote surface is lighter than normal panels
- geometry stays aligned with the left rail
- right side may soften; left side should stay structurally anchored
- quotes should read as inset reasoning, not decorative callouts

### Math

Math should feel like content inside the conversation, not a special widget.

Current rules:
- inline math stays inline with the reading rhythm
- block math uses spacing and overflow behavior, not a loud shell
- wide formulas may scroll horizontally
- display math should not dominate the surrounding message

### Tables

Tables should feel like product content surfaces, not markdown preview leftovers.

### Mixed-language rhythm

Chinese, English identifiers, code, and formulas must coexist without breaking reading flow.
Pangu-style spacing is part of this requirement.

## Motion

Motion goal:
- orientation
- readiness
- confidence

Allowed use:
- small hover and press responses
- modal entry
- page and shell transitions if they remain fast
- quiet movement on emphasized controls

Avoid:
- constant ambient animation
- delayed reactions
- large soft easing that makes the app feel slower

## Review routes

Current review routes:
- `/`: direction summary and product framing
- `/shell`: workspace shell and timeline behaviors
- `/content`: markdown, code, table, quote, and math rendering
- `/system`: tokens and primitives

These routes now exist as design verification surfaces, not open-ended exploration playgrounds.

## What is frozen for MVP

The following should be treated as frozen unless a concrete design problem appears:
- precision-modernist / quiet-enterprise direction
- Chinese-first typography and reading rhythm
- cypress / olive / clay palette roles
- quiet material surface system
- timeline-first shell hierarchy
- restrained selected states
- integrated content rendering approach
- low-noise jump controls and message chrome

## What is still open

These are still allowed to evolve during implementation:
- attachment and file-card design
- thread-specific deeper interaction design
- search results surfaces
- empty states and error states
- production motion tuning
- final density tuning under real data
- narrow-screen adaptation beyond core desktop/laptop support

## Source of truth rule

For MVP implementation:
- `specs/design-system-v1.md` is the design-system source of truth
- `specs/frontend-design-principles.md` remains historical context and quality-bar input
- if implementation and this document diverge, update the document intentionally
