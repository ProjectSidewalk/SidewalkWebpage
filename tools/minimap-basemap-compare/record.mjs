/**
 * Minimap basemap comparison (#5429): renders the Explore minimap's basemap as develop draws it (Google Maps, Cloud
 * styled) beside this checkout's MapLibre style, for a set of cities, and writes the pairs to out/index.html. See
 * README.md for why these cities and how to read the output.
 *
 * Preconditions: the dev app on DEV_APP_URL (default http://localhost:9000; the page is served on its origin so the
 * Maps key's referrer allowlist accepts it); the key from env GOOGLE_MAPS_API_KEY or scraped from that app; network
 * access to a prod city host (for /v3/api/cities) and to the tile hosts.
 *
 * Usage:
 *   node tools/minimap-basemap-compare/record.mjs [--cities a,b] [--map-id ID] [--refresh-cities]
 *     [--headed] [--channel chrome]
 * --channel chrome uses the installed Google Chrome instead of Playwright's bundled browser (no download needed).
 *
 * Output: out/<city>-<shot>-{google,maplibre}.png, out/cities.json (the points used, reused by later runs unless
 * --refresh-cities), out/index.html. out/ is gitignored; it holds screenshots of a third-party map.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../../public');
const OUT_DIR = path.join(HERE, 'out');
const DEV_APP_URL = process.env.DEV_APP_URL ?? 'http://localhost:9000';
// Path prefix the page and public/ are routed under; nothing in the app uses it.
const PREFIX = '/__compare/';
// Any prod host serves /v3/api/cities for every city (each entry is read from that city's own schema).
const CITIES_API = 'https://sidewalk-sea.cs.washington.edu/v3/api/cities';
// develop's Minimap.js mapId: the Cloud Console style prod's minimap uses.
const PROD_MAP_ID = '9c9a85114c815aa4d4dbd5d3';

/** One or two cities per way OSM coverage and naming can differ from Google's; README.md explains each group. */
const DEFAULT_CITIES = [
  'seattle-wa', 'chicago-il', // Dense US baseline; Seattle adds water and coastline.
  'teaneck-nj', 'laurens-ia', // Suburban and rural, where OSM building and road detail thins out.
  'taipei', 'kaohsiung-tw', // CJK street names: glyph ranges and name coverage.
  'cdmx', 'la-piedad', 'sao-paulo-brazil', // Latin America: patchier OSM coverage.
  'amsterdam', 'zurich', 'bayonne-fr', // Europe: dense OSM, different road-class conventions.
  'auckland', 'chandigarh-india', // Elsewhere; Chandigarh is the likeliest weak-coverage case.
];

/**
 * Shots per city. Google's raster zoom z draws the world 256·2^z px wide and MapLibre's 512·2^z, so equal scale is
 * MapLibre = Google − 1. 'default' pairs each minimap's default zoom: develop's Google 18, the branch's MapLibre 17.
 */
const SHOTS = [
  { name: 'street', googleZoom: 16, maplibreZoom: 15, caption: 'Farthest manual zoom-out, same scale (G16 / ML15)' },
  { name: 'overview', googleZoom: 13, maplibreZoom: 12, caption: 'Route overview, same scale (G13 / ML12)' },
  { name: 'default', googleZoom: 18, maplibreZoom: 17, caption: 'Default minimap zoom (G18 / ML17)' },
];

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

/**
 * @param {string[]} argv - Raw arguments, per the Usage in the file header.
 * @returns {object} Options: cities, mapId, refreshCities, headed, channel.
 */
function parseArgs(argv) {
  const out = { cities: DEFAULT_CITIES, mapId: PROD_MAP_ID, refreshCities: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cities') out.cities = argv[++i].split(',');
    else if (a === '--map-id') out.mapId = argv[++i];
    else if (a === '--refresh-cities') out.refreshCities = true;
    else if (a === '--headed') out.headed = true;
    else if (a === '--channel') out.channel = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

/**
 * Finds the Maps API key: env var first, else scraped from the dev app's page (the key the app boots with). The key
 * goes only into the in-memory page; it is never written to out/.
 * @returns {Promise<string>} The API key.
 */
async function resolveApiKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
  const html = await (await fetch(`${DEV_APP_URL}/`)).text();
  const m = html.match(/key:\s*"([^"]+)"/);
  if (!m) throw new Error(`No Maps API key found on ${DEV_APP_URL}/ — set GOOGLE_MAPS_API_KEY.`);
  return m[1];
}

