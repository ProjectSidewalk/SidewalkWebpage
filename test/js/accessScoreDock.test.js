/**
 * Tests for AccessScoreDock (public/js/access-score/src/AccessScoreDock.js, #5217): the coordinator's composition
 * rules. The whole city is the population; a brush filters the drivers view and dims the map outside it; a hover in
 * a view outranks the brush on the map and never drops it; a selection fades everything but its neighborhood once
 * no brush is in force; every change lands in one animation frame; and a weight slider mid-drag redraws the views
 * but leaves the map's dim state alone.
 */

const {FIXTURE, stubI18next, stubUtilMisc, loadSources, feature, DOCK_HTML} = require('./support/accessScoreDockHarness');

describe('AccessScoreDock', () => {
    const REGIONS = [
        {region_id: 1, name: 'Fixture', rate: 1, total_distance_m: 6100, completed_distance_m: 6100},
        {region_id: 2, name: 'Other', rate: 1, total_distance_m: 300, completed_distance_m: 300},
    ];
    let model;
    let mapView;
    let map;
    let dock;
    let callbacks;

    /** The ids of the fixture streets whose score falls in [from, to) bins, straight from the model's arrays. */
    function idsInBins(from, to) {
        const out = new Set();
        model.streetIds.forEach((id, i) => {
            if (model.streetBins[i] >= from && model.streetBins[i] < to) out.add(id);
        });
        return out;
    }

    const flush = () => jest.advanceTimersByTime(20);
    const lastBrush = () => mapView.setBrush.mock.calls[mapView.setBrush.mock.calls.length - 1][0];

    beforeAll(() => {
        stubI18next();
        stubUtilMisc();
        loadSources();
    });

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = DOCK_HTML;
        // The last three fixture streets go to a second region, so a region scope is a real subset.
        const features = FIXTURE.streets.map((c, i) =>
            feature(c, i, {region_id: i >= FIXTURE.streets.length - 3 ? 2 : 1}));
        model = new window.AccessScoreModel(FIXTURE.config, {type: 'FeatureCollection', features}, REGIONS);
        mapView = {setBrush: jest.fn()};
        map = {
            on: jest.fn(),
            getPadding: () => ({left: 0, top: 0, right: 0, bottom: 0}),
            setPadding: jest.fn(),
            easeTo: jest.fn(),
            getContainer: () => ({getBoundingClientRect: () => ({height: 800})}),
        };
        callbacks = {onRankSelect: jest.fn(), onToggleType: jest.fn(), onStateChange: jest.fn(), log: jest.fn()};
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {model, mapView, map,
            config: FIXTURE.config, ...callbacks});
        flush();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('draws the three views and the KPIs for the whole city on its first frame', () => {
        expect(document.querySelectorAll('.acs-histogram__bin')).toHaveLength(20);
        expect(document.querySelectorAll('.acs-drivers__row')).toHaveLength(FIXTURE.config.scored_types.length);
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(2);
        expect(document.getElementById('acs-dock-caption').textContent)
            .toBe(`count-streets count=${model.streetCount}`);
        const kpis = document.getElementById('acs-dock-kpis');
        expect(kpis.querySelector('[data-kpi="kpi-streets"] .acs-kpi__value').textContent)
            .toBe(`kpi-of scored=${model.streetCount} total=${model.streetCount}`);
        // Every change lands in one frame: three edits before the frame, one dim write after it.
        mapView.setBrush.mockClear();
        dock.setBrush({from: 10, to: 20});
        dock.setBrush({from: 8, to: 20});
        dock.setBrush({from: 6, to: 20});
        expect(mapView.setBrush).not.toHaveBeenCalled();
        flush();
        expect(mapView.setBrush).toHaveBeenCalledTimes(1);
    });

    test('a brush filters the drivers view and dims the map outside it', () => {
        dock.setBrush({from: 10, to: 20});
        flush();
        expect(lastBrush()).toEqual(idsInBins(10, 20));
        const counted = model.clusterBreakdown({streetIds: idsInBins(10, 20)});
        const {means} = model.contributions({streetIds: idsInBins(10, 20)});
        const row = document.querySelector('.acs-drivers__row[data-type="CurbRamp"]');
        expect(row.querySelector('.acs-drivers__count').textContent)
            .toBe(String(counted.types.find((t) => t.type === 'CurbRamp').total));
        expect(row.querySelector('.acs-drivers__value').textContent).toBe(`+${means.CurbRamp.toFixed(2)}`);
        expect(row.querySelector('.acs-drivers__bar').classList.contains('acs-drivers__bar--help')).toBe(true);
        // Sorted by how much each type moves the score, largest first.
        const shown = Array.from(document.querySelectorAll('.acs-drivers__row')).map((r) => r.dataset.type);
        const expected = [...counted.types].sort((a, b) => Math.abs(means[b.type]) - Math.abs(means[a.type]))
            .map((t) => t.type);
        expect(shown).toEqual(expected);
        expect(document.getElementById('acs-dock-brush').hidden).toBe(false);
        expect(document.getElementById('acs-dock-brush-text').textContent)
            .toContain(`from=50 to=100 count=${idsInBins(10, 20).size}`);
        expect(document.getElementById('acs-dock-status').textContent)
            .toBe(document.getElementById('acs-dock-brush-text').textContent);
        expect(callbacks.log).toHaveBeenCalledWith('Brush', '50-100');

        // Clearing lifts the dim and says so.
        document.getElementById('acs-dock-brush-clear').click();
        flush();
        expect(lastBrush()).toBeNull();
        expect(document.getElementById('acs-dock-status').textContent).toBe('brush-cleared');
        expect(document.getElementById('acs-dock-brush').hidden).toBe(true);
    });

    test('a hover in a view outranks the brush on the map and never drops it', () => {
        dock.setBrush({from: 10, to: 20});
        flush();
        const bins = document.querySelectorAll('.acs-histogram__bin');
        bins[2].dispatchEvent(new MouseEvent('pointermove', {bubbles: true}));
        flush();
        expect(lastBrush()).toEqual(idsInBins(2, 3));
        document.querySelector('.acs-histogram__bars').dispatchEvent(new MouseEvent('pointerleave'));
        flush();
        expect(lastBrush()).toEqual(idsInBins(10, 20));
        expect(dock.state.brush).toEqual({from: 10, to: 20});

        // A rank row's hover dims to its streets and marks the row.
        const rows = document.querySelectorAll('.acs-rank__row');
        const other = Array.from(rows).find((r) => r.dataset.regionId === '2');
        other.dispatchEvent(new MouseEvent('pointerover', {bubbles: true}));
        flush();
        expect(lastBrush()).toEqual(model.regionStreetIds(2));
        expect(document.querySelector('.acs-histogram__caret--hover').hidden).toBe(false);
    });

    test('mid-drag on a weight slider redraws the views but leaves the map dim state alone', () => {
        dock.setBrush({from: 10, to: 20});
        flush();
        mapView.setBrush.mockClear();
        model.setState({weights: {CurbRamp: 0}});
        dock.applyChange({kind: 'Weight', final: false});
        flush();
        expect(mapView.setBrush).not.toHaveBeenCalled();
        // The views did move: the brush readout follows the new membership.
        expect(document.getElementById('acs-dock-brush-text').textContent)
            .toContain(`count=${idsInBins(10, 20).size}`);
        dock.applyChange({kind: 'Weight', final: true});
        flush();
        expect(mapView.setBrush).toHaveBeenCalledTimes(1);
        expect(lastBrush()).toEqual(idsInBins(10, 20));
    });

    test('a selection marks the views and fades the rest of the map, under any brush in force', () => {
        const lastId = model.streetCount; // in region 2
        dock.setSelection({unit: 'streets', id: lastId});
        flush();
        expect(document.querySelector('.acs-rank__row[aria-current="true"]').dataset.regionId).toBe('2');
        expect(document.querySelector('.acs-histogram__caret--selection').hidden).toBe(false);
        expect(document.querySelector('.acs-dock__strip-caret').hidden).toBe(false);
        // The map fades everything outside the selected street's neighborhood.
        expect(lastBrush()).toEqual(model.regionStreetIds(2));
        // The rank list is never reduced to the selection: it is where the neighborhood sits among the others.
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(2);

        // A brush outranks the selection on the map; clearing it hands the map back to the selection.
        dock.setBrush({from: 10, to: 20});
        flush();
        expect(lastBrush()).toEqual(idsInBins(10, 20));
        dock.setBrush(null);
        flush();
        expect(lastBrush()).toEqual(model.regionStreetIds(2));

        dock.setSelection(null);
        flush();
        expect(lastBrush()).toBeNull();
        expect(document.querySelector('.acs-rank__row[aria-current="true"]')).toBeNull();

        // In the neighborhoods unit the selection is the region itself.
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        dock.setSelection({unit: 'regions', id: 1});
        flush();
        expect(lastBrush()).toEqual([1]);
        expect(document.querySelector('[data-kpi="kpi-regions"]')).not.toBeNull();
    });

    test('carries a URL state and reports state changes for the URL', () => {
        dock.applyUrlState({open: false, brush: {from: 2, to: 4}});
        flush();
        expect(dock.state).toEqual({open: false, brush: {from: 2, to: 4}});
        expect(document.getElementById('acs-dock').classList.contains('acs-dock--collapsed')).toBe(true);
        expect(document.getElementById('acs-dock-body').hidden).toBe(true);
        expect(document.getElementById('acs-dock-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(callbacks.onStateChange).toHaveBeenCalled();
        // Restoring a link is not an interaction.
        expect(callbacks.log).not.toHaveBeenCalled();
        document.getElementById('acs-dock-toggle').click();
        expect(dock.state.open).toBe(true);
        expect(callbacks.log).toHaveBeenCalledWith('Dock', 'open');
    });

    test('a type toggle in the drivers view is passed to the map and mutes the row', () => {
        const toggle = document.querySelector('.acs-drivers__row[data-type="Obstacle"] .acs-drivers__type');
        toggle.click();
        flush();
        expect(callbacks.onToggleType).toHaveBeenCalledWith('Obstacle', false);
        expect(callbacks.log).toHaveBeenCalledWith('ClusterType', 'Obstacle_shown=false');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.closest('.acs-drivers__row').classList.contains('acs-drivers__row--hidden')).toBe(true);
        document.querySelector('.acs-rank__row').click();
        expect(callbacks.onRankSelect).toHaveBeenCalledWith(1);
    });
});
