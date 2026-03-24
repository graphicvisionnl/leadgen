# design-taste-frontend: Senior UI/UX Engineering Framework

This comprehensive guide establishes systematic rules for building premium digital interfaces that override common LLM design biases.

## Core Configuration

The framework operates with three baseline variables: DESIGN_VARIANCE (8), MOTION_INTENSITY (6), and VISUAL_DENSITY (4).

## Key Principles

**Architecture Standards:** Single-file HTML with inline CSS. No external JS frameworks.

**Anti-Emoji Policy [CRITICAL]:** No emojis. Use clean SVG primitives as icons.

## Design Engineering Rules

1. **Typography Enforcement:** Use specific font pairings. Avoid generic Inter everywhere. Consider Outfit, Cabinet Grotesk, Satoshi from Google Fonts. Vary weights aggressively (300, 400, 600, 800).

2. **Color Calibration:** The 'AI Purple/Blue' aesthetic is strictly BANNED. Maximum one accent color at <80% saturation. Use the brand's industry to derive a fitting palette.

3. **Layout Diversification:** Centered Hero sections prohibited. Force asymmetry. Use CSS Grid with intentional imbalance. Mix text sizes dramatically.

4. **Materiality Philosophy:** Generic card containers with equal padding and box-shadow are BANNED. Elevation communicates hierarchy only when functional.

5. **Interactive States:** All interactive elements need hover states with `-translate-y-[1px]` or `scale(0.98)` tactile feedback.

## Forbidden AI Patterns

- Neon/outer glows
- Pure black (#000000) — use #0A0A0A or #111 instead
- Generic names ("John Doe", "Jane Smith")
- Broken image placeholders
- Startup clichés ("Seamless", "Unleash", "Revolutionize", "Cutting-edge")
- Three equal columns of identical cards
- Centered symmetrical hero with big H1 + subtitle + two buttons
- Footer with nothing but copyright

## Mobile Safety

Asymmetric layouts above md: breakpoints must fall back to single-column on viewports under 768px. Use `min-h-[100dvh]` not `h-screen`.