/**
 * The mean vertex of a region's largest polygon: inside it for any reasonably compact neighborhood, and far cheaper
 * than a true point-on-surface for a sanity-check tool.
 * @param {object} geometry - A GeoJSON Polygon or MultiPolygon.
 * @returns {{lat: number, lng: number}} The point.
 */
function regionPoint(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const ring = polygons.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  const lng = ring.reduce((sum, c) => sum + c[0], 0) / ring.length;
  const lat = ring.reduce((sum, c) => sum + c[1], 0) / ring.length;
  return { lat, lng };
}

/**
 * Equirectangular distance, exact enough to flag a pair whose maps did not settle on the same point.
 * @param {{lat: number, lng: number}} a - One point.
 * @param {{lat: number, lng: number}} b - The other.
 * @returns {number} Meters.
 */
function metersApart(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  return Math.hypot(x, (b.lat - a.lat) * rad) * 6371000;
}

/**
 * Each city's prod host, from cityparams.conf. /v3/api/cities nulls a private city's URL, but its host still answers.
 * @returns {Object<string, string>} Host URL by city id.
 */
function prodHosts() {
  const conf = fs.readFileSync(path.resolve(HERE, '../../conf/cityparams.conf'), 'utf8');
  const block = conf.match(/landing-page-url\s*\{\s*prod\s*\{([^}]*)\}/);
  if (!block) throw new Error('No landing-page-url.prod block in conf/cityparams.conf');
  const entries = block[1].matchAll(/^\s*([\w-]+)\s*=\s*"([^"]+)"/gm);
  return Object.fromEntries([...entries].map((m) => [m[1], m[2]]));
}

/**
 * Picks one point per city: its most-labeled region (that is where labelers work), else the configured city center.
 * Cached in out/cities.json so reruns compare the same places. A city-center fallback isn't cached, so a lookup that
 * failed once (a host down, a timeout) is retried on the next run instead of pinning that city to its center.
 * @param {string[]} cityIds - Cities to resolve.
 * @param {boolean} refresh - Ignore the cache.
 * @returns {Promise<object[]>} One {cityId, name, lat, lng, source} per city, in the order given.
 */
async function resolveCities(cityIds, refresh) {
  const cachePath = path.join(OUT_DIR, 'cities.json');
  const cache = !refresh && fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const missing = cityIds.filter((id) => !cache[id]);
  const resolved = {};
  if (missing.length) {
    const all = (await (await fetch(CITIES_API)).json()).cities;
    const hosts = prodHosts();
    for (const id of missing) {
      const city = all.find((c) => c.city_id === id);
      if (!city) throw new Error(`Unknown city id: ${id}`);
      let point = { lat: city.center_lat, lng: city.center_lng, source: 'city center' };
      const host = hosts[id] ?? city.url;
      if (host) {
        try {
          const response = await fetch(`${host}/v3/api/regionWithMostLabels`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const region = await response.json();
          const name = region.properties?.region_name ?? region.properties?.name ?? 'unnamed';
          point = { ...regionPoint(region.geometry), source: `most-labeled region (${name})` };
        } catch (e) {
          console.warn(`${id}: regionWithMostLabels failed (${e.message}); using the city center.`);
        }
      }
      resolved[id] = { cityId: id, name: city.city_name_formatted, ...point };
      if (point.source !== 'city center') cache[id] = resolved[id];
    }
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  }
  return cityIds.map((id) => resolved[id] ?? cache[id]);
}

/**
 * Answers every request under PREFIX on the dev app's origin: compare.html (with the key filled in) and files from
 * public/. The origin satisfies the Maps key's referrer allowlist; the files come from this checkout. Routed on the
 * context, not the page, so MapLibre's worker chunks are answered too.
 * @param {import('@playwright/test').BrowserContext} context - The browser context.
 * @param {string} pageHtml - compare.html with the key substituted.
 * @returns {Promise<void>}
 */
async function routeFiles(context, pageHtml) {
  await context.route(`${DEV_APP_URL}${PREFIX}**`, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).slice(PREFIX.length);
    if (rel === 'compare.html') return route.fulfill({ contentType: 'text/html', body: pageHtml });
    const file = path.resolve(PUBLIC_DIR, rel);
    // path.relative, not startsWith: a sibling like public-old/ shares the prefix but is outside public/.
    const inside = path.relative(PUBLIC_DIR, file);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({
      contentType: MIME[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file),
    });
  });
}

