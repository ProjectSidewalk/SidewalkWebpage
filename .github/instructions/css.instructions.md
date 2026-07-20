---
applyTo: "public/css/**/*.css"
---
# CSS review

- **Design tokens (`main.css :root`):** colors via `--color-*`; type via composite
  `--text-*` font shorthands (`font: var(--text-body-regular);`) — not raw
  `--font-*` plus hand-picked size/weight. Flag hardcoded hex colors or
  hand-assembled font stacks where a token fits.
- **Never set numbers in the accent font (Raleway).** It uses old-style figures that
  misalign; anything rendering digits (counts, stats, timers, %, dates) gets a
  primary-font `--text-*` token, even inside an accent heading. Flag digits in a
  Raleway/`--font-accent` token.
- **Tool UI scaling:** for Explore/Validate/overlay UI, every fixed dimension
  (padding, gap, width/height, border width/radius, raw font-size) must be
  `calc(<n>px * var(--ui-scale, 1))`. `--text-*` tokens already bake it in. Flag
  bare px. Fixed page chrome (navbar) is exempt.
