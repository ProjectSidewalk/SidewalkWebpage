# Minimap basemap comparison (#5429)

Renders the Explore minimap's basemap two ways for a set of cities, side by side at the same scale:

- **Google** — the Google Maps JS minimap with develop's options and its Cloud-styled map id.
- **MapLibre** — this checkout's `MinimapBasemapStyle.js` over OpenMapTiles-schema vector tiles.

Overlays (route lines, fog of war, FOV cone, legend) are drawn by our own code on top of either basemap and are not
rendered here. The output is for eyeballing what the basemap data and style show in each city: building coverage,
road hierarchy, street names, water and parks.

## Running it

Needs the dev app up on `:9000` (the page is served on its origin so the Maps key's referrer allowlist accepts it;
`DEV_APP_URL` points it elsewhere) and network access to the prod city hosts and tile hosts. The Google key comes
from `GOOGLE_MAPS_API_KEY`, or is read from the dev app's pages when that is unset.

```bash
node tools/minimap-basemap-compare/record.mjs --channel chrome           # default city set
node tools/minimap-basemap-compare/record.mjs --cities seattle-wa,taipei # a subset
```

Then open `tools/minimap-basemap-compare/out/index.html`. `out/` is gitignored. `--channel chrome` uses the
installed Chrome; without it Playwright's bundled browser must be installed (`npx playwright install chromium`).
`--map-id` swaps the Google style, and `--refresh-cities` re-resolves the points cached in `out/cities.json`. A city
whose region lookup failed falls back to its configured center for that run only and is looked up again next time.

## What each shot shows

Google's raster zoom *z* draws the world 256·2^z px wide and MapLibre's 512·2^z, so equal scale is MapLibre = Google
− 1.

| Shot | Google | MapLibre | Why |
|---|---|---|---|
| `street` | 16 | 15 | The minimap's farthest manual zoom-out, same scale |
| `overview` | 13 | 12 | A typical route-overview scale, same scale (the overview itself fits the route, down to MapLibre 11) |
| `default` | 18 | 17 | Each minimap's default zoom; should match in scale |

Each city is centered on its most-labeled region (`/v3/api/regionWithMostLabels` on the city's prod host, from
`conf/cityparams.conf`), falling back to the configured city center. A caption flags any tile error or a pair whose
map centers landed more than 2 m apart.

## Cities

One or two per way the basemap data can vary:

| What it probes | Cities |
|---|---|
| Dense US baseline; water and coastline | seattle-wa, chicago-il |
| Suburban and rural detail | teaneck-nj, laurens-ia |
| CJK street names and glyph ranges | taipei, kaohsiung-tw |
| Latin American coverage | cdmx, la-piedad, sao-paulo-brazil |
| European density and road classes | amsterdam, zurich, bayonne-fr |
| Elsewhere | auckland, chandigarh-india |
