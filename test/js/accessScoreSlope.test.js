/**
 * Tests for slope in the AccessScore tool's scoring controls (#5223): the sidebar's Slope section
 * (AccessScoreSlopePanel.js) and the `slope` URL param. The scoring itself is held to the engine by the parity cases
 * in accessScoreModel.test.js; this file pins what the controls emit and what a link can carry.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const FIXTURE = JSON.parse(read('test/fixtures/accessScoreParity.json'));

const GRADIENT = {
    walking_surface_limit: 0.05, ramp_limit: 1 / 12, map_class_breaks: [1 / 48, 0.05, 1 / 12, 0.125],
    sources: [{ dem_source: 'usgs-3dep-10m', title: 'USGS', credit: 'Elevation: USGS', licence: 'PD', url: null,
        street_count: 3 }],
};
const CONFIG = { ...FIXTURE.config, gradient: GRADIENT };
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The section's markup, reduced to the elements the panel reads (the view's ids, none of its copy). */
const MARKUP = `
  <section id="acs-slope-section" hidden>
    <button id="acs-slope-toggle" aria-expanded="false"><img data-up-src="up.svg" data-down-src="down.svg"></button>
    <span id="acs-slope-summary"></span>
    <button id="acs-slope-reset" hidden></button>
    <div id="acs-slope" hidden>
      <output id="acs-slope-weight-value"></output>
      <input type="range" id="acs-slope-weight" min="0" step="0.05">
      <select id="acs-slope-statistic"></select>
      <input type="number" id="acs-slope-low"><input type="number" id="acs-slope-high">
      <p id="acs-slope-fixed-note" hidden></p>
      <input type="checkbox" id="acs-slope-barrier"><input type="number" id="acs-slope-barrier-threshold">
      <input type="checkbox" id="acs-slope-low-confidence">
    </div>
  </section>`;

