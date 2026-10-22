# Landing Page Redesign — Approved Implementation Plan

Approved 2026-07-25 (leaderboard band added 2026-07-27). Companion to [`README.md`](README.md), which holds
the design overview and mockups. Issues: #4449 (primary), #3943, #2340, #1638 follow-through, partial #4516.

## Decisions

- **Narrative-scroll structure**: hero + live global ticker → validation cards → your city's progress →
  impact stories → tools showcase → local partners → global movement → final CTA. (Visual expression — A, B,
  or a mix — decided at mockup review.)
- **Partners**: config-file + repo images now; DB + admin upload UI is a follow-up for #4516.
- **Impact stories**: one curated set (~8), city-tagged, current deployment's stories float first.
- **Hero**: fresh static imagery (no video — the current one shows stale UI, #4487).
- **No DB changes → no evolution file** (call out in the PR description).

## Architecture

### New config: `conf/landing.conf` (included from `application.conf` after `cityparams.conf`)

```hocon
landing {
  partners {            # optional per city; absent city ⇒ no section
    amsterdam = [ { name = "World Enabled", url = "https://…", logo = "images/amsterdam/world_enabled.png",
                    category = "community", featured = true }, … ]
    # Port EVERY hardcoded collaborator @if from index.scala.html (taiwan → Public Nudge,
    # else → Liga Peatonal for MX cities, columbus-oh, amsterdam ×3, UIC) so no deployment loses a logo.
  }
  impact-stories = [    # metadata only; prose lives in messages files. List order = display order.
    { id = "newberg-council", city-id = "newberg-or", image = "images/landing/stories/newberg.jpg", link = "…" },
    { id = "burnaby-program", city-id = "burnaby" }, { id = "mendota-srts", city-id = "mendota-il" },
    { id = "chicago-wards", city-id = "chicago-il" }, { id = "lincolnwood-ada" },
    { id = "zurich-open-data", city-id = "zurich" }, { id = "oradell-scouts", city-id = "oradell-nj" },
    { id = "chicago-ata", city-id = "chicago-il" }
  ]
}
```

### ConfigService (`app/service/ConfigService.scala`)

- Case classes near `CityInfo`: `CityPartner(name, url: Option, logo, category, featured)`,
  `ImpactStory(id, cityId: Option, image: Option, link: Option)`.
- Pure, unit-testable parsers on `object ConfigService` (Play's implicit `ConfigLoader[Seq[Configuration]]`
  reads lists of objects; `hasPath` guard like `getPrivateProfilesByDefault`): `parseCityPartners`,
  `parseImpactStories`, `orderStoriesLocalFirst` (stable partition). Validate `category` against the closed
  set {community, government, academic, school} — fail fast.
- Trait methods `getCityPartners` / `getImpactStories` (lazy-val cache; already local-first ordered).

### Controller (`app/controllers/ApplicationController.index`)

Keep the single for-comprehension; add `configService.getAggregateStats()` (already SWR-cached, #4600), the
leaderboard fetch (below), and the two sync config reads. Bundle view args into
`case class LandingPageData(openStatus, mapathonLink, streetDist, auditedDist, labelCount, valCount,
aggregateStats, leaderboard, partners, impactStories)`. Ticker values are server-rendered (locale-formatted
like `fmtBig` in `userDashboard/leaderboard.scala.html`), animated client-side.

### Leaderboard preview band (added 2026-07-27)

Top 5 in {city} + top 5 all-cities-all-time, side by side, linking to `/leaderboard#all-time` and
`/leaderboard#all-cities`. Implementation gotchas (from #3719 work):

- Per-city `getLeaderboardStats` is **uncached** and runs the `withJitOff` PostGIS sum — fine on
  `/leaderboard`, not on the highest-traffic route. Cache it for the landing page.
- `getGlobalLeaderboardStats` caches **per n** — request 10 and `.take(5)` rather than minting a second
  ~50-schema union.
- The two boards rank by **different metrics**, so show only rank + name + labels.

### Views — partials per the `userDashboard/_*.scala.html` convention

`app/views/index.scala.html` rewritten (keeps JSON-LD block; mobile redirect untouched) composing
`app/views/landing/{_hero,_happeningNow,_cityProgress,_impactStories,_leaderboard,_tools,_partners,_globalMovement,_finalCta}.scala.html`.

- Hero keeps the config-driven mapathon line + news-ribbon hook.
- `_partners` renames "Collaborators" → "Community Partners"; Makeability Lab becomes a subdued "Created by"
  line per #3943.
- `_tools`: 7 cards/tabs — Explore, Validate, LabelMap, Gallery, RouteBuilder, Stories, Data/API — with
  screenshot, blurb, CTA, audience tag (volunteers / advocates / planners+researchers).
- `_finalCta`: condensed 3-step how-it-works (instructional videos retired) + Start now.
- ML-gif section retired; its message survives as a line on the Data/API card + a final-CTA sentence.

### Frontend — promote landing to a first-class Grunt app

- JS `public/js/landing/src/` → `public/js/landing/build/landing.js`; CSS `public/css/landing/*.css` bundled
  like gallery's; add both + watch globs to `Gruntfile.js`.
- Src files (ES2022 classes, JSDoc, fetch, no jQuery):
  - `LandingCounter.js` — small rAF count-up **replacing vendored countUp 1.9.3**; instant-set under
    `prefers-reduced-motion`; IntersectionObserver-triggered.
  - `LandingValidationGrid.js` — moved as-is from `public/js/LandingValidationGrid.js` (+ its CSS into the bundle).
  - `LandingMaps.js` — IO-gated (`rootMargin: '400px'`) `createPSMap` init for choropleth + deployment map
    (params identical to today) — fixes the eager-map-load half of #4486.
  - `NeighborhoodCta.js` — #2340: fetch `/adminapi/neighborhoodCompletionRate`, pick highest-rate unfinished
    region (with a distance-left floor), render "X mi left in {name} — finish it" → `/explore?regionId=<id>`.
  - `landingPage.js` — entry: navbar shrink-on-scroll (ported from `homepage.js`), smooth-scroll
    (reduced-motion aware), click logging.
- **Remove `homepage.css` from the global head** (`common/main.scala.html`) — grep-verified landing-only.
- Styling 100% from `main.css` tokens; digits never in Raleway; no `--ui-scale` (page chrome).

### Assets (new)

`public/images/landing/hero/*`,
`public/images/landing/tools/{explore,validate,label-map,gallery,route-builder,stories,data-api}.jpg`
(capture from the running app; **placeholders OK in the PR, not at merge**), `public/images/landing/stories/*`
(optional per card).

## i18n (backend keys in `messages.en` + all 5 translations; never the base `messages`)

New: `landing.hero.*`, `landing.ticker.*`, `landing.now.*`, `landing.city.progress.*` + stat labels,
`landing.impact.{title,content}` + `landing.impact.<id>.{headline,blurb[,location]}` ×8,
`landing.leaderboard.*`, `landing.tools.*` (+ per-tool title/blurb + audience tags),
`landing.partners.{title,content,created.by}` + generic `landing.partners.logo.alt` ({0}=name),
`landing.global.*`, `landing.final.*`, image alt keys.
Frontend (`public/locales/*/common.json`, all langs + `make lint-locales`): the `NeighborhoodCta` strings only.

Delete from all message files: `landing.ml.*`, `landing.how.you.help.{content,explore,find,assess}`,
`landing.stats.content.*`, `landing.stats.percent.*`, `landing.stats.distance`, `landing.choropleth.*`,
`landing.clouds.alt`, `landing.validate.{title,content}`.
Keep (shared with mobileLanding/welcome): `landing.mobile.*`, `landing.start.exploring`,
`landing.create.path`, `landing.mapathon`, `landing.new.deployment`, `landing.collaborators.logo.*.alt`,
`landing.deployment.map.*`.

## Cleanup (grep-verified; `mobileLanding.scala.html` untouched this PR)

Delete: `public/js/homepage.js`, `public/css/homepage.css`, the old grid JS/CSS locations,
`public/vendor/countup/`, `videos/segment-{1-1,2,3}.mp4` + poster JPGs, `images/MLGraphic.gif`, skyline PNGs
×3 + `generic_cloud_overlay.png` + the `city-params.skyline-img` config block — pending the call on
repurposing the skyline art.
Keep: `videos/mainvideo.*` + `psmockup.jpg` (mobileLanding), collaborator logo PNGs.

## Logging (update `docs/logged-events.md` in the same PR)

Keep: `Visit_Index`, `Click_module=StartExploring_location=Index`, `Click_module=NewCity_location=Index`,
`Click_module=mapathonLink`, grid + deployment-map events.
New: `Click_module=SeeTheImpact`, `Click_module=NeighborhoodCta_regionId=<id>`,
`Click_module=ImpactStory_id=<id>`, `Click_module=ToolCard_tool=<tool>`,
`Click_module=LeaderboardPreview_board=<city|global>`, `Click_module=CommunityPartner_name=<slug>`
(rename of `Collaborator_*`; documented), `Click_module=StartExploring_location=IndexFinalCta`.
Removed: `Click_module=HowYouCanHelp_tab=<n>`.

## Tests

- `test/service/LandingConfigSpec.scala` — pure unit (`ConfigFactory.parseString` fixtures): parsers,
  bad-category failure, local-first ordering (stable; no-local passthrough).
- `test/controllers/LandingPageSpec.scala` — DB-backed (SeoSpec `getPage` pattern): 200, all section ids,
  ticker digits, partner section presence per config, JSON-LD intact, mobile-UA redirect.
- jsdom (`npm run test:js`): `landingCounter.test.js` (reduced-motion), `landingNeighborhoodCta.test.js`
  (region pick, mi/km, hidden at 100%).

## Docs in lockstep

`.claude/skills/add-city-configs` (optional `landing.partners.<cityId>`; `skyline-img` removal),
`docs/logged-events.md`, Copilot path-scoped review instructions if they mention landing files.

## Verification / QA

1. `sbt --client compile` (from the worktree path in the container), `make scalafmt-fix`, `make lint`,
   `npm run test:js`, `sbt --client test` (db up).
2. `make qa-worktree wt=<name>` → :9000 — all sections; maps lazy-init only on scroll-near (no mapbox
   fetches at load); grid votes work anonymously; NeighborhoodCta targets the right region; language
   spot-check (es, zh-TW); `/mobileLanding` unchanged; dashboard/gallery/explore visually unchanged after
   the homepage.css removal.
3. Reduced-motion emulation (no animations), keyboard-only pass, Lighthouse a11y + perf before/after.
4. Manual checklist for GSV-adjacent checks (grid imagery correctness) + art approvals.

## PR structure

Single implementation PR (the page swap is atomic), reviewable commits: scaffolding + partials-1:1-migration
→ hero + ticker → city progress + CTA → impact stories → leaderboard band → tools → partners → global +
final CTA → cleanup → tests + docs. Follow-up issues at PR time: #4516 admin partner UI (DB table + upload),
mobileLanding alignment with the new narrative, remaining #4486 global-script work, screenshot swap if
placeholders remain.

## Open questions

1. Hero imagery direction (mockup A shows stylized night-map; photo-collage is the alternative).
2. Skyline art: fully retire vs repurpose (e.g. final-CTA band background).
3. Analytics: OK renaming `Collaborator_*` click events → `CommunityPartner_*`?
4. Impact-story links/copy fact-check + partner logo permissions.
