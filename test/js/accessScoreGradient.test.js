/**
 * Tests for the street-slope side of the AccessScore tool (#5223): the slope fields the model carries per street,
 * the classed grade ramp the map and legend share, the legend's classes as a brush, the elevation profile's SVG,
 * and the `grade` URL param.
 *
 * How slope enters the score is pinned by accessScoreModel.test.js against the parity fixture; the fixture supplies
 * only a real engine config here.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const FIXTURE = JSON.parse(read('test/fixtures/accessScoreParity.json'));

const GRADIENT = {
    walking_surface_limit: 0.05,
    ramp_limit: 1 / 12,
    map_class_breaks: [1 / 48, 0.05, 1 / 12, 0.125],
    sources: [{
        dem_source: 'usgs-3dep-10m', title: 'USGS 3DEP', credit: 'Elevation: USGS', licence: 'Public domain',
        url: 'https://www.usgs.gov/3d-elevation-program', street_count: 3,
    }],
};
const CONFIG = { ...FIXTURE.config, gradient: GRADIENT };
const EMPTY = { type: 'FeatureCollection', features: [] };

/** A street feature with whatever slope fields a case names. */
function street(id, slope = {}, auditCount = 1) {
    return {
        type: 'Feature',
        geometry: null,
        properties: {
            street_edge_id: id, region_id: 1, audit_count: auditCount, length_meters: 100,
            severity_counts: {}, tag_adjustments: {}, cluster_counts: {}, ...slope,
        },
    };
}

const MEASURED = {
    mean_grade: 0.062, max_grade: 0.091, net_grade: -0.04, total_climb_meters: 1.5, total_descent_meters: 5.5,
    meters_over_5pct: 40, meters_over_8pct: 10, grade_confidence: 'high', grade_quality: 'measured',
    dem_source: 'usgs-3dep-10m',
};
const STRUCTURE = {
    mean_grade: null, max_grade: null, net_grade: null, total_climb_meters: null, total_descent_meters: null,
    meters_over_5pct: null, meters_over_8pct: null, grade_confidence: 'high', grade_quality: 'structure',
    dem_source: 'usgs-3dep-10m',
};
const NET_ONLY = { ...STRUCTURE, net_grade: -0.03, grade_confidence: 'low', grade_quality: 'measured' };

