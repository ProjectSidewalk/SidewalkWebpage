/**
 * Shared setup for the AccessScore insights-dock suites (#5217): loads the model, the ramp, the chart base and
 * views, and the dock into jsdom with the stubs they read — an i18next that echoes keys and their arguments, the
 * label-type helpers from util.misc, and the ramp tokens — so each suite can assert on structure and numbers
 * rather than on translated prose.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const FIXTURE = JSON.parse(read('test/fixtures/accessScoreParity.json'));
const RAMP = ['#a74d32', '#eb724e', '#c2c2c2', '#62c0ac', '#5f9e7b'];

/** An i18next that returns the key (namespace stripped) followed by its arguments, so text stays inspectable. */
function stubI18next() {
    window.i18next = {
        language: 'en',
        t: (key, opts) => {
            const bare = key.replace(/^[a-z]+:/, '');
            if (!opts || Object.keys(opts).length === 0) return bare;
            return `${bare} ${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(' ')}`;
        },
    };
}

/** The util.misc surface the cluster view reads: the two rating palettes, their words, and the icon paths. */
function stubUtilMisc() {
    const positive = ['CurbRamp', 'Crosswalk'];
    window.util = {
        misc: {
            getSeverityLevelColors: (severity, type) => ({
                face: `var(--color-${positive.includes(type) ? 'positive' : 'negative'}-${severity})`,
            }),
            getRatingLevelKeys: (type) => (positive.includes(type)
                ? {1: 'good', 2: 'okay', 3: 'bad'}
                : {1: 'low', 2: 'medium', 3: 'high'}),
            getIconImagePaths: (type) => ({iconImagePath: `/assets/images/icons/label_type_icons/${type}_small.svg`}),
            getLabelColors: () => ({}),
        },
    };
}

/** Evaluates the production sources into the jsdom global scope, exporting the bare classes onto window. */
function loadSources() {
    RAMP.forEach((hex, i) => document.documentElement.style.setProperty(`--color-score-ramp-${i + 1}`, hex));
    window.eval(read('public/js/common/scoreRamp.js'));
    const classes = ['AccessScoreModel', 'AccessScoreChart', 'AccessScoreHistogram', 'AccessScoreClusterBars',
        'AccessScoreRankBars', 'AccessScoreDock'];
    for (const name of classes) window.eval(`${read(`public/js/access-score/src/${name}.js`)}\nwindow.${name} = ${name};`);
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
        <div class="acs-segmented">
          <label class="acs-segmented__option"><input type="radio" name="acs-scope" value="city" checked>City</label>
          <label class="acs-segmented__option"><input type="radio" name="acs-scope" value="viewport">Map view</label>
          <label class="acs-segmented__option" id="acs-scope-selection-option">
            <input type="radio" name="acs-scope" value="selection" disabled>Selected</label>
        </div>
        <span id="acs-dock-scope-caption"></span>
        <div id="acs-dock-kpis"></div>
        <div id="acs-dock-brush" hidden>
          <span id="acs-dock-brush-text"></span>
          <button type="button" id="acs-dock-brush-clear">Clear</button>
        </div>
        <div id="acs-dock-status" role="status"></div>
      </div>
      <div id="acs-dock-body">
        <div id="acs-histogram"></div>
        <div id="acs-cluster-bars"></div>
        <div id="acs-rank-bars"></div>
      </div>
    </aside>
  </div>`;

/** The hex a `style.backgroundColor` assignment reads back as under jsdom (`rgb(r, g, b)`). */
function rgb(hex) {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
}

module.exports = {FIXTURE, RAMP, stubI18next, stubUtilMisc, loadSources, feature, DOCK_HTML, rgb};