/**
 * @param {*} s - Text for out/index.html.
 * @returns {string} The text, safe inside HTML content and quoted attributes.
 */
function esc(s) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s).replace(/[&<>"']/g, (ch) => entities[ch]);
}

/**
 * Writes out/index.html: one section per city, each shot's Google and MapLibre images side by side.
 * @param {object[]} results - Per city: {city, shots: [{shot, tileErrors}]}.
 * @param {string} mapId - The Google map style used, recorded so a run under a stand-in style is obvious.
 * @returns {void}
 */
function writeReport(results, mapId) {
  const sections = results.map(({ city, shots }) => {
    const rows = shots.map(({ shot, tileErrors }) => `
      <figure>
        <figcaption>${esc(shot.caption)}${tileErrors.length ? ` — <strong>Problems:</strong>
          ${esc(tileErrors.join('; '))}` : ''}</figcaption>
        <img src="${city.cityId}-${shot.name}-google.png" alt="Google, ${esc(city.name)}, ${esc(shot.name)}">
        <img src="${city.cityId}-${shot.name}-maplibre.png" alt="MapLibre, ${esc(city.name)}, ${esc(shot.name)}">
      </figure>`).join('');
    return `
    <section>
      <h2>${esc(city.name)} <small>${esc(city.cityId)} · ${esc(city.source)} ·
        ${city.lat.toFixed(5)}, ${city.lng.toFixed(5)}</small></h2>${rows}
    </section>`;
  }).join('');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Minimap basemap comparison</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; }
    figure { display: inline-block; margin: 0 24px 16px 0; vertical-align: top; }
    figcaption { font-size: 13px; margin-bottom: 4px; max-width: 520px; }
    img { width: 250px; height: 250px; border: 1px solid #ccc; margin-right: 4px; }
    small { font-weight: normal; color: #555; }
  </style>
</head>
<body>
  <h1>Minimap basemap: Google (left) vs MapLibre (right)</h1>
  <p>Google map style id: ${esc(mapId)}. Generated ${new Date().toISOString()}.</p>${sections}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
}

/**
 * Renders every city's shots and writes the report.
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cities = await resolveCities(args.cities, args.refreshCities);
  const pageHtml = fs.readFileSync(path.join(HERE, 'compare.html'), 'utf8')
    .replaceAll('__GMAPS_KEY__', await resolveApiKey());
  const browser = await chromium.launch({ headless: !args.headed, channel: args.channel });
  try {
    const context = await browser.newContext({ viewport: { width: 560, height: 280 }, deviceScaleFactor: 2 });
    await routeFiles(context, pageHtml);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(`${DEV_APP_URL}${PREFIX}compare.html`);
    await page.evaluate((cfg) => window.__compare.init(cfg), { mapId: args.mapId });

    const results = [];
    for (const city of cities) {
      const shots = [];
      for (const shot of SHOTS) {
        const { tileErrors, centers } = await page.evaluate((s) => window.__compare.render(s), {
          lat: city.lat, lng: city.lng, googleZoom: shot.googleZoom, maplibreZoom: shot.maplibreZoom,
        });
        for (const pane of ['google', 'maplibre']) {
          const file = path.join(OUT_DIR, `${city.cityId}-${shot.name}-${pane}.png`);
          await page.locator(`#${pane}`).screenshot({ path: file });
        }
        const offset = metersApart(centers.google, centers.maplibre);
        if (offset > 2) tileErrors.push(`centers ${offset.toFixed(0)} m apart`);
        shots.push({ shot, tileErrors });
        console.log(`${city.cityId} ${shot.name}${tileErrors.length ? ` (${tileErrors.length} problems)` : ''}`);
      }
      results.push({ city, shots });
    }
    writeReport(results, args.mapId);
    if (consoleErrors.length) console.warn(`Console errors:\n  ${consoleErrors.join('\n  ')}`);
    console.log(`Wrote ${path.join(OUT_DIR, 'index.html')}`);
  } finally {
    await browser.close();
  }
}

await main();