describe('slope in the AccessScore scoring controls', () => {
    let AccessScoreModel;
    let AccessScoreSlopePanel;
    let AccessScoreUrlSync;

    beforeAll(() => {
        window.i18next = { language: 'en', t: (key) => key, exists: () => false };
        window.util = { escapeHTML: (text) => String(text) };
        window.eval(read('public/js/common/urlQuery.js'));
        for (const name of ['Model', 'SlopePanel', 'UrlSync']) {
            window.eval(`${read(`public/js/access-score/src/AccessScore${name}.js`)}
                window.AccessScore${name} = AccessScore${name};`);
        }
        ({ AccessScoreModel, AccessScoreSlopePanel, AccessScoreUrlSync } = window);
    });

    /** Builds the panel over fresh markup, collecting what it emits. */
    function mount(config = CONFIG) {
        document.body.innerHTML = MARKUP;
        const emitted = [];
        const panel = new AccessScoreSlopePanel(document.body, config, 3, (partial, meta) =>
            emitted.push({ partial, meta }));
        panel.setState({ slope: AccessScoreModel.slopeDefaults(config) });
        return { panel, emitted, el: (id) => document.getElementById(id) };
    }

    /** Sets a control's value and fires the event a person's edit would. */
    function edit(element, value, type = 'change') {
        if (element.type === 'checkbox') element.checked = value;
        else element.value = String(value);
        element.dispatchEvent(new Event(type, { bubbles: true }));
    }

    describe('AccessScoreSlopePanel', () => {
        test('stays hidden where the engine publishes no slope settings or the city has no slopes', () => {
            const { slope, ...older } = CONFIG;
            expect(slope).toBeDefined();
            expect(mount(older).panel.available).toBe(false);
            expect(document.getElementById('acs-slope-section').hidden).toBe(true);
            const unsampled = { ...CONFIG, gradient: { ...GRADIENT, sources: [] } };
            expect(mount(unsampled).panel.available).toBe(false);
            expect(mount().panel.available).toBe(true);
            expect(document.getElementById('acs-slope-section').hidden).toBe(false);
        });

        test('shows the engine defaults as percentages, offers its statistics, and has nothing to reset', () => {
            const { el } = mount();
            expect(el('acs-slope-weight').value).toBe('0');
            expect(el('acs-slope-weight').max).toBe('3');
            expect(el('acs-slope-low').value).toBe('5');
            expect(el('acs-slope-high').value).toBe('8.3');
            expect(el('acs-slope-low').min).toBe('1');
            expect(el('acs-slope-low').max).toBe('40');
            expect([...el('acs-slope-statistic').options].map((o) => o.value)).toEqual(CONFIG.slope.statistics);
            expect(el('acs-slope-reset').hidden).toBe(true);
            expect(el('acs-slope-summary').textContent).toBe('');
            expect(el('acs-slope-barrier-threshold').disabled).toBe(true);
        });

        test('a slider drag reports unsettled values, then one settled one, and marks the section custom', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-weight'), 1.25, 'input');
            edit(el('acs-slope-weight'), 1.25, 'change');
            expect(emitted.map((e) => e.meta.final)).toEqual([false, true]);
            expect(emitted[1]).toEqual({
                partial: { slope: { weight: 1.25 } }, meta: { kind: 'SlopeWeight', value: 1.25, final: true },
            });
            expect(el('acs-slope-weight-value').textContent).toBe('×1.25');
            expect(el('acs-slope-reset').hidden).toBe(false);
            expect(el('acs-slope-summary').textContent).toBe('accessscore:weights-custom');
        });

        test('a threshold is emitted as a fraction, and an entry outside the range snaps back unreported', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-low'), 8);
            expect(emitted).toHaveLength(1);
            expect(emitted[0].partial.slope.lowThreshold).toBeCloseTo(0.08, 12);
            expect(emitted[0].meta).toEqual({ kind: 'SlopeThreshold', value: 'low_value=8', final: true });
            for (const bad of ['', 'abc', '0.5', '41']) {
                edit(el('acs-slope-low'), bad);
                expect(el('acs-slope-low').value).toBe('8');
            }
            expect(emitted).toHaveLength(1);
        });

        test('the over-limit statistic disables the thresholds and says why', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-statistic'), 'meters_over_limit');
            expect(emitted[0].partial).toEqual({ slope: { statistic: 'meters_over_limit' } });
            expect(el('acs-slope-low').disabled).toBe(true);
            expect(el('acs-slope-high').disabled).toBe(true);
            expect(el('acs-slope-fixed-note').hidden).toBe(false);
            edit(el('acs-slope-statistic'), 'max_grade');
            expect(el('acs-slope-low').disabled).toBe(false);
            expect(el('acs-slope-fixed-note').hidden).toBe(true);
        });

        test('the barrier grade is only editable while the barrier is on', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-barrier'), true);
            expect(emitted[0]).toEqual({
                partial: { slope: { barrierEnabled: true } }, meta: { kind: 'SlopeBarrier', value: true, final: true },
            });
            expect(el('acs-slope-barrier-threshold').disabled).toBe(false);
            edit(el('acs-slope-low-confidence'), true);
            expect(emitted[1].meta.kind).toBe('SlopeLowConfidence');
        });

        test('reset returns every control to the engine defaults and reports the full settings', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-weight'), 2, 'change');
            edit(el('acs-slope-barrier'), true);
            el('acs-slope-reset').click();
            expect(emitted[emitted.length - 1]).toEqual({
                partial: { slope: AccessScoreModel.slopeDefaults(CONFIG) }, meta: { kind: 'SlopeReset', final: true },
            });
            expect(el('acs-slope-weight').value).toBe('0');
            expect(el('acs-slope-barrier').checked).toBe(false);
            expect(el('acs-slope-reset').hidden).toBe(true);
        });

        test('the heading folds the section and reports the fold', () => {
            const { panel, emitted, el } = mount();
            el('acs-slope-toggle').click();
            expect(panel.open).toBe(true);
            expect(el('acs-slope').hidden).toBe(false);
            expect(el('acs-slope-toggle').querySelector('img').getAttribute('src')).toBe('up.svg');
            expect(emitted[0]).toEqual({ partial: null, meta: { kind: 'Section', value: 'slope_open=true', final: true } });
        });
    });

    describe('the slope URL param', () => {
        test('reads each token against the config and drops what it does not allow', () => {
            const { state } = AccessScoreUrlSync.read(CONFIG, '?slope=w:1.5,s:max_grade,lo:0.08,hi:0.1,b:0.12,lc:1');
            expect(state.slope).toEqual({
                weight: 1.5, statistic: 'max_grade', lowThreshold: 0.08, highThreshold: 0.1, barrierEnabled: true,
                barrierThreshold: 0.12, includeLowConfidence: true,
            });
            expect(AccessScoreUrlSync.read(CONFIG, '?slope=w:-1,s:steepness,lo:0.9,hi:abc,b:0,lc:0,zz:1').state.slope)
                .toBeUndefined();
            expect(AccessScoreUrlSync.read(CONFIG, '?slope=w:2,s:steepness').state.slope).toEqual({ weight: 2 });
            const { slope, ...older } = CONFIG;
            expect(slope).toBeDefined();
            expect(AccessScoreUrlSync.read(older, '?slope=w:2').state.slope).toBeUndefined();
        });

        test('a partial from a link merges over the engine defaults in the model', () => {
            const { state } = AccessScoreUrlSync.read(CONFIG, '?slope=w:2');
            const model = new AccessScoreModel(CONFIG, EMPTY, EMPTY, [], state);
            expect(model.state.slope.weight).toBe(2);
            expect(model.state.slope.highThreshold).toBe(CONFIG.slope.high_threshold);
        });

        test('writes only the settings that differ, and nothing at the defaults', () => {
            window.history.replaceState(null, '', '/accessScore');
            const model = new AccessScoreModel(CONFIG, EMPTY, EMPTY, []);
            const map = { on: () => {}, getCenter: () => ({ lat: 40.88, lng: -74.01 }), getZoom: () => 13 };
            const sync = new AccessScoreUrlSync(model, map);
            const param = () => new URLSearchParams(window.location.search).get('slope');
            sync.writeNow();
            expect(param()).toBeNull();
            model.setState({ slope: { weight: 1.5, statistic: 'max_grade', barrierEnabled: true } });
            sync.writeNow();
            expect(param()).toBe('w:1.5,s:max_grade,b:0.083');
            // What was written reads back as the same settings, to the link's three decimals.
            const back = AccessScoreUrlSync.read(CONFIG, window.location.search).state.slope;
            expect(back).toEqual({ weight: 1.5, statistic: 'max_grade', barrierEnabled: true, barrierThreshold: 0.083 });
            model.setState({ slope: AccessScoreModel.slopeDefaults(CONFIG) });
            sync.writeNow();
            expect(param()).toBeNull();
        });
    });
});
