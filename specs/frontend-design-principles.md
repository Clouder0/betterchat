# BetterChat Frontend Design Principles

Date: 2026-03-24
Status: Historical seed note
Reference input: Anthropics `frontend-design` skill

## Purpose

Capture the frontend design principles that informed BetterChat before the concrete design system was settled.

This note is not the current visual source of truth.
That role now belongs to `specs/design-system-v1.md`.

This file remains useful as:
- original design-quality bar
- anti-generic reminder
- background rationale for the eventual design-system direction

## Core principle

BetterChat should not look like a generic enterprise dashboard or a dressed-up clone of the existing Rocket.Chat client.

The interface should feel:
- modern
- smooth
- intentional
- distinctive
- internally coherent

## Design standard

When building BetterChat UI:
- choose a clear aesthetic direction
- execute it consistently
- avoid default or generic choices
- optimize for perceived smoothness and clarity in daily chat use

## What we should take from the external frontend-design skill

Useful principles:
- commit to a real visual point of view instead of drifting into neutral defaults
- make typography an intentional design choice
- use a cohesive palette with strong hierarchy
- use motion carefully, with a few high-impact moments instead of constant noise
- use composition, depth, contrast, and spacing deliberately
- avoid generic AI-looking UI patterns and overused visual clichés

## What this means for BetterChat specifically

BetterChat is not a marketing site.
It is a work tool used repeatedly during the day.

So the design must balance two things:
- strong aesthetic identity
- practical readability and speed of use

That means:
- chat readability wins over decorative excess
- dense information must still feel calm and ordered
- animations must support orientation and delight, not delay
- room switching and message interaction should feel light and responsive

## Visual anti-goals

Avoid these patterns:
- generic SaaS dashboard styling
- default white cards on faint gray backgrounds
- random purple gradients
- overused font stacks like Inter or generic system defaults as the full identity
- utility-looking spacing that feels assembled rather than designed
- too many badges, borders, shadows, and panels competing for attention
- motion that makes the app feel slower

## Interface priorities

The highest-value surfaces are:
- sidebar
- room header
- timeline
- composer
- unread and read markers
- attachment and avatar rendering

These surfaces should receive the most design care first.

## Typography direction

- choose typography intentionally
- avoid bland defaults as the full visual language
- pair a characterful display or accent choice with a highly readable body choice
- preserve excellent readability in timeline and sidebar text

## Color direction

- establish a strong base palette through CSS variables
- use a restrained number of major colors
- rely on contrast and hierarchy more than constant decoration
- let accent colors mean something

## Motion direction

- keep motion purposeful
- prioritize:
  - page and shell load
  - room transitions
  - sidebar and panel transitions
  - hover and focus feedback
- avoid constant ornamental animation

## Composition direction

- avoid predictable dashboard sameness
- create rhythm through spacing, density control, and contrast
- use asymmetry or structural tension where it helps identity
- keep chat content area readable and stable

## Product-specific design truth

The main BetterChat aesthetic challenge is not making a "beautiful dashboard".
It is making chat feel:
- faster
- cleaner
- calmer
- more deliberate

The design should make the official client feel clumsy by comparison.

## Implementation guidance

When implementing UI:
- define the aesthetic direction before writing major component styling
- use CSS variables early
- build a small set of high-quality primitives
- test on both desktop and constrained laptop widths
- keep the timeline as the visual anchor of the app

## Open design decision

We still need to choose the actual v1 aesthetic direction.

Good candidate directions for BetterChat:
- editorial + industrial
- refined dark utilitarian
- light modernist with sharp accents
- restrained brutalist enterprise

This should be decided before building the main shell and timeline styling.
