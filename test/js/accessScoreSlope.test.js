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
const CONFIG = { ...FIXTURE.config, grade: GRADIENT };
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The section's markup, reduced to the elements the panel reads (the view's ids, none of its copy). */
const MARKUP = `
  <section id="acs-slope-section" hidden>
    <button id="acs-slope-toggle" aria-expanded="false"><img data-up-src="up.svg" data-down-src="down.svg"></button>
    <span id="acs-slope-summary"></span>
    <button id="acs-slope-reset" hidden></button>
    <div id="acs-slope" hidden>
      <div id="acs-slope-weight-row">
        <output id="acs-slope-weight-value"></output>
        <input type="range" id="acs-slope-weight" min="0" step="0.05">
        <p id="acs-slope-impact" role="status"></p>
      </div>
      <select id="acs-slope-statistic"></select>
      <input type="number" id="acs-slope-low"><input type="number" id="acs-slope-high">
      <p id="acs-slope-fixed-note" role="status"></p>
      <input type="checkbox" id="acs-slope-barrier"><input type="number" id="acs-slope-barrier-threshold">
      <input type="checkbox" id="acs-slope-approximate">
    </div>
  </section>`;

describe('slope in the AccessScore scoring controls', () => {
    let AccessScoreModel;
    let AccessScoreSlopePanel;
    let AccessScoreUrlSync;

    beforeAll(() => {
        // Echoes the key with any interpolated values, so a test can see what was handed to a string.
        window.i18next = {
            language: 'en',
            exists: () => false,
            t: (key, values = {}) => [key, ...Object.entries(values).map(([k, v]) => `${k}=${v}`)].join(' '),
        };
        window.util = { escapeHTML: (text) => String(text) };
        window.eval(read('public/js/common/urlQuery.js'));
        for (const name of ['Model', 'GradeRamp', 'SlopePanel', 'UrlSync']) {
            const dir = name === 'GradeRamp' ? 'common' : 'access-score/src';  // The ramp is shared with the API docs.
            window.eval(`${read(`public/js/${dir}/AccessScore${name}.js`)}
                window.AccessScore${name} = AccessScore${name};`);
        }
        ({ AccessScoreModel, AccessScoreSlopePanel, AccessScoreUrlSync } = window);
    });

    /** Builds the panel over fresh markup, collecting what it emits. */
    function mount(config = CONFIG, impact = () => ({ reached: 0, full: 0, barriers: 0, scored: 0 })) {
        document.body.innerHTML = MARKUP;
        const emitted = [];
        const panel = new AccessScoreSlopePanel(document.body, config, (partial, meta) =>
            emitted.push({ partial, meta }), impact);
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
            const { grade_scoring: gradeScoring, ...older } = CONFIG;
            expect(gradeScoring).toBeDefined();
            expect(mount(older).panel.available).toBe(false);
            expect(document.getElementById('acs-slope-section').hidden).toBe(true);
            const unsampled = { ...CONFIG, grade: { ...GRADIENT, sources: [] } };
            expect(mount(unsampled).panel.available).toBe(false);
            expect(mount().panel.available).toBe(true);
            expect(document.getElementById('acs-slope-section').hidden).toBe(false);
        });

        test('shows the engine defaults as percentages, offers its statistics, and has nothing to reset', () => {
            const { el } = mount();
            expect(el('acs-slope-weight').value).toBe(String(CONFIG.grade_scoring.defaults.weight));
            expect(el('acs-slope-weight-value').textContent).toBe('×1.00');
            expect(el('acs-slope-statistic').value).toBe('max_grade');
            expect(el('acs-slope-weight').max).toBe(String(CONFIG.grade_scoring.weight_range.max));
            expect(el('acs-slope-low').value).toBe('5');
            expect(el('acs-slope-high').value).toBe('8.3');
            expect(el('acs-slope-low').min).toBe('1');
            expect(el('acs-slope-low').max).toBe('40');
            expect([...el('acs-slope-statistic').options].map((o) => o.value)).toEqual(CONFIG.grade_scoring.statistics);
            expect(el('acs-slope-reset').hidden).toBe(true);
            expect(el('acs-slope-summary').textContent).toBe('');
            expect(el('acs-slope-barrier-threshold').disabled).toBe(true);
            expect(el('acs-slope-barrier-threshold').value).toBe('12.5');
            expect(el('acs-slope-fixed-note').textContent).toBe('');
        });

        test('a slider drag reports unsettled values, then one settled one, and marks the section custom', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-weight'), 1.25, 'input');
            edit(el('acs-slope-weight'), 1.25, 'change');
            expect(emitted.map((e) => e.meta.final)).toEqual([false, true]);
            expect(emitted[1]).toEqual({
                partial: { slope: { weight: 1.25 } }, meta: { kind: 'GradeWeight', value: 1.25, final: true },
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
            expect(emitted[0].meta).toEqual({ kind: 'GradeThreshold', value: 'low_value=8', final: true });
            // Empty, not a number, outside the config's range, and past the other threshold (8.33%).
            for (const bad of ['', 'abc', '0.5', '41', '8.4', '9']) {
                edit(el('acs-slope-low'), bad);
                expect(el('acs-slope-low').value).toBe('8');
            }
            edit(el('acs-slope-high'), 8);
            expect(el('acs-slope-high').value).toBe('8.3');
            expect(emitted).toHaveLength(1);
        });

        test('holds the grade it shows: a second decimal is rounded away before it is emitted', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-high'), '9.26');
            expect(el('acs-slope-high').value).toBe('9.3');
            expect(emitted[0].partial.slope.highThreshold).toBeCloseTo(0.093, 12);
        });

        test('the over-limit statistic disables the thresholds and says why', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-statistic'), 'meters_over_limit');
            expect(emitted[0].partial).toEqual({ slope: { statistic: 'meters_over_limit' } });
            expect(el('acs-slope-low').disabled).toBe(true);
            expect(el('acs-slope-high').disabled).toBe(true);
            // The reason names the config's two limits, in a status region a screen reader hears it from.
            expect(el('acs-slope-fixed-note').getAttribute('role')).toBe('status');
            expect(el('acs-slope-fixed-note').textContent).toBe('accessscore:slope-fixed-note low=5% high=8.3%');
            edit(el('acs-slope-statistic'), 'max_grade');
            expect(el('acs-slope-low').disabled).toBe(false);
            expect(el('acs-slope-fixed-note').textContent).toBe('');
        });

        test('the barrier grade is only editable while the barrier is on', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-barrier'), true);
            expect(emitted[0]).toEqual({
                partial: { slope: { barrierEnabled: true } }, meta: { kind: 'GradeBarrier', value: true, final: true },
            });
            expect(el('acs-slope-barrier-threshold').disabled).toBe(false);
            edit(el('acs-slope-approximate'), true);
            expect(emitted[1]).toEqual({
                partial: { slope: { includeApproximate: true } },
                meta: { kind: 'GradeApproximate', value: true, final: true },
            });
        });

        test('switching the barrier off returns its grade to the default, so "Custom" never outlives a reload', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-barrier'), true);
            edit(el('acs-slope-barrier-threshold'), 20);
            expect(el('acs-slope-reset').hidden).toBe(false);
            edit(el('acs-slope-barrier'), false);
            expect(emitted[emitted.length - 1].partial.slope).toEqual({
                barrierEnabled: false, barrierThreshold: CONFIG.grade_scoring.defaults.barrier_threshold,
            });
            expect(el('acs-slope-barrier-threshold').value).toBe('12.5');
            expect(el('acs-slope-reset').hidden).toBe(true);
        });

        test('reset returns every control to the engine defaults and reports the full settings', () => {
            const { emitted, el } = mount();
            edit(el('acs-slope-weight'), 2, 'change');
            edit(el('acs-slope-barrier'), true);
            el('acs-slope-reset').click();
            expect(emitted[emitted.length - 1]).toEqual({
                partial: { slope: AccessScoreModel.slopeDefaults(CONFIG) }, meta: { kind: 'GradeReset', final: true },
            });
            expect(el('acs-slope-weight').value).toBe(String(CONFIG.grade_scoring.defaults.weight));
            expect(el('acs-slope-barrier').checked).toBe(false);
            expect(el('acs-slope-reset').hidden).toBe(true);
        });

        test('a weight of 0 reads "Off" and mutes its row: the term is out of the score, not merely small', () => {
            const { el } = mount();
            expect(el('acs-slope-weight-row').classList.contains('acs-weight--off')).toBe(false);
            edit(el('acs-slope-weight'), 0, 'input');
            expect(el('acs-slope-weight-value').textContent).toBe('accessscore:weight-off');
            expect(el('acs-slope-weight-row').classList.contains('acs-weight--off')).toBe(true);
            edit(el('acs-slope-weight'), 0.05, 'input');
            expect(el('acs-slope-weight-value').textContent).toBe('×0.05');
            expect(el('acs-slope-weight-row').classList.contains('acs-weight--off')).toBe(false);
        });

        test('reports what the settings reach, so a weight of 0 and a threshold nothing passes read apart', () => {
            let impact = { reached: 4, full: 1, barriers: 0, scored: 20 };
            const { panel, el } = mount(CONFIG, () => impact);
            expect(el('acs-slope-impact').textContent)
                .toBe('accessscore:slope-impact reached=4 full=1 barriers=0 scored=20');
            // The line is refreshed once the model has recomputed, which is what the page does after each change;
            // the barrier's own count joins it only while the barrier is on.
            edit(el('acs-slope-barrier'), true);
            impact = { reached: 4, full: 1, barriers: 2, scored: 20 };
            panel.refreshImpact();
            expect(el('acs-slope-impact').textContent)
                .toBe('accessscore:slope-impact-barriers reached=4 full=1 barriers=2 scored=20');
        });

        test('the heading folds the section and reports the fold', () => {
            const { panel, emitted, el } = mount();
            el('acs-slope-toggle').click();
            expect(panel.open).toBe(true);
            expect(el('acs-slope').hidden).toBe(false);
            expect(el('acs-slope-toggle').querySelector('img').getAttribute('src')).toBe('up.svg');
            expect(emitted[0]).toEqual({ partial: null, meta: { kind: 'Section', value: 'grade_open=true', final: true } });
        });
    });

    describe('the slope URL param', () => {
        test('reads each token against the config and drops what it does not allow', () => {
            const { state } = AccessScoreUrlSync.read(CONFIG, '?gs=w:1.5,s:max_grade,lo:0.08,hi:0.1,b:0.15,ap:1');
            expect(state.slope).toEqual({
                weight: 1.5, statistic: 'max_grade', lowThreshold: 0.08, highThreshold: 0.1, barrierEnabled: true,
                barrierThreshold: 0.15, includeApproximate: true,
            });
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=w:-1,s:steepness,lo:0.9,hi:abc,b:0,ap:0,zz:1,nocolon')
                .state.slope).toBeUndefined();
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=w:2,s:steepness').state.slope).toEqual({ weight: 2 });
            const { grade_scoring: gradeScoring, ...older } = CONFIG;
            expect(gradeScoring).toBeDefined();
            expect(AccessScoreUrlSync.read(older, '?gs=w:2').state.slope).toBeUndefined();
        });

        test('holds a weight to the slider\'s range, so the control and the map cannot disagree', () => {
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=w:50').state.slope)
                .toEqual({ weight: CONFIG.grade_scoring.weight_range.max });
        });

        test('drops thresholds that cross, as a pair, whether one came from the link or both', () => {
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=w:1,lo:0.2,hi:0.1').state.slope).toEqual({ weight: 1 });
            // 0.2 alone crosses the default high threshold of 8.33%.
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=w:1,lo:0.2').state.slope).toEqual({ weight: 1 });
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=lo:0.06').state.slope).toEqual({ lowThreshold: 0.06 });
        });

        test('carries a slope-class brush in `gc`, and never beside a score range', () => {
            // Four breaks make five classes, 0 through 4, plus `n` for the streets with no slope at all.
            expect(AccessScoreUrlSync.read(CONFIG, '?gc=0,4,n').dock.brush)
                .toEqual({ kind: 'grade', classes: [-1, 0, 4] });
            expect(AccessScoreUrlSync.read(CONFIG, '?gc=2').dock.brush).toEqual({ kind: 'grade', classes: [2] });
            // A score range wins where a hand-edited link carries both: one brush is in force at a time.
            expect(AccessScoreUrlSync.read(CONFIG, '?b=40-60&gc=2').dock.brush)
                .toEqual({ kind: 'score', from: 4, to: 6 });
            // Out of range, not a number, empty, and a city with no classes to have brushed on.
            for (const gc of ['5', '9', 'abc', '', ',']) {
                expect(AccessScoreUrlSync.read(CONFIG, `?gc=${gc}`).dock.brush).toBeNull();
            }
            const unsampled = { ...CONFIG, grade: { ...GRADIENT, sources: [] } };
            expect(AccessScoreUrlSync.read(unsampled, '?gc=2').dock.brush).toBeNull();
        });

        test('writes a slope-class brush and reads it back unchanged', () => {
            window.history.replaceState(null, '', '/accessScore');
            const model = new AccessScoreModel(CONFIG, EMPTY, EMPTY, []);
            const map = { on: () => {}, getCenter: () => ({ lat: 40.88, lng: -74.01 }), getZoom: () => 13 };
            const sync = new AccessScoreUrlSync(model, map);
            const params = () => new URLSearchParams(window.location.search);
            sync.setDock({ open: true, brush: { kind: 'grade', classes: [-1, 3, 4] }, focus: null });
            sync.writeNow();
            expect(params().get('gc')).toBe('n,3,4');
            expect(params().has('b')).toBe(false);
            expect(AccessScoreUrlSync.read(CONFIG, window.location.search).dock.brush)
                .toEqual({ kind: 'grade', classes: [-1, 3, 4] });
            // A score brush takes the URL back over, and `gc` goes with the selection it described.
            sync.setDock({ open: true, brush: { kind: 'score', from: 4, to: 6 }, focus: null });
            sync.writeNow();
            expect(params().get('b')).toBe('40-60');
            expect(params().has('gc')).toBe(false);
        });

        test('reads nothing in a city with no slopes, where no section exists to show or undo it', () => {
            const unsampled = { ...CONFIG, grade: { ...GRADIENT, sources: [] } };
            expect(AccessScoreUrlSync.read(unsampled, '?gs=w:2,b:0.05').state.slope).toBeUndefined();
        });

        test('a partial from a link merges over the engine defaults in the model', () => {
            const { state } = AccessScoreUrlSync.read(CONFIG, '?gs=w:2');
            const model = new AccessScoreModel(CONFIG, EMPTY, EMPTY, [], state);
            expect(model.state.slope.weight).toBe(2);
            expect(model.state.slope.highThreshold).toBe(CONFIG.grade_scoring.defaults.high_threshold);
        });

        test('writes only the settings that differ, and nothing at the defaults', () => {
            window.history.replaceState(null, '', '/accessScore');
            const model = new AccessScoreModel(CONFIG, EMPTY, EMPTY, []);
            const map = { on: () => {}, getCenter: () => ({ lat: 40.88, lng: -74.01 }), getZoom: () => 13 };
            const sync = new AccessScoreUrlSync(model, map);
            const param = () => new URLSearchParams(window.location.search).get('gs');
            sync.writeNow();
            expect(param()).toBeNull();
            model.setState({ slope: { weight: 1.5, statistic: 'mean_grade', barrierEnabled: true } });
            sync.writeNow();
            expect(param()).toBe('w:1.5,s:mean_grade,b:0.125');
            const back = AccessScoreUrlSync.read(CONFIG, window.location.search).state.slope;
            expect(back).toEqual({ weight: 1.5, statistic: 'mean_grade', barrierEnabled: true, barrierThreshold: 0.125 });

            // A grade that is a default with no short decimal (1/12) is written to five places and read back as
            // exactly the default, so a round trip cannot move a street across the threshold.
            model.setState({ slope: { barrierThreshold: 1 / 12, lowThreshold: 0.02, highThreshold: 0.0765 } });
            sync.writeNow();
            expect(param()).toBe('w:1.5,s:mean_grade,lo:0.02,hi:0.0765,b:0.08333');
            const snapped = AccessScoreUrlSync.read(CONFIG, window.location.search).state.slope;
            expect(snapped.barrierThreshold).toBe(0.08333);
            expect(AccessScoreUrlSync.read(CONFIG, '?gs=hi:0.08333,lo:0.06').state.slope.highThreshold).toBe(1 / 12);
            model.setState({ slope: AccessScoreModel.slopeDefaults(CONFIG) });
            sync.writeNow();
            expect(param()).toBeNull();
        });
    });
});
