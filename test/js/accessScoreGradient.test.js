/**
 * Tests for the street-slope side of the AccessScore tool (#5223): the slope fields the model carries per street,
 * the classed grade ramp the map and legend share, the elevation profile's SVG, and the `grade` URL param.
 *
 * Slope is not part of the score here, so none of this touches the parity fixture's numbers; the fixture supplies
 * only a real engine config to build a model around.
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
        window.i18next = { language: 'en' };
        for (const name of ['Model', 'GradeRamp', 'ElevationProfile', 'UrlSync']) {
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

        test('draws a street by its mean grade, by the size of its net grade where that is all there is', () => {
            expect(model.displayGrade(1)).toBe(0.062);
            expect(model.displayGrade(3)).toBe(0.03);
            // A bridge has a row and no grade: known to the model, blank on the map.
            expect(model.explainStreet(2).gradient.quality).toBe('structure');
            expect(model.displayGrade(2)).toBeNull();
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

        test('puts a grade exactly at a limit inside it, and anything over in the next class', () => {
            expect(AccessScoreGradeRamp.classOf(0, breaks)).toBe(0);
            expect(AccessScoreGradeRamp.classOf(0.05, breaks)).toBe(1);
            expect(AccessScoreGradeRamp.classOf(0.0501, breaks)).toBe(2);
            expect(AccessScoreGradeRamp.classOf(1 / 12, breaks)).toBe(2);
            expect(AccessScoreGradeRamp.classOf(0.5, breaks)).toBe(4);
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
    });

    describe('AccessScoreElevationProfile', () => {
        const text = { label: 'Profile label', low: '100 m', high: '104 m', start: 'Start', end: 'End' };

        test('draws a line and a filled area with the accessible name and both scales', () => {
            const profile = { spacing_meters: 50, elevations_meters: [104, 101.5, 100] };
            document.body.innerHTML = AccessScoreElevationProfile.html(profile, text);
            const svg = document.querySelector('svg.acs-profile__chart');
            expect(svg.getAttribute('role')).toBe('img');
            expect(svg.getAttribute('aria-label')).toBe('Profile label');
            const line = document.querySelector('.acs-profile__line').getAttribute('d');
            expect(line.match(/[ML]/g)).toEqual(['M', 'L', 'L']);
            expect(document.querySelector('.acs-profile__area').getAttribute('d').endsWith('Z')).toBe(true);
            expect(document.querySelector('.acs-profile__scale').textContent).toContain('104 m');
            expect(document.querySelector('.acs-profile__ends').textContent).toContain('Start');
            // Downhill in the digitized direction: the first sample is drawn above the last (smaller y).
            const ys = line.split(' ').map((p) => Number(p.split(',')[1]));
            expect(ys[0]).toBeLessThan(ys[2]);
        });

        test('keeps a near-level street a flat line through the middle instead of magnifying its noise', () => {
            const html = AccessScoreElevationProfile.html({ spacing_meters: 10, elevations_meters: [50, 50.02, 50] }, text);
            document.body.innerHTML = html;
            const ys = document.querySelector('.acs-profile__line').getAttribute('d').split(' ')
                .map((p) => Number(p.split(',')[1]));
            expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
            expect(ys[0]).toBeGreaterThan(30);
            expect(ys[0]).toBeLessThan(66);
        });

        test('draws nothing for a profile too short to have a shape', () => {
            expect(AccessScoreElevationProfile.html({ spacing_meters: 0, elevations_meters: [12] }, text)).toBe('');
            expect(AccessScoreElevationProfile.html(null, text)).toBe('');
        });

        test('reports the range the scale is labeled with', () => {
            expect(AccessScoreElevationProfile.range({ spacing_meters: 5, elevations_meters: [3, 9, 1] }))
                .toEqual({ low: 1, high: 9 });
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
