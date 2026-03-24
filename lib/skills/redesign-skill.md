# Redesign Skill — Premium Website Upgrade Protocol

## Goal
Generate a single-file HTML redesign that looks like a custom design agency built it — not a template, not AI-generated.

## Fix Priority Order
1. Font swap (no system fonts, no generic Inter-only)
2. Color palette — derived from the industry, not generic blue/purple
3. Hover and active states on all interactive elements
4. Layout and spacing — generous whitespace, intentional asymmetry
5. Replace generic components (no pill badges, no carousel testimonials, no three-tower layouts)
6. Typographic hierarchy — massive size contrast between headings and body

## High-Impact Design Techniques to Apply
- Variable font weights (use 300 + 800 in the same heading)
- Broken grids with asymmetry (not everything center-aligned)
- Whitespace maximization (padding that feels "too much" is usually right)
- Staggered entry animations (CSS @keyframes, no JS needed)
- Colored shadows that match the accent color
- Large, confident headlines — at least 4rem on desktop
- One "hero statement" that is significantly larger than everything else

## Forbidden Patterns (never generate these)
- Three equal columns of service cards with identical structure
- Centered H1 + centered subtitle + centered CTA button (generic hero)
- Generic testimonial carousel
- Footer with only copyright text
- "Lorem ipsum" — generate real-sounding content specific to the industry
- Stock photo placeholders that are obviously placeholders
- Multiple accent colors competing for attention
- Purple or blue gradients as background (unless brand demands it)

## Content Rules
- Company name must appear prominently in the hero
- Services must sound specific, not generic ("Noodinstallaties 24/7" not "Plumbing Services")
- Location must be mentioned (creates local trust)
- If rating > 4.5: include it prominently ("4.8 ★ op Google")
- CTA button text must be action-oriented: "Bel ons nu" / "Vraag offerte aan" — not "Learn More"
