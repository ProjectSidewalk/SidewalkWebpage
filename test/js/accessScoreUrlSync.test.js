/**
 * Tests for AccessScoreUrlSync (public/js/access-score/src/AccessScoreUrlSync.js, #5217): the tool's state as a
 * shareable URL. Reading validates every token against the engine config so a stale or hand-edited link degrades
 * to the defaults; writing omits params at their defaults and preserves params the tool doesn't own.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const FIXTURE = JSON.parse(read('test/fixtures/accessScoreParity.json'));

describe('AccessScoreUrlSync', () => {
    let AccessScoreUrlSync;
    let AccessScoreModel;
    const config = FIXTURE.config;

    beforeAll(() => {
        window.eval(read('public/js/common/urlQuery.js'));
        window.eval(`${read('public/js/access-score/src/AccessScoreModel.js')}\nwindow.AccessScoreModel = AccessScoreModel;`);
        window.eval(`${read('public/js/access-score/src/AccessScoreUrlSync.js')}\nwindow.AccessScoreUrlSync = AccessScoreUrlSync;`);
        AccessScoreUrlSync = window.AccessScoreUrlSync;
        AccessScoreModel = window.AccessScoreModel;
    });

    test('reads a full state, filling unnamed weights from the engine defaults', () => {
        const { state, selection } = AccessScoreUrlSync.read(config,
            '?unit=regions&w=CurbRamp:1.5,Obstacle:0&unaudited=0&clusters=0&sel=42');
        expect(state.unit).toBe('regions');
        expect(state.weights.CurbRamp).toBe(1.5);
        expect(state.weights.Obstacle).toBe(0);
        expect(state.weights.Signal).toBe(config.presets.default.Signal);
        expect(state.showUnaudited).toBe(false);
        expect(state.showClusters).toBe(false);
        expect(selection).toBe(42);
    });

    test('drops tokens the config does not know, and params from older builds, keeping the rest', () => {
        const { state, selection } = AccessScoreUrlSync.read(config,
            '?unit=blocks&preset=barriers&w=Dragons:2,CurbRamp:-1,Obstacle:abc&sev=0.2&minc=80&sel=-3');
        expect(state).toEqual({});
        expect(selection).toBeNull();
    });

    test('reads the dark basemap flag', () => {
        expect(AccessScoreUrlSync.read(config, '?dark=1').dark).toBe(true);
        expect(AccessScoreUrlSync.read(config, '?dark=0').dark).toBe(false);
        expect(AccessScoreUrlSync.read(config, '').dark).toBe(false);
    });

    test('reads the dock params and drops a brush that is off the bin edges', () => {
        const { dock } = AccessScoreUrlSync.read(config, '?dock=0&b=40-60');
        expect(dock).toEqual({ open: false, brush: { from: 4, to: 6 } });
        expect(AccessScoreUrlSync.read(config, '').dock).toEqual({ open: true, brush: null });
        for (const b of ['41-60', '80-85', '60-40', '0-105', '40', '40-40', 'abc']) {
            expect(AccessScoreUrlSync.read(config, `?b=${b}`).dock.brush).toBeNull();
        }
    });

    test('writes only what differs from the defaults, keeps foreign params, and stamps the viewport', () => {
        window.history.replaceState(null, '', '/accessScore?regions=5&lat=1&lng=2');
        const model = new AccessScoreModel(config, { type: 'FeatureCollection', features: [] },
            { type: 'FeatureCollection', features: [] }, []);
        const map = {
            on: () => {},
            getCenter: () => ({ lat: 40.88, lng: -74.01 }),
            getZoom: () => 13.5,
        };
        const sync = new AccessScoreUrlSync(model, map);
        sync.writeNow();
        let params = new URLSearchParams(window.location.search);
        expect(params.get('regions')).toBe('5');
        expect(params.get('lat')).toBe('40.88000');
        expect(params.get('zoom')).toBe('13.50');
        for (const name of ['unit', 'w', 'unaudited', 'clusters', 'sel', 'dock', 'b', 'dark']) {
            expect(params.has(name)).toBe(false);
        }

        model.setState({ unit: 'regions', weights: { Obstacle: 1.75 }, showClusters: false });
        sync.setSelection(7);
        sync.setDock({ open: false, brush: { from: 4, to: 6 } });
        sync.setDark(true);
        sync.writeNow();
        params = new URLSearchParams(window.location.search);
        expect(params.get('dark')).toBe('1');
        expect(params.get('dock')).toBe('0');
        expect(params.get('b')).toBe('40-60');
        expect(params.get('unit')).toBe('regions');
        expect(params.get('w')).toContain('Obstacle:1.75');
        expect(params.get('clusters')).toBe('0');
        expect(params.get('sel')).toBe('7');

        // Round trip: what was written reads back as the same state.
        const back = AccessScoreUrlSync.read(config, window.location.search);
        expect(back.state.weights.Obstacle).toBe(1.75);
        expect(back.state.unit).toBe('regions');
        expect(back.state.showClusters).toBe(false);
        expect(back.selection).toBe(7);
        expect(back.dark).toBe(true);
        expect(back.dock).toEqual({ open: false, brush: { from: 4, to: 6 } });
    });
});
