/**
 * Tests for AccessScoreDock (public/js/access-score/src/AccessScoreDock.js, #5217): the coordinator's composition
 * rules. The whole city is the population; a brush narrows what's here and dims the map outside it; a hover in a
 * view outranks the brush on the map and never drops it; a selection scopes what's here and the photo strip and
 * fades everything but its neighborhood once no brush is in force; every change lands in one animation frame; and
 * a weight slider mid-drag redraws the views but leaves the map's dim state alone.
 */

const {FIXTURE, stubI18next, stubUtilMisc, stubFetch, loadSources, feature, DOCK_HTML} =
    require('./support/accessScoreDockHarness');

/** A flushed microtask queue, for the strip's fetch chain under fake timers. */
const settle = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
};

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
    let fetchMock;

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
        model = new window.AccessScoreModel(FIXTURE.config, {type: 'FeatureCollection', features},
            {type: 'FeatureCollection', features: []}, REGIONS);
        // The map starts zoomed out over nothing, so the strip's city rule applies until a test moves it.
        mapView = {
            setBrush: jest.fn(),
            visibleRegionIds: jest.fn(() => new Set()),
            regionBoundsOf: (id) => ({getCenter: () => ({lng: id, lat: 0})}),
        };
        map = {
            on: jest.fn(),
            getPadding: () => ({left: 0, top: 0, right: 0, bottom: 0}),
            setPadding: jest.fn(),
            easeTo: jest.fn(),
            getContainer: () => ({getBoundingClientRect: () => ({height: 800})}),
            getZoom: () => 12,
            getCenter: () => ({lng: 0, lat: 0}),
            getBounds: () => ({getWest: () => -1, getSouth: () => -1, getEast: () => 1, getNorth: () => 1}),
        };
        callbacks = {onRankSelect: jest.fn(), onToggleType: jest.fn(), onOpenLabel: jest.fn(), onStateChange: jest.fn(),
            log: jest.fn()};
        fetchMock = stubFetch({
            clustersByRegion: {
                1: [
                    {label_cluster_id: 1, label_type: 'Obstacle', street_edge_id: 1, intersection_id: null, region_id: 1,
                        region_name: 'Fixture', median_severity: 3, cluster_size: 2, label_ids: [101, 102],
                        coordinates: [0.5, 0.5]},
                    {label_cluster_id: 2, label_type: 'CurbRamp', street_edge_id: 2, intersection_id: null, region_id: 1,
                        region_name: 'Fixture', median_severity: 1, cluster_size: 1, label_ids: [103],
                        coordinates: [5, 5]},
                ],
                2: [
                    {label_cluster_id: 3, label_type: 'SurfaceProblem', street_edge_id: model.streetCount,
                        intersection_id: null, region_id: 2, region_name: 'Other', median_severity: 2, cluster_size: 1,
                        label_ids: [201], coordinates: [0.2, 0.2]},
                ],
            },
            labels: {
                101: {label_id: 101, label_type: 'Obstacle', severity: 3, crop_url: 'https://example.test/101.jpg',
                    backup_image_url: null},
                103: {label_id: 103, label_type: 'CurbRamp', severity: 1, crop_url: null, backup_image_url: null},
                201: {label_id: 201, label_type: 'SurfaceProblem', severity: 2, crop_url: null, backup_image_url: null},
            },
        });
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {model, mapView, map,
            config: FIXTURE.config, ...callbacks});
        flush();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('draws the four views and the KPIs for the whole city on its first frame', async () => {
        expect(document.querySelectorAll('.acs-histogram__bin')).toHaveLength(10);
        expect(document.querySelectorAll('.acs-whats-here__row')).toHaveLength(FIXTURE.config.scored_types.length);
        expect(document.querySelector('.acs-whats-here__caption').textContent).toBe('scope-city');
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(2);
        // With nothing selected the strip reads the lowest-ranked neighborhood and says so.
        const ranked = model.rankedRegions();
        const lowest = ranked[ranked.length - 1];
        await settle();
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`regionId=${lowest.regionId}`))).toBe(true);
        expect(document.querySelector('.acs-photos__caption').textContent)
            .toBe(`photos-from scope=photos-lowest name=${lowest.name}`);
        expect(document.getElementById('acs-dock-caption').textContent)
            .toBe(`count-streets count=${model.streetCount}`);
        const kpis = document.getElementById('acs-dock-kpis');
        expect(kpis.querySelector('[data-kpi="kpi-streets"] .acs-kpi__value').textContent)
            .toBe(`kpi-of scored=${model.streetCount} total=${model.streetCount}`);
        // Every change lands in one frame: three edits before the frame, one dim write after it.
        mapView.setBrush.mockClear();
        dock.setBrush({from: 5, to: 10});
        dock.setBrush({from: 4, to: 10});
        dock.setBrush({from: 3, to: 10});
        expect(mapView.setBrush).not.toHaveBeenCalled();
        flush();
        expect(mapView.setBrush).toHaveBeenCalledTimes(1);
    });

    test('a brush narrows what\'s here and dims the map outside it', () => {
        dock.setBrush({from: 5, to: 10});
        flush();
        expect(lastBrush()).toEqual(idsInBins(5, 10));
        const counted = model.clusterBreakdown({streetIds: idsInBins(5, 10)});
        const row = document.querySelector('.acs-whats-here__row[data-type="CurbRamp"]');
        const ramps = counted.types.find((t) => t.type === 'CurbRamp');
        expect(row.querySelector('.acs-whats-here__count').textContent).toBe(String(ramps.total));
        // A rated type's bar is one segment per non-empty bucket, in the label card's colors; the widest row fills.
        const shownSegments = Array.from(row.querySelectorAll('.acs-whats-here__segment')).filter((el) => !el.hidden);
        expect(shownSegments.map((el) => el.dataset.bucket))
            .toEqual(Object.entries(ramps.buckets).filter(([, n]) => n > 0).map(([b]) => b));
        expect(row.querySelector('.acs-whats-here__segment[data-bucket="1"]').style.getPropertyValue('--acs-segment'))
            .toBe('var(--color-positive-1)');
        const max = Math.max(...counted.types.map((t) => t.total));
        const widest = counted.types.find((t) => t.total === max);
        expect(document.querySelector(`.acs-whats-here__row[data-type="${widest.type}"] .acs-whats-here__bar`)
            .style.width).toBe('100%');
        // An unrated type is one segment; a type with nothing in scope says so and has no bar.
        expect(document.querySelectorAll('.acs-whats-here__row[data-type="NoSidewalk"] .acs-whats-here__segment'))
            .toHaveLength(1);
        expect(document.querySelector('.acs-whats-here__caption').textContent).toBe('scope-city · scope-brush from=50 to=100');
        expect(row.querySelector('.acs-whats-here__track').getAttribute('aria-label')).toContain(`count=${ramps.total}`);
        expect(document.getElementById('acs-dock-brush').hidden).toBe(false);
        expect(document.getElementById('acs-dock-brush-text').textContent)
            .toContain(`from=50 to=100 count=${idsInBins(5, 10).size}`);
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
        dock.setBrush({from: 5, to: 10});
        flush();
        const bins = document.querySelectorAll('.acs-histogram__bin');
        bins[2].dispatchEvent(new MouseEvent('pointermove', {bubbles: true}));
        flush();
        expect(lastBrush()).toEqual(idsInBins(2, 3));
        document.querySelector('.acs-histogram__bars').dispatchEvent(new MouseEvent('pointerleave'));
        flush();
        expect(lastBrush()).toEqual(idsInBins(5, 10));
        expect(dock.state.brush).toEqual({from: 5, to: 10});

        // A rank row's hover dims to its streets and marks the row.
        const rows = document.querySelectorAll('.acs-rank__row');
        const other = Array.from(rows).find((r) => r.dataset.regionId === '2');
        other.dispatchEvent(new MouseEvent('pointerover', {bubbles: true}));
        flush();
        expect(lastBrush()).toEqual(model.regionStreetIds(2));
        expect(document.querySelector('.acs-histogram__caret--hover').hidden).toBe(false);
    });

    test('mid-drag on a weight slider redraws the views but leaves the map dim state alone', () => {
        dock.setBrush({from: 5, to: 10});
        flush();
        mapView.setBrush.mockClear();
        model.setState({weights: {CurbRamp: 0}});
        dock.applyChange({kind: 'Weight', final: false});
        flush();
        expect(mapView.setBrush).not.toHaveBeenCalled();
        // The views did move: the brush readout follows the new membership.
        expect(document.getElementById('acs-dock-brush-text').textContent)
            .toContain(`count=${idsInBins(5, 10).size}`);
        dock.applyChange({kind: 'Weight', final: true});
        flush();
        expect(mapView.setBrush).toHaveBeenCalledTimes(1);
        expect(lastBrush()).toEqual(idsInBins(5, 10));
    });

    test('a selection marks the views and fades the rest of the map, under any brush in force', async () => {
        const lastId = model.streetCount; // in region 2
        fetchMock.mockClear();
        dock.setSelection({unit: 'streets', id: lastId});
        flush();
        expect(document.querySelector('.acs-rank__row[aria-current="true"]').dataset.regionId).toBe('2');
        // What's here narrows to the street; the strip reads its neighborhood's feed, filtered to the street.
        expect(document.querySelector('.acs-whats-here__caption').textContent).toBe(`scope-street id=${lastId}`);
        const counted = model.clusterBreakdown({streetIds: new Set([lastId])});
        expect(document.querySelector('.acs-whats-here__row[data-type="CurbRamp"] .acs-whats-here__count').textContent)
            .toBe(String(counted.types.find((t) => t.type === 'CurbRamp').total));
        await settle();
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes('regionId=2'))).toBe(true);
        expect(document.querySelector('.acs-photos__caption').textContent)
            .toBe(`photos-from scope=popup-street id=${lastId}`);
        expect(document.querySelectorAll('.acs-photos__item')).toHaveLength(1);
        expect(document.querySelector('.acs-photos__item').dataset.labelId).toBe('201');
        // A slider tick redraws what's here but never refetches the strip.
        const fetches = fetchMock.mock.calls.length;
        model.setState({weights: {CurbRamp: 0}});
        dock.applyChange({kind: 'Weight', final: false});
        flush();
        await settle();
        expect(fetchMock.mock.calls.length).toBe(fetches);
        expect(document.querySelector('.acs-histogram__caret--selection').hidden).toBe(false);
        expect(document.querySelector('.acs-dock__strip-caret').hidden).toBe(false);
        // The map fades everything outside the selected street's neighborhood.
        expect(lastBrush()).toEqual(model.regionStreetIds(2));
        // The rank list is never reduced to the selection: it is where the neighborhood sits among the others.
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(2);

        // A brush outranks the selection on the map; clearing it hands the map back to the selection.
        dock.setBrush({from: 5, to: 10});
        flush();
        expect(lastBrush()).toEqual(idsInBins(5, 10));
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

    test('a type toggle in what\'s here is passed to the map and mutes the row', () => {
        const toggle = document.querySelector('.acs-whats-here__row[data-type="Obstacle"] .acs-whats-here__type');
        toggle.click();
        flush();
        expect(callbacks.onToggleType).toHaveBeenCalledWith('Obstacle', false);
        expect(callbacks.log).toHaveBeenCalledWith('ClusterType', 'Obstacle_shown=false');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.closest('.acs-whats-here__row').classList.contains('acs-whats-here__row--hidden')).toBe(true);
        // Whichever region ranks first (the fixture's cases decide), clicking its row selects that region.
        const first = document.querySelector('.acs-rank__row');
        first.click();
        expect(callbacks.onRankSelect).toHaveBeenCalledWith(Number(first.dataset.regionId));
    });

    test('the photo strip shows the region\'s worst clusters first, opens the label card, and ignores a late feed', async () => {
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        dock.setSelection({unit: 'regions', id: 1});
        flush();
        await settle();
        expect(document.querySelector('.acs-photos__caption').textContent).toBe('photos-from scope=Fixture');
        const items = document.querySelectorAll('.acs-photos__item');
        // Severity 3 ahead of 1; a label with a crop shows it, one without shows the type placeholder.
        expect(Array.from(items).map((el) => el.dataset.labelId)).toEqual(['101', '103']);
        expect(items[0].querySelector('.acs-photos__image').getAttribute('src')).toBe('https://example.test/101.jpg');
        expect(items[1].querySelector('.acs-sheet__placeholder')).not.toBeNull();
        expect(items[0].getAttribute('data-ps-tooltip')).toBe('obstacle · high · Fixture');
        items[1].click();
        expect(callbacks.log).toHaveBeenCalledWith('PhotoStrip_labelId', 103);
        expect(callbacks.onOpenLabel).toHaveBeenCalledWith(103, [101, 103]);

        // A feed that answers after the scope moved on never overwrites the newer strip. The region the city scope
        // already fetched answers from cache; the other one is held back until after the scope has moved on.
        const ranked = model.rankedRegions();
        const cached = ranked[ranked.length - 1].regionId;
        const held = cached === 1 ? 2 : 1;
        const expectedIds = cached === 1 ? ['101', '103'] : ['201'];
        let release;
        const previous = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((input) => {
            const url = new URL(String(input), 'http://localhost');
            if (url.searchParams.get('regionId') === String(held)) {
                return new Promise((resolve) => {
                    release = () => resolve({ok: true, status: 200, json: () => Promise.resolve({
                        type: 'FeatureCollection',
                        features: [{type: 'Feature', properties: {label_type: 'Obstacle', street_edge_id: 9,
                            intersection_id: null, region_id: held, median_severity: 3, cluster_size: 1,
                            label_ids: [103]}}],
                    })});
                });
            }
            return previous(input);
        });
        dock.setSelection({unit: 'regions', id: held});
        flush();
        await settle();
        expect(document.querySelectorAll('.acs-photos__item')).toHaveLength(0); // still loading
        dock.setSelection({unit: 'regions', id: cached});
        flush();
        await settle();
        release();
        await settle();
        expect(document.querySelector('.acs-photos__caption').textContent)
            .toBe(`photos-from scope=${model.explainRegion(cached).name}`);
        expect(Array.from(document.querySelectorAll('.acs-photos__item')).map((el) => el.dataset.labelId))
            .toEqual(expectedIds);
    });
    test('zoomed in with nothing selected, the strip follows the area in view and a settled pan refreshes it', async () => {
        const moveend = map.on.mock.calls.find(([name]) => name === 'moveend')[1];
        const captionEl = () => document.querySelector('.acs-photos__caption').textContent;
        const shownIds = () => Array.from(document.querySelectorAll('.acs-photos__item')).map((el) => el.dataset.labelId);
        await settle();
        const ranked = model.rankedRegions();
        expect(captionEl()).toBe(`photos-from scope=photos-lowest name=${ranked[ranked.length - 1].name}`);

        // Zoom in over both neighborhoods: the strip pools their feeds and keeps only the clusters inside the bounds
        // (cluster 2 sits at [5, 5], outside the ±1 view), worst first.
        map.getZoom = () => 14;
        mapView.visibleRegionIds.mockImplementation(() => new Set([1, 2]));
        moveend({originalEvent: {}});
        jest.advanceTimersByTime(window.AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
        await settle();
        expect(captionEl()).toBe('photos-from scope=photos-scope-viewport');
        expect(shownIds()).toEqual(['101', '201']);
        // What's here never follows the map: its counts are the histogram's population.
        expect(document.querySelector('.acs-whats-here__caption').textContent).toBe('scope-city');
        expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/v3/api/labelClusters'))).toHaveLength(2);

        // A programmatic move (no originalEvent) is not a pan; a pan that keeps the same clusters redraws nothing.
        const ribbonBefore = document.querySelector('.acs-photos__ribbon').innerHTML;
        moveend({});
        jest.advanceTimersByTime(window.AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
        await settle();
        map.getBounds = () => ({getWest: () => -1.0004, getSouth: () => -1, getEast: () => 1, getNorth: () => 1});
        moveend({originalEvent: {}});
        jest.advanceTimersByTime(window.AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
        await settle();
        expect(document.querySelector('.acs-photos__ribbon').innerHTML).toBe(ribbonBefore);
        expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/v3/api/labelClusters'))).toHaveLength(2);

        // A pan that leaves only one cluster in view narrows the strip without a new fetch (feeds are cached).
        map.getBounds = () => ({getWest: () => 0.4, getSouth: () => 0.4, getEast: () => 1, getNorth: () => 1});
        moveend({originalEvent: {}});
        jest.advanceTimersByTime(window.AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
        await settle();
        expect(shownIds()).toEqual(['101']);
        expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/v3/api/labelClusters'))).toHaveLength(2);

        // A selection outranks the viewport.
        dock.setSelection({unit: 'streets', id: 2});
        flush();
        await settle();
        expect(captionEl()).toBe('photos-from scope=popup-street id=2');
        // Zoomed back out with the selection gone, the city rule returns.
        dock.setSelection(null);
        map.getZoom = () => 12;
        flush();
        await settle();
        expect(captionEl()).toBe(`photos-from scope=photos-lowest name=${ranked[ranked.length - 1].name}`);
    });

    test('a named street is captioned by its name in what\'s here and the strip', async () => {
        const named = FIXTURE.streets.map((c, i) => feature(c, i, i === 0 ? {street_name: 'Cedar Lane'} : {}));
        model = new window.AccessScoreModel(FIXTURE.config, {type: 'FeatureCollection', features: named},
            {type: 'FeatureCollection', features: []}, REGIONS);
        document.body.innerHTML = DOCK_HTML;
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {model, mapView, map,
            config: FIXTURE.config, ...callbacks});
        dock.setSelection({unit: 'streets', id: 1});
        flush();
        await settle();
        expect(model.explainStreet(1).name).toBe('Cedar Lane');
        expect(model.explainStreet(2).name).toBeNull();
        expect(document.querySelector('.acs-whats-here__caption').textContent).toBe('scope-street-named name=Cedar Lane');
        expect(document.querySelector('.acs-photos__caption').textContent)
            .toBe('photos-from scope=popup-street-named name=Cedar Lane id=1');
    });
});
