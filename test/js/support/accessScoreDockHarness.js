/**
 * Shared setup for the AccessScore insights-dock suites (#5217): loads the model, the ramp, the chart base and
 * views, and the dock into jsdom with what they read — an i18next that echoes keys and their arguments, and the
 * ramp tokens — so each suite can assert on structure and numbers rather than on translated prose.
 */

import fs from 'fs';
import path from 'path';

import { loadModules, REPO_ROOT } from '../loader.js';

const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const FIXTURE = JSON.parse(read('test/fixtures/accessScoreParity.json'));
const RAMP = ['#a74d32', '#eb724e', '#c2c2c2', '#62c0ac', '#5f9e7b'];

/** An i18next that returns the key (namespace stripped) followed by its arguments, so text stays inspectable. */
function stubI18next() {
    window.i18next = {
        language: 'en',
        t: (key, opts) => {
            const bare = key.replace(/^[a-z]+:/, '');
            // `interpolation` is i18next's own escaping switch, not an argument the text would show.
            const args = Object.entries(opts || {}).filter(([k]) => k !== 'interpolation');
            if (args.length === 0) return bare;
            return `${bare} ${args.map(([k, v]) => `${k}=${v}`).join(' ')}`;
        },
    };
}

/**
 * Loads the ramp tokens and the production sources together, so the dock's views are the very classes handed back.
 * @returns {Promise<object>} The classes by name, `ScoreRamp` through `AccessScoreDock`.
 */
async function loadSources() {
    RAMP.forEach((hex, i) => document.documentElement.style.setProperty(`--color-score-ramp-${i + 1}`, hex));
    const classes = ['AccessScoreModel', 'AccessScoreGradeRamp', 'AccessScoreChart', 'AccessScoreHistogram',
        'AccessScoreWhatsHere', 'AccessScoreRankBars', 'AccessScoreClusterSheet', 'AccessScorePhotoStrip',
        'AccessScoreDock'];
    const dirOf = (name) => (name === 'AccessScoreGradeRamp' ? 'common' : 'access-score');
    const paths = classes.map((name) => `frontend/js/${dirOf(name)}/${name}.js`);
    return loadModules('frontend/js/common/scoreRamp.js', 'frontend/js/common/LabelMiniCard.js', ...paths);
}

/** A street feature in the API's shape, from a fixture case. */
function feature(c, i, extra = {}) {
    return {
        type: 'Feature',
        geometry: null,
        properties: {
            street_edge_id: i + 1,
            region_id: 1,
            audit_count: 1,
            length_meters: 100,
            severity_counts: c.severity_counts,
            tag_adjustments: c.tag_adjustments,
            ...extra,
        },
    };
}

/** The dock's shell markup, with the ids AccessScoreDock reads (mirrors app/views/apps/accessScore.scala.html). */
const DOCK_HTML = `
  <div id="acs-map-holder">
    <aside id="acs-dock" class="acs-dock">
      <div class="acs-dock__bar">
        <button type="button" id="acs-dock-toggle" aria-expanded="true" aria-controls="acs-dock-body">Insights</button>
        <span id="acs-dock-caption"></span>
        <div id="acs-dock-strip" class="acs-dock__strip">
          <span class="acs-dock__strip-bar"><span class="acs-dock__strip-caret" hidden></span></span>
        </div>
        <div id="acs-dock-kpis"></div>
        <div id="acs-dock-brush" hidden>
          <span id="acs-dock-brush-text"></span>
          <button type="button" id="acs-dock-brush-clear">Clear</button>
        </div>
        <div id="acs-dock-status" role="status"></div>
      </div>
      <div id="acs-dock-body" class="acs-dock__body">
        <section class="acs-dock__panel acs-dock__panel--histogram"><div id="acs-histogram"></div></section>
        <section class="acs-dock__panel acs-dock__panel--whats-here"><div id="acs-whats-here"></div></section>
        <section class="acs-dock__panel acs-dock__panel--rank">
          <div class="acs-dock__panel-head">
            <h3 id="acs-dock-rank-title">Neighborhoods ranked</h3>
            <button type="button" class="acs-info" aria-label="More information">i</button>
            <button type="button" id="acs-rank-order" hidden>Show worst 20</button>
          </div>
          <div id="acs-rank-bars"></div>
        </section>
        <section class="acs-dock__panel acs-dock__panel--photos"><div id="acs-photos"></div></section>
      </div>
    </aside>
  </div>`;

/**
 * A `fetch` that answers the photo strip's two feeds from in-memory tables: `clustersByRegion` maps a region id to
 * cluster property objects, `labels` maps a label id to a `/label/id` JSON. Anything else is a 404. Returns the
 * mock so a test can inspect the URLs asked for.
 */
function stubFetch({clustersByRegion = {}, labels = {}} = {}) {
    const json = (body, ok = true) => Promise.resolve({ok, status: ok ? 200 : 404, json: () => Promise.resolve(body)});
    window.fetch = vi.fn((input) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname === '/v3/api/labelClusters') {
            // A cluster stub with `coordinates` is a Point, as the feed's are; the strip's viewport filter reads them.
            const features = (clustersByRegion[url.searchParams.get('regionId')] || [])
                .map(({coordinates = null, ...properties}) => ({
                    type: 'Feature',
                    geometry: coordinates ? {type: 'Point', coordinates} : null,
                    properties,
                }));
            return json({type: 'FeatureCollection', features});
        }
        const m = /^\/label\/id\/(\d+)$/.exec(url.pathname);
        if (m && labels[m[1]]) return json(labels[m[1]]);
        return json({}, false);
    });
    return window.fetch;
}

/** The hex a `style.backgroundColor` assignment reads back as under jsdom (`rgb(r, g, b)`). */
function rgb(hex) {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
}

export {FIXTURE, RAMP, stubI18next, stubFetch, loadSources, feature, DOCK_HTML, rgb};
