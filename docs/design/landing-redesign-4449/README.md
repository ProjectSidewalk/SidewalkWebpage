# Landing Page Redesign — Design Package (#4449)

Design work for a full rethink of the landing page around **community and collective effort** — making the
world's sidewalks more accessible, walkable, and safe. Covers the tools showcase ask in
[#4449](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4449), the "what is Collaborators" question
in [#3943](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3943), the localized neighborhood CTA
idea from [#2340](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2340), and the config-driven half
of partner logos ([#4516](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4516) — admin upload UI
remains a follow-up).

## Contents

| File | What it is |
|------|------------|
| [`plan.md`](plan.md) | The approved implementation plan (architecture, config shapes, i18n, cleanup, tests) |
| [`mockup-a-the-movement.html`](mockup-a-the-movement.html) | High-fidelity mockup, **Version A "The Movement"** — dark, cinematic, rally-the-collective |
| [`mockup-b-street-level.html`](mockup-b-street-level.html) | High-fidelity mockup, **Version B "Street Level"** — daylight, editorial, human-scale |

**Viewing the mockups:** download and open in any browser — they are fully self-contained (design-system
tokens plus Mulish/Raleway subsets embedded as data URIs; no network access needed). GitHub shows HTML as
source, so use a local copy or a raw-HTML preview service.

## The two directions at a glance

Both fulfill the same content requirements; every section has a direct counterpart, so they can be compared
one-to-one or mixed.

| Section | A — The Movement | B — Street Level |
|---|---|---|
| Mood | Dark, cinematic, collective rally | Daylight, editorial, personal |
| Hero | Centered headline over a stylized night-map with pulsing label dots + global stat ticker | Asymmetric: disability-centered headline + live neighborhood activity feed |
| Validation (#1638 grid) | Browse grid of four cards | One focused "try it in 5 seconds" card |
| Your city | Choropleth-first + stat counters | Numbers-first: road-styled progress bar + neighborhood leaderboard, map demoted to a side card |
| Impact stories | Equal cards on a horizontal rail | Newspaper hierarchy: one lead story + compact list |
| Tools (#4449) | Seven-card grid | Vertical tabs + one large preview |
| Partners (#4516/#3943) | Featured-partner card + logo row | Bulletin-board wall + partner quote |
| Global | Dark world dot-map | Light "itinerary line" of cities |

## Status

- 2026-07-25 — Direction decisions made (narrative structure, config-driven partners, city-tagged impact
  stories, static hero imagery); implementation plan approved; both mockups produced.
- 2026-07-27 — Scope addition: a **leaderboard preview band** (top 5 in-city + top 5 all-cities, linking to
  `/leaderboard`); noted on #4449. Neither mockup shows it yet.
- **Next:** pick A, B, or a mix → implementation branch per `plan.md`.

## Known placeholders (⟡ markers in the mockups)

Hero art, the seven tool screenshots, impact-story photos, partner logos, and both quotes are placeholders.
Copy is a first draft of the future i18n strings. The global ticker numbers are live `/v3/api/aggregateStats`
values from 2026-07-25; per-city (Seattle) numbers are partly illustrative.