describe('street slope in the AccessScore tool', () => {
    let AccessScoreModel;
    let AccessScoreGradeRamp;
    let AccessScoreElevationProfile;
    let AccessScoreUrlSync;

    beforeAll(() => {
        // The legend's copy comes through i18next, so `t` echoes the key and whatever was interpolated into it.
        window.i18next = {
            language: 'en',
            exists: (key) => key.startsWith('accessscore:slope-statistic-'),
            t: (key, values = {}) => [key, ...Object.entries(values)
                .filter(([k]) => k !== 'interpolation').map(([k, v]) => `${k}=${v}`)].join(' '),
        };
        window.util = { escapeHTML: (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') };
        window.eval(read('public/js/common/scoreRamp.js'));
        for (const name of ['Model', 'GradeRamp', 'ElevationProfile', 'MapLegend', 'UrlSync']) {
            if (name === 'UrlSync') window.eval(read('public/js/common/urlQuery.js'));
            window.eval(`${read(`public/js/access-score/src/AccessScore${name}.js`)}
                window.AccessScore${name} = AccessScore${name};`);
        }
        ({ AccessScoreModel, AccessScoreGradeRamp, AccessScoreElevationProfile, AccessScoreUrlSync } = window);
        for (let i = 1; i <= 5; i++) {
            document.documentElement.style.setProperty(`--color-grade-ramp-${i}`, `#00000${i}`);
            document.documentElement.style.setProperty(`--color-grade-ramp-dark-${i}`, `#fffff${i}`);
        }
    });

    describe('AccessScoreModel', () => {
        const streets = {
            type: 'FeatureCollection',
            features: [street(1, MEASURED), street(2, STRUCTURE), street(3, NET_ONLY, 0), street(4)],
        };
        let model;
        beforeAll(() => {
            model = new AccessScoreModel(CONFIG, streets, EMPTY, []);
        });

        test('explains a sampled street with its slope, in the model\'s own names', () => {
            expect(model.explainStreet(1).gradient).toEqual({
                meanGrade: 0.062, maxGrade: 0.091, netGrade: -0.04, climbM: 1.5, descentM: 5.5, metersOver5pct: 40,
                metersOver8pct: 10, confidence: 'high', quality: 'measured', demSource: 'usgs-3dep-10m',
            });
        });

        test('a street the API reports no elevation model for has no slope at all', () => {
            expect(model.explainStreet(4).gradient).toBeNull();
            expect(model.displayGrade(4)).toBeNull();
            expect(model.displayGrade(999)).toBeNull();
        });

        test('draws a street by the statistic the score is on, by its net grade where that is all there is', () => {
            // The engine's own statistic is the steepest stretch, so that is what the map paints.
            expect(model.displayGradeStatistic).toBe('max_grade');
            expect(model.displayGrade(1)).toBe(0.091);
            expect(model.gradeBy(1, 'mean_grade')).toBe(0.062);
            expect(model.displayGrade(3)).toBe(0.03);
            // A bridge has a row and no grade: known to the model, blank on the map.
            expect(model.explainStreet(2).gradient.quality).toBe('structure');
            expect(model.displayGrade(2)).toBeNull();
            // Switching the scoring statistic moves the coloring with it, so the map cannot paint a street gentle
            // while the score penalizes it for a pitch the mean hid.
            model.setState({ slope: { statistic: 'mean_grade' } });
            expect(model.displayGrade(1)).toBe(0.062);
            // The over-limit statistic is a length, not a grade, so the map falls back to the steepest stretch.
            model.setState({ slope: { statistic: 'meters_over_limit' } });
            expect(model.displayGradeStatistic).toBe('max_grade');
            expect(model.displayGrade(1)).toBe(0.091);
            model.setState({ slope: { statistic: CONFIG.slope.defaults.statistic } });
        });

        test('reads the legend\'s classes back into streets, the no-grade ones included', () => {
            const breaks = CONFIG.gradient.map_class_breaks;
            // Street 1's steepest stretch (9.1%) is over the ramp limit; street 3 stands in its 3% net grade.
            expect(AccessScoreGradeRamp.classIndexOf(model.displayGrade(1), breaks)).toBe(3);
            expect(AccessScoreGradeRamp.classIndexOf(model.displayGrade(3), breaks)).toBe(1);
            // A street at a break is within the gentler class: "not steeper than 1:20" means 5% is class 1.
            expect(AccessScoreGradeRamp.classIndexOf(0.05, breaks)).toBe(1);
            expect(AccessScoreGradeRamp.classIndexOf(null, breaks)).toBe(AccessScoreGradeRamp.NO_GRADE);
            expect(model.streetIdsInGradeClasses([3], breaks)).toEqual(new Set([1]));
            expect(model.streetIdsInGradeClasses([1, 3], breaks)).toEqual(new Set([1, 3]));
            // The bridge and the unsampled street are the no-grade class, which the legend offers like any other.
            expect(model.streetIdsInGradeClasses([AccessScoreGradeRamp.NO_GRADE], breaks)).toEqual(new Set([2, 4]));
            expect(model.streetIdsInGradeClasses([], breaks)).toEqual(new Set());
        });

        test('an unaudited street keeps its slope while it has no score', () => {
            const s = model.explainStreet(3);
            expect(s.score).toBeNull();
            expect(s.gradient.netGrade).toBe(-0.03);
        });

        test('coloring by slope is off by default and leaves every score alone when switched on', () => {
            expect(AccessScoreModel.DEFAULT_STATE.showGrade).toBe(false);
            const before = Array.from(model.streetScores);
            expect(model.setState({ showGrade: true }).showGrade).toBe(true);
            expect(Array.from(model.streetScores)).toEqual(before);
            model.setState({ showGrade: false });
        });
    });

    describe('AccessScoreGradeRamp', () => {
        const breaks = GRADIENT.map_class_breaks;

        /** Evaluates the `case`/`step` expression the way Mapbox does: the last stop at or below the input wins. */
        function colorOf(expr, grade) {
            if (grade < 0) return expr[2];
            const step = expr[3];
            if (!Array.isArray(step)) return step;
            let color = step[2];
            for (let i = 3; i < step.length; i += 2) if (grade >= step[i]) color = step[i + 1];
            return color;
        }

        test('a street exactly at a limit is colored as within it, and anything over as the next class', () => {
            const expr = AccessScoreGradeRamp.expression(['get', 'grade'], breaks, { noneColor: '#999999' });
            expect(colorOf(expr, -1)).toBe('#999999');
            expect(colorOf(expr, 0)).toBe('#000001');
            // Every break, exactly: "not steeper than 1:20" includes 1:20, which a bare `step` would put above it.
            breaks.forEach((b, i) => {
                expect(colorOf(expr, b)).toBe(`#00000${i + 1}`);
                expect(colorOf(expr, b + 1e-9)).toBe(`#00000${i + 2}`);
                expect(colorOf(expr, b - 1e-9)).toBe(`#00000${i + 1}`);
            });
            expect(colorOf(expr, 0.5)).toBe('#000005');
        });

        test('with no breaks there is one class and no `step`, which Mapbox would reject without stops', () => {
            const expr = AccessScoreGradeRamp.expression(['get', 'grade'], [], { noneColor: '#999999' });
            expect(expr).toEqual(['case', ['<', ['get', 'grade'], 0], '#999999', '#000005']);
        });

        test('warns when the backend publishes more classes than there are colors to tell them apart', () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            AccessScoreGradeRamp.colors(5);
            expect(warn).not.toHaveBeenCalled();
            const six = AccessScoreGradeRamp.colors(6);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(new Set(six).size).toBeLessThan(6);
            warn.mockRestore();
        });

        test('reads one token per class, the dark set on the dark basemap', () => {
            expect(AccessScoreGradeRamp.colors(5)).toEqual(['#000001', '#000002', '#000003', '#000004', '#000005']);
            expect(AccessScoreGradeRamp.colors(5, 'dark')[4]).toBe('#fffff5');
        });

        test('spreads fewer classes over the whole ramp, so the steepest is always the last color', () => {
            expect(AccessScoreGradeRamp.colors(3)).toEqual(['#000001', '#000003', '#000005']);
            expect(AccessScoreGradeRamp.colors(1)).toEqual(['#000005']);
        });

        test('builds a step expression with a fallback for a street with no grade', () => {
            const expr = AccessScoreGradeRamp.expression(['get', 'grade'], breaks, { noneColor: '#999999' });
            expect(expr[0]).toBe('case');
            expect(expr[1]).toEqual(['<', ['get', 'grade'], 0]);
            expect(expr[2]).toBe('#999999');
            const step = expr[3];
            expect(step.slice(0, 3)).toEqual(['step', ['get', 'grade'], '#000001']);
            // Four breaks, each followed by the color of the class above it, ascending as `step` requires.
            const stops = step.slice(3).filter((_, i) => i % 2 === 0);
            expect(stops).toHaveLength(4);
            expect([...stops].sort((a, b) => a - b)).toEqual(stops);
            expect(stops[1]).toBeGreaterThan(0.05);
            expect(step[step.length - 1]).toBe('#000005');
        });

        test('lists the classes open-ended at both ends for the legend', () => {
            const classes = AccessScoreGradeRamp.classes(breaks);
            expect(classes).toHaveLength(5);
            expect(classes[0]).toEqual({ from: null, to: breaks[0], color: '#000001' });
            expect(classes[4]).toEqual({ from: breaks[3], to: null, color: '#000005' });
        });

        test('formats a grade as the percentage people read', () => {
            expect(AccessScoreGradeRamp.percent(0.05)).toBe('5%');
            expect(AccessScoreGradeRamp.percent(1 / 12)).toBe('8.3%');
        });

        test('classIndexOf agrees with the coloring expression on every break and on a missing grade', () => {
            const expr = AccessScoreGradeRamp.expression(['get', 'grade'], breaks, { noneColor: '#999999' });
            for (const grade of [0, 0.01, ...breaks.flatMap((b) => [b - 1e-9, b, b + 1e-9]), 0.5]) {
                const index = AccessScoreGradeRamp.classIndexOf(grade, breaks);
                expect(colorOf(expr, grade)).toBe(AccessScoreGradeRamp.colors(breaks.length + 1)[index]);
            }
            for (const none of [null, undefined, -1, NaN]) {
                expect(AccessScoreGradeRamp.classIndexOf(none, breaks)).toBe(AccessScoreGradeRamp.NO_GRADE);
            }
        });
    });

    describe('AccessScoreMapLegend', () => {
        const breaks = GRADIENT.map_class_breaks;
        let legend;
        let selected;

        /** Adds a legend to the document and shows its slope classes, as the map view does. */
        function mount() {
            selected = [];
            legend = new window.AccessScoreMapLegend({ gradeBreaks: breaks, onGradeClasses: (c) => selected.push(c) });
            document.body.innerHTML = '';
            document.body.appendChild(legend.onAdd());
            legend.setGrade(true, 'max_grade');
            return [...document.querySelectorAll('.acs-map-legend__class')];
        }

        /** A click carrying the modifiers a pointer would. */
        const click = (button, modifiers = {}) =>
            button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...modifiers }));

        test('offers one button per class plus the no-slope one, and names the statistic it is classing', () => {
            const buttons = mount();
            expect(buttons).toHaveLength(breaks.length + 2);
            expect(buttons.map((b) => Number(b.dataset.class)))
                .toEqual([0, 1, 2, 3, 4, AccessScoreGradeRamp.NO_GRADE]);
            expect(buttons.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
            const title = document.querySelector('.acs-map-legend__title').textContent;
            expect(title).toContain('accessscore:slope-statistic-max-grade');
            legend.setGrade(true, 'mean_grade');
            expect(document.querySelector('.acs-map-legend__title').textContent)
                .toContain('accessscore:slope-statistic-mean-grade');
        });

        test('a click selects one class, and the same click again clears it', () => {
            const buttons = mount();
            click(buttons[3]);
            expect(selected).toEqual([[3]]);
            expect(buttons[3].getAttribute('aria-pressed')).toBe('true');
            // Everything outside the selection is muted rather than hidden: it is still the legend.
            expect(buttons[0].classList.contains('acs-map-legend__class--out')).toBe(true);
            click(buttons[3]);
            expect(selected[1]).toEqual([]);
            expect(buttons.some((b) => b.classList.contains('acs-map-legend__class--out'))).toBe(false);
        });

        test('ctrl or cmd click adds a class and takes one away, and a plain click starts over', () => {
            const buttons = mount();
            click(buttons[1]);
            click(buttons[4], { ctrlKey: true });
            expect(selected[1]).toEqual([1, 4]);
            click(buttons[5], { metaKey: true });
            expect(selected[2]).toEqual([AccessScoreGradeRamp.NO_GRADE, 1, 4]);
            click(buttons[1], { ctrlKey: true });
            expect(selected[3]).toEqual([AccessScoreGradeRamp.NO_GRADE, 4]);
            click(buttons[2]);
            expect(selected[4]).toEqual([2]);
        });

        test('shift click extends a run over the scale, and Escape clears', () => {
            const buttons = mount();
            click(buttons[1]);
            click(buttons[4], { shiftKey: true });
            expect(selected[1]).toEqual([1, 2, 3, 4]);
            // The no-slope class is not on the scale, so it joins one at a time rather than filling a run.
            click(buttons[5], { shiftKey: true });
            expect(selected[2]).toEqual([AccessScoreGradeRamp.NO_GRADE, 1, 2, 3, 4]);
            buttons[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(selected[3]).toEqual([]);
        });

        test('takes the keyboard with one tab stop, and reflects a selection it was handed', () => {
            const buttons = mount();
            expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
            buttons[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            expect(buttons[1].tabIndex).toBe(0);
            expect(document.activeElement).toBe(buttons[1]);
            buttons[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            expect(document.activeElement).toBe(buttons[buttons.length - 1]);
            // Told, not asked: a selection from a link or from the dock's Clear emits nothing back.
            legend.setSelection([2, 4]);
            expect(selected).toEqual([]);
            expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
            expect(buttons[4].getAttribute('aria-pressed')).toBe('true');
            legend.setSelection([]);
            expect(buttons.some((b) => b.classList.contains('acs-map-legend__class--out'))).toBe(false);
        });

        test('a basemap swap rebuilds the rows and keeps the selection pressed', () => {
            const buttons = mount();
            click(buttons[3]);
            legend.setDark(true);
            const rebuilt = [...document.querySelectorAll('.acs-map-legend__class')];
            expect(rebuilt[3].getAttribute('aria-pressed')).toBe('true');
            expect(rebuilt[0].classList.contains('acs-map-legend__class--out')).toBe(true);
        });
    });

    describe('AccessScoreElevationProfile', () => {
        // Four 10 m stretches: level, 10% up (8.33–12.5%), 15% up (over 12.5%), 1% up.
        const PROFILE = { spacing_meters: 10, elevations_meters: [100, 100, 101, 102.5, 102.6] };
        const BREAKS = GRADIENT.map_class_breaks;

        /** Draws PROFILE into a fresh slot and returns it with the log calls it makes. */
        function mount({ steepest = { from: 10, to: 30, grade: 0.125 }, label = 'Profile label' } = {}) {
            document.body.innerHTML = '<div id="slot"></div>';
            const logged = [];
            const slot = document.getElementById('slot');
            new AccessScoreElevationProfile(slot, PROFILE, {
                breaks: BREAKS, steepest, label, onLog: (kind, value) => logged.push([kind, value]),
            });
            return { slot, logged, rows: [...slot.querySelectorAll('.acs-profile__class')] };
        }

        test('analyzes each stretch into a signed grade and a slope class, and sums the length per class', () => {
            const { stretches, lengths, length } = AccessScoreElevationProfile.analyze(PROFILE, BREAKS);
            expect(stretches.map((s) => s.classIndex)).toEqual([0, 3, 4, 0]);
            expect(stretches[1].grade).toBeCloseTo(0.1);
            expect(AccessScoreElevationProfile.analyze(
                { spacing_meters: 10, elevations_meters: [101, 100] }, BREAKS).stretches[0].grade).toBeCloseTo(-0.1);
            expect([...lengths.entries()]).toEqual([[0, 20], [3, 10], [4, 10]]);
            expect(length).toBe(40);
        });

        test('draws one colored stretch of line and ground per pair of samples, as a slider over the stretches', () => {
            const { slot } = mount();
            const svg = slot.querySelector('svg.acs-profile__chart');
            // A slider, not an image: browse mode steps past an image without handing it the arrow keys.
            expect(svg.getAttribute('role')).toBe('slider');
            expect(svg.getAttribute('tabindex')).toBe('0');
            expect(svg.getAttribute('aria-label')).toBe('Profile label');
            expect(svg.getAttribute('aria-valuemin')).toBe('0');
            expect(svg.getAttribute('aria-valuemax')).toBe('3');
            expect(svg.getAttribute('aria-valuetext')).toContain('accessscore:profile-readout-level');
            const list = slot.querySelector('.acs-profile__legend');
            expect(document.getElementById(list.getAttribute('aria-labelledby')).textContent)
                .toContain('accessscore:profile-legend-title');
            expect(slot.querySelectorAll('.acs-profile__stroke')).toHaveLength(4);
            expect([...slot.querySelectorAll('.acs-profile__ground')].map((g) => g.dataset.class))
                .toEqual(['0', '3', '4', '0']);
        });

        test('lists the classes the street has, steepest first, each with its length', () => {
            const { rows } = mount();
            expect(rows.map((r) => r.dataset.class)).toEqual(['4', '3', '0']);
            expect(rows[0].textContent).toContain('accessscore:grade-class-over');
            expect(rows[0].querySelector('.acs-profile__length').textContent).toContain('meters=10');
            expect(rows[2].querySelector('.acs-profile__length').textContent).toContain('meters=20');
            expect(rows[0].querySelector('.acs-profile__share-fill').style.width).toBe('25%');
            expect(rows.every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(true);
        });

        test("brackets the backend's steepest stretch where it says, with its length and grade", () => {
            const { slot } = mount();
            const callout = slot.querySelector('.acs-profile__callout').textContent;
            expect(callout).toContain('accessscore:profile-steepest');
            expect(callout).toContain('meters=20');
            expect(callout).toContain('grade=12.5%');
            // The bracket starts where the second stretch's ground does and ends where the third's does.
            const bracket = slot.querySelector('.acs-profile__bracket').getAttribute('d').match(/[\d.]+/g).map(Number);
            const groundX = (i) => Number(slot.querySelectorAll('.acs-profile__ground')[i].getAttribute('d')
                .match(/M([\d.]+)/)[1]);
            expect(bracket[0]).toBeCloseTo(groundX(1), 0);
            expect(bracket[3]).toBeCloseTo(groundX(3), 0);
        });

        test('draws no bracket where the backend placed no steepest stretch', () => {
            const { slot } = mount({ steepest: null });
            expect(slot.querySelector('.acs-profile__bracket')).toBeNull();
            expect(slot.querySelector('.acs-profile__callout')).toBeNull();
        });

        test('a legend row previews its stretches on hover and pins them on press, several at a time', () => {
            const { slot, logged, rows } = mount();
            const figure = slot.querySelector('.acs-profile');
            const lit = () => [...slot.querySelectorAll('.acs-profile__ground')]
                .map((g) => g.classList.contains('acs-profile__mark--on'));

            rows[2].dispatchEvent(new Event('pointerenter'));
            expect(figure.classList.contains('acs-profile--filtered')).toBe(true);
            expect(lit()).toEqual([true, false, false, true]);
            rows[2].dispatchEvent(new Event('pointerleave'));
            expect(figure.classList.contains('acs-profile--filtered')).toBe(false);

            rows[0].click();
            rows[1].click();
            expect(lit()).toEqual([false, true, true, false]);
            expect(rows[0].getAttribute('aria-pressed')).toBe('true');
            // Two adjacent pinned stretches make one run of steep street, not two.
            const readout = slot.querySelector('.acs-profile__readout').textContent;
            expect(readout).toContain('accessscore:profile-highlight');
            expect(readout).toContain('count=1');
            expect(readout).toContain('meters=20');
            expect(logged).toEqual([['ProfileClass', '4_value=true'], ['ProfileClass', '3_value=true']]);

            rows[0].click();
            expect(rows[0].getAttribute('aria-pressed')).toBe('false');
            expect(lit()).toEqual([false, true, false, false]);
        });

        test('stepping along the chart lights the legend row of the stretch under the cursor, with its grade', () => {
            const { slot, logged, rows } = mount();
            const svg = slot.querySelector('svg.acs-profile__chart');
            const readout = slot.querySelector('.acs-profile__readout');
            const at = () => rows.filter((r) => r.classList.contains('acs-profile__class--at'))
                .map((r) => r.dataset.class);

            svg.dispatchEvent(new Event('focus'));
            expect(at()).toEqual(['0']);
            expect(readout.textContent).toContain('accessscore:profile-readout-level');
            svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            expect(at()).toEqual(['4']);
            expect(readout.textContent).toContain('accessscore:profile-readout-up');
            expect(readout.textContent).toContain('grade=15%');
            expect(svg.getAttribute('aria-valuenow')).toBe('2');
            expect(svg.getAttribute('aria-valuetext')).toBe(readout.textContent);
            expect(slot.querySelector('.acs-profile__cursor').getAttribute('visibility')).toBe('visible');
            svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
            svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            expect(at()).toEqual(['0']);

            svg.dispatchEvent(new Event('blur'));
            expect(at()).toEqual([]);
            expect(readout.textContent).toBe('');
            expect(slot.querySelector('.acs-profile__cursor').getAttribute('visibility')).toBe('hidden');
            // A sweep along the chart is one interaction, logged once.
            expect(logged).toEqual([['ProfileScrub', undefined]]);
        });

        test('labels a crest partway along, but not a rise that tops out at an end', () => {
            document.body.innerHTML = '<div id="slot"></div>';
            const slot = document.getElementById('slot');
            const crest = { spacing_meters: 10, elevations_meters: [100, 101, 103, 104, 103, 101, 100] };
            new AccessScoreElevationProfile(slot, crest, { breaks: BREAKS, steepest: null, label: 'x' });
            expect(slot.querySelector('svg').textContent).toContain('accessscore:profile-high');
            expect(mount().slot.querySelector('svg').textContent).not.toContain('accessscore:profile-high');
        });

        test('escapes the accessible name, so a quote in a translation cannot close its attribute', () => {
            const { slot } = mount({ label: 'Profile "start" to <end>' });
            const svg = slot.querySelector('svg.acs-profile__chart');
            expect(svg.getAttribute('aria-label')).toBe('Profile "start" to <end>');
            expect(svg.hasAttribute('end')).toBe(false);
        });

        test('keeps the bracket on the chart where no sample falls under it', () => {
            // A fine model's 10 m stretch inside a 12 m street drawn from two samples: nothing lies between its ends.
            document.body.innerHTML = '<div id="slot"></div>';
            const slot = document.getElementById('slot');
            new AccessScoreElevationProfile(slot, { spacing_meters: 12, elevations_meters: [10, 10.6] }, {
                breaks: BREAKS, steepest: { from: 1, to: 11, grade: 0.06 }, label: 'x',
            });
            const numbers = slot.querySelector('.acs-profile__bracket').getAttribute('d').match(/-?[\d.]+|Infinity|NaN/g);
            expect(numbers.every((v) => Number.isFinite(Number(v)))).toBe(true);
            expect(Number(slot.querySelector('.acs-profile__callout').getAttribute('y'))).toBeGreaterThan(0);
        });

        test('draws no bracket for a stretch of no length or one past the drawn street', () => {
            for (const steepest of [{ from: 10, to: 10, grade: 0.1 }, { from: 60, to: 90, grade: 0.1 }]) {
                expect(mount({ steepest }).slot.querySelector('.acs-profile__bracket')).toBeNull();
            }
        });

        test('maps the pointer to the stretch under it, holding the nearest one in the pads either side', () => {
            const { slot, logged } = mount();
            const svg = slot.querySelector('svg.acs-profile__chart');
            svg.getBoundingClientRect = () => ({ left: 0, width: 340, top: 0, height: 132 });
            const readout = slot.querySelector('.acs-profile__readout');
            const move = (clientX) => svg.dispatchEvent(new MouseEvent('pointermove', { clientX }));
            move(2);
            expect(readout.textContent).toContain('accessscore:profile-readout-level');
            move(200);  // 48 + 244 * 0.62: the third stretch, the 15% one.
            expect(readout.textContent).toContain('grade=15%');
            move(338);
            expect(svg.getAttribute('aria-valuenow')).toBe('3');
            expect(logged).toEqual([['ProfileScrub', undefined]]);
        });

        test('a pointer leaving a focused chart hands the cursor back to the keyboard', () => {
            const { slot } = mount();
            const svg = slot.querySelector('svg.acs-profile__chart');
            svg.getBoundingClientRect = () => ({ left: 0, width: 340, top: 0, height: 132 });
            svg.focus();
            svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 338 }));
            expect(svg.getAttribute('aria-valuenow')).toBe('3');
            svg.dispatchEvent(new MouseEvent('pointerleave'));
            expect(svg.getAttribute('aria-valuenow')).toBe('1');
            svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            expect(svg.getAttribute('aria-valuenow')).toBe('2');
        });

        test('a Tab passing through the chart is not logged as a scrub', () => {
            const { slot, logged } = mount();
            slot.querySelector('svg.acs-profile__chart').dispatchEvent(new Event('focus'));
            expect(logged).toEqual([]);
        });

        test('once the cursor leaves, the readout returns to what the pinned rows cover', () => {
            const { slot, rows } = mount();
            const svg = slot.querySelector('svg.acs-profile__chart');
            const readout = slot.querySelector('.acs-profile__readout');
            rows[0].click();
            svg.dispatchEvent(new Event('focus'));
            expect(readout.textContent).toContain('accessscore:profile-readout');
            svg.dispatchEvent(new Event('blur'));
            expect(readout.textContent).toContain('accessscore:profile-highlight');
        });

        test("tabbing between rows keeps the preview of the row under the pointer", () => {
            const { slot, rows } = mount();
            const figure = slot.querySelector('.acs-profile');
            rows[2].dispatchEvent(new Event('pointerenter'));
            rows[0].dispatchEvent(new Event('focus'));
            rows[0].dispatchEvent(new Event('blur'));
            // The blur was row 0's own; row 2, still under the pointer, keeps its preview.
            expect(figure.classList.contains('acs-profile--filtered')).toBe(true);
            expect(slot.querySelector('.acs-profile__ground[data-class="0"]').classList
                .contains('acs-profile__mark--on')).toBe(true);
        });

        test('keeps a near-level street a flat line through the middle instead of magnifying its noise', () => {
            document.body.innerHTML = '<div id="slot"></div>';
            const slot = document.getElementById('slot');
            const level = { spacing_meters: 10, elevations_meters: [50, 50.02, 50] };
            new AccessScoreElevationProfile(slot, level, { breaks: BREAKS, steepest: null, label: 'x' });
            const ys = [...slot.querySelectorAll('.acs-profile__stroke')]
                .flatMap((p) => p.getAttribute('d').match(/,([\d.]+)/g).map((m) => Number(m.slice(1))));
            expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
        });

        test('says a profile too short to have a shape cannot be drawn', () => {
            expect(AccessScoreElevationProfile.canDraw(PROFILE)).toBe(true);
            expect(AccessScoreElevationProfile.canDraw({ spacing_meters: 0, elevations_meters: [12] })).toBe(false);
            expect(AccessScoreElevationProfile.canDraw({ spacing_meters: 0, elevations_meters: [12, 13] })).toBe(false);
            expect(AccessScoreElevationProfile.canDraw(null)).toBe(false);
        });
    });

    describe('AccessScoreUrlSync', () => {
        test('reads grade=1 only where the city has been sampled', () => {
            expect(AccessScoreUrlSync.read(CONFIG, '?grade=1').state.showGrade).toBe(true);
            expect(AccessScoreUrlSync.read(CONFIG, '?grade=0').state.showGrade).toBeUndefined();
            expect(AccessScoreUrlSync.read(CONFIG, '').state.showGrade).toBeUndefined();
            const unsampled = { ...FIXTURE.config, gradient: { ...GRADIENT, sources: [] } };
            expect(AccessScoreUrlSync.read(unsampled, '?grade=1').state.showGrade).toBeUndefined();
            expect(AccessScoreUrlSync.read(FIXTURE.config, '?grade=1').state.showGrade).toBeUndefined();
        });

        test('writes grade=1 while slope is shown and drops it at the default', () => {
            window.history.replaceState(null, '', '/accessScore');
            const model = new AccessScoreModel(CONFIG, EMPTY, EMPTY, []);
            const map = { on: () => {}, getCenter: () => ({ lat: 40.88, lng: -74.01 }), getZoom: () => 13 };
            const sync = new AccessScoreUrlSync(model, map);
            model.setState({ showGrade: true });
            sync.writeNow();
            expect(new URLSearchParams(window.location.search).get('grade')).toBe('1');
            model.setState({ showGrade: false });
            sync.writeNow();
            expect(new URLSearchParams(window.location.search).has('grade')).toBe(false);
        });
    });
});
