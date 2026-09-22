/**
 * Tests for AccessScoreDock (public/js/access-score/src/AccessScoreDock.js, #5217): the coordinator's composition
 * rules. The whole city is the population; a brush narrows what's here and dims the map outside it; a hover in a
 * view outranks the brush on the map and never drops it; a selection scopes what's here and the photo strip and
 * fades everything but its region once no brush is in force; every change lands in one animation frame; and
 * a weight slider mid-drag redraws the views but leaves the map's dim state alone.
 */

const {FIXTURE, stubI18next, installUtil, stubFetch, loadSources, feature, DOCK_HTML} =
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
        installUtil();
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
            setGradeSelection: jest.fn(),
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
        callbacks = {onRankSelect: jest.fn(), onOpenLabel: jest.fn(), onStateChange: jest.fn(),
            log: jest.fn()};
        fetchMock = stubFetch({
            clustersByRegion: {
                1: [
                    {label_cluster_id: 1, label_type: 'Obstacle', street_edge_id: 1, intersection_id: null, region_id: 1,
                        region_name: 'Fixture', median_severity: 3, cluster_size: 2, label_ids: [100, 101],
                        coordinates: [0.5, 0.5]},
                    {label_cluster_id: 2, label_type: 'CurbRamp', street_edge_id: 2, intersection_id: null, region_id: 1,
                        region_name: 'Fixture', median_severity: 1, cluster_size: 1, label_ids: [103],
                        coordinates: [5, 5]},
                ],
                2: [
                    {label_cluster_id: 3, label_type: 'SurfaceProblem', street_edge_id: model.streetCount,
                        intersection_id: null, region_id: 2, region_name: 'Other', median_severity: 2, cluster_size: 1,
                        label_ids: [201], coordinates: [0.2, 0.2]},
                    // A cluster whose label the stub does not serve: it never gets a picture.
                    {label_cluster_id: 4, label_type: 'CurbRamp', street_edge_id: model.streetCount,
                        intersection_id: null, region_id: 2, region_name: 'Other', median_severity: 1, cluster_size: 1,
                        label_ids: [301], coordinates: [0.1, 0.1]},
                ],
            },
            labels: {
                101: {label_id: 101, label_type: 'Obstacle', severity: 3, crop_url: 'https://example.test/101.jpg',
                    backup_image_url: null},
                103: {label_id: 103, label_type: 'CurbRamp', severity: 1, crop_url: null, backup_image_url: null},
                201: {label_id: 201, label_type: 'SurfaceProblem', severity: 2, crop_url: null, backup_image_url: null},
            },
        });
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {
            cityName: 'Fixture City', model, mapView, map,
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
        // The streets unit ranks streets, and 66 fixture streets is more than the leaderboard holds.
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(window.AccessScoreModel.RANK_LIMIT);
        expect(document.getElementById('acs-dock-body').classList).not.toContain('acs-dock__body--no-rank');
        // With nothing selected the strip reads the lowest-ranked region and says so.
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
            .toBe('var(--color-jade-400)');
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

    test('the map legend\'s slope classes are the same brush, and the two kinds displace each other', () => {
        // One street over the ramp limit and one under the walking-surface limit, so the legend's classes really
        // do split the city.
        const gradient = (max) => ({
            mean_grade: 0.02, max_grade: max, net_grade: 0.02, meters_over_5pct: 0, meters_over_8pct: 0,
            grade_confidence: 'high', grade_quality: 'measured', dem_source: 'fixture',
        });
        const features = FIXTURE.streets.map((c, i) => feature(c, i, {
            region_id: i >= FIXTURE.streets.length - 3 ? 2 : 1, ...(i < 2 ? gradient([0.3, 0.01][i]) : {}),
        }));
        model = new window.AccessScoreModel(FIXTURE.config, {type: 'FeatureCollection', features},
            {type: 'FeatureCollection', features: []}, REGIONS);
        const breaks = [1 / 48, 0.05, 1 / 12, 0.125];
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {
            cityName: 'Fixture City', model, mapView, map, gradeBreaks: breaks, ...callbacks});
        flush();

        dock.setBrush({kind: 'grade', classes: [4]});
        flush();
        // Only the street whose steepest stretch is over 12.5%; the legend is told so its rows stay in step.
        expect(lastBrush()).toEqual(new Set([1]));
        expect(mapView.setGradeSelection).toHaveBeenLastCalledWith([4]);
        expect(dock.state.brush).toEqual({kind: 'grade', classes: [4]});
        expect(callbacks.log).toHaveBeenCalledWith('Brush', 'grade=4');
        expect(document.getElementById('acs-dock-brush').hidden).toBe(false);
        expect(document.getElementById('acs-dock-brush-text').textContent).toContain('count=1');
        // The histogram marks no bins under a slope brush: it is not a range over that axis.
        expect(document.querySelectorAll('.acs-histogram__bin--out')).toHaveLength(0);
        // The rank list still mutes: every ranked street but the brushed one is outside the brush.
        const rankRows = [...document.querySelectorAll('.acs-rank__row')];
        const brushedRows = rankRows.filter((r) => r.dataset.rowId === '1');
        expect(rankRows.filter((r) => r.classList.contains('acs-rank__row--out')))
            .toHaveLength(rankRows.length - brushedRows.length);

        // Duplicate classes collapse, and a selection of nothing is no brush at all.
        dock.setBrush({kind: 'grade', classes: [0, 4, 4]});
        flush();
        expect(dock.state.brush).toEqual({kind: 'grade', classes: [0, 4]});
        dock.setBrush({kind: 'grade', classes: []});
        flush();
        expect(dock.state.brush).toBeNull();
        expect(lastBrush()).toBeNull();

        // A score range takes over, and the legend's rows are released with it.
        dock.setBrush({kind: 'grade', classes: [4]});
        dock.setBrush({from: 5, to: 10});
        flush();
        expect(dock.state.brush).toEqual({kind: 'score', from: 5, to: 10});
        expect(mapView.setGradeSelection).toHaveBeenLastCalledWith([]);
    });

    test('a slope brush is dropped where its classes stop describing the map', () => {
        const breaks = [1 / 48, 0.05, 1 / 12, 0.125];
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {
            cityName: 'Fixture City', model, mapView, map, gradeBreaks: breaks, ...callbacks});
        flush();
        for (const kind of ['Unit', 'GradeStat', 'ResetAll']) {
            dock.setBrush({kind: 'grade', classes: [4]}, {log: false});
            dock.applyChange({kind, final: true});
            flush();
            expect(dock.state.brush).toBeNull();
        }
        // A score brush is the histogram's and survives a statistic change, which says nothing about score bins.
        dock.setBrush({from: 5, to: 10}, {log: false});
        dock.applyChange({kind: 'GradeStat', final: true});
        flush();
        expect(dock.state.brush).toEqual({kind: 'score', from: 5, to: 10});
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
        expect(dock.state.brush).toEqual({kind: 'score', from: 5, to: 10});

        // A rank row's hover dims to what the row is — here a street — and marks the row.
        const row = document.querySelectorAll('.acs-rank__row')[1];
        row.dispatchEvent(new MouseEvent('pointerover', {bubbles: true}));
        flush();
        expect(lastBrush()).toEqual([Number(row.dataset.rowId)]);
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
        // What's here narrows to the street; the strip reads its region's feed, filtered to the street.
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
        // The map fades everything outside the selected street's region.
        expect(lastBrush()).toEqual(model.regionStreetIds(2));
        // The rank list is never reduced to the selection: it is where a street sits among the others.
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(window.AccessScoreModel.RANK_LIMIT);

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

        // In the regions unit the selection is the region itself.
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        dock.setSelection({unit: 'regions', id: 1});
        flush();
        expect(lastBrush()).toEqual([1]);
        expect(document.querySelector('[data-kpi="kpi-regions"]')).not.toBeNull();
    });

    test('the histogram needle names the city, as the backend states it, over the city average', () => {
        expect(document.querySelector('.acs-histogram__needle-label').textContent)
            .toMatch(/^histogram-city city=Fixture City score=\d+/);
    });

    test('carries a URL state and reports state changes for the URL', () => {
        dock.applyUrlState({open: false, brush: {from: 2, to: 4}});
        flush();
        expect(dock.state).toEqual({open: false, brush: {kind: 'score', from: 2, to: 4}, focus: null});
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

    test('a rank row focuses its region as the band\'s scope, until the map or a reset says otherwise', async () => {
        // The rows only read: no type is a switch for the map's dots.
        expect(document.querySelector('.acs-whats-here__row button')).toBeNull();
        // The neighborhoods unit is where a rank row is a region; the streets unit ranks streets (#5223).
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        flush();
        const second = document.querySelectorAll('.acs-rank__row')[1];
        const regionId = Number(second.dataset.rowId);
        const name = REGIONS.find((r) => r.region_id === regionId).name;
        second.click();
        flush();
        await settle();
        expect(callbacks.log).toHaveBeenCalledWith('RankSelect_regionId', regionId);
        expect(callbacks.onRankSelect).toHaveBeenCalledWith({unit: 'regions', id: regionId});
        expect(dock.state.focus).toBe(regionId);
        expect(callbacks.onStateChange).toHaveBeenCalled();
        expect(document.querySelector('.acs-rank__row[aria-current="true"]').dataset.rowId).toBe(String(regionId));
        expect(document.querySelector('.acs-whats-here__caption').textContent).toBe(`scope-region name=${name}`);
        expect(document.querySelector('.acs-photos__caption').textContent).toBe(`photos-from scope=${name}`);
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`regionId=${regionId}`))).toBe(true);
        // A map selection is the newer choice and clears the focus; a street's own scope wins.
        dock.setSelection({unit: 'streets', id: model.streetIds[0]});
        flush();
        expect(dock.state.focus).toBeNull();
        dock.setSelection(null);
        dock.setFocusRegion(regionId);
        flush();
        expect(dock.state.focus).toBe(regionId);
        // A unit switch drops it, as does the page-wide reset; a shared link brings it back.
        dock.applyChange({kind: 'Unit', final: true});
        flush();
        expect(dock.state.focus).toBeNull();
        dock.applyUrlState({focus: regionId});
        flush();
        expect(dock.state.focus).toBe(regionId);
        dock.applyChange({kind: 'ResetAll', final: true});
        flush();
        expect(dock.state.focus).toBeNull();
    });

    test('the streets unit ranks one end of the street leaderboard, with a toggle to the other (#5223)', () => {
        const limit = window.AccessScoreModel.RANK_LIMIT;
        const order = document.getElementById('acs-rank-order');
        const scores = () => [...document.querySelectorAll('.acs-rank__row')]
            .map((r) => model.explainStreet(Number(r.dataset.rowId)).score);

        expect(document.getElementById('acs-dock-rank-title').textContent).toBe('chart-rank-streets');
        expect(order.hidden).toBe(false);
        expect(order.textContent).toBe(`rank-show-worst n=${limit}`);
        // Best first, and the whole list is the best of the city: no street outside it outscores one inside it.
        const best = scores();
        expect(best).toEqual([...best].sort((a, b) => b - a));
        const ranked = new Set([...document.querySelectorAll('.acs-rank__row')].map((r) => Number(r.dataset.rowId)));
        const outside = model.streetIds.filter((id) => !ranked.has(id)).map((id) => model.explainStreet(id).score);
        expect(Math.max(...outside)).toBeLessThanOrEqual(Math.min(...best));
        expect(document.querySelector('.acs-rank__note').textContent)
            .toBe(`rank-streets-best shown=${limit} total=${model.streetCount}`);

        // The toggle turns the list around: the worst streets, worst first, and the wording swaps with it.
        order.click();
        flush();
        expect(callbacks.log).toHaveBeenCalledWith('RankOrder', 'worst');
        expect(order.textContent).toBe(`rank-show-best n=${limit}`);
        const worst = scores();
        expect(worst).toEqual([...worst].sort((a, b) => a - b));
        expect(worst[0]).toBeLessThan(best[0]);
        expect(document.querySelector('.acs-rank__note').textContent)
            .toBe(`rank-streets-worst shown=${limit} total=${model.streetCount}`);

        // A row is the street itself: it logs as one, hands the page the street to select, and is marked when the
        // selection comes back from the map.
        const row = document.querySelectorAll('.acs-rank__row')[0];
        const streetId = Number(row.dataset.rowId);
        row.click();
        expect(callbacks.log).toHaveBeenCalledWith('RankSelect_streetId', streetId);
        expect(callbacks.onRankSelect).toHaveBeenCalledWith({unit: 'streets', id: streetId});
        // A street row is a map selection, not the band's own focus, so nothing is focused before the map answers.
        expect(dock.state.focus).toBeNull();
        dock.setSelection({unit: 'streets', id: streetId});
        flush();
        expect(document.querySelector('.acs-rank__row[aria-current="true"]').dataset.rowId).toBe(String(streetId));

        // The neighborhoods unit has tens of rows, not a leaderboard, so the toggle goes away with them.
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        flush();
        expect(order.hidden).toBe(true);
        expect(document.getElementById('acs-dock-rank-title').textContent).toBe('chart-rank');
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(REGIONS.length);
    });

    test('the photo strip shows the region\'s worst clusters first, opens the label card, and ignores a late feed', async () => {
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        dock.setSelection({unit: 'regions', id: 1});
        flush();
        await settle();
        expect(document.querySelector('.acs-photos__caption').textContent).toBe('photos-from scope=Fixture');
        const items = document.querySelectorAll('.acs-photos__item');
        // Severity 3 ahead of 1, each cluster shown by its newest label (101 over 100); a label with a crop shows
        // it, one without shows the type placeholder.
        expect(Array.from(items).map((el) => el.dataset.labelId)).toEqual(['101', '103']);
        expect(items[0].querySelector('.lmc__image').getAttribute('src')).toBe('https://example.test/101.jpg');
        expect(items[1].querySelector('.lmc__placeholder')).not.toBeNull();
        expect(items[0].querySelector('.lmc__open').getAttribute('data-ps-tooltip')).toBe('obstacle, high');
        items[1].querySelector('.lmc__open').click();
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
    test('the strip ranks worst first, the confirmed ahead of the unchecked and the disputed last (#5386)', async () => {
        const rank = window.AccessScorePhotoStrip.compareWorstFirst;
        const entries = [
            {id: 'sev2-confirmed', severity: 2, agree: 3, disagree: 0},
            {id: 'sev3-disputed', severity: 3, agree: 1, disagree: 2},
            {id: 'unrated', severity: null, agree: 5, disagree: 0},
            {id: 'sev3-unchecked-big', severity: 3, agree: 0, disagree: 0, size: 4},
            {id: 'sev3-confirmed-1', severity: 3, agree: 1, disagree: 0},
            {id: 'sev3-confirmed-4', severity: 3, agree: 4, disagree: 1},
            {id: 'sev3-unchecked-small', severity: 3, agree: 0, disagree: 0, size: 1},
        ];
        expect(entries.slice().sort(rank).map((e) => e.id)).toEqual([
            'sev3-confirmed-4', 'sev3-confirmed-1', 'sev3-unchecked-big', 'sev3-unchecked-small', 'sev3-disputed',
            'sev2-confirmed', 'unrated',
        ]);

        // Cluster 5 has the worse median but its label is disputed, so cluster 4's confirmed label leads: the ribbon
        // takes the labels' own order. The region the city scope already fetched answers from the strip's cache, so
        // the feed below is served for the other one.
        const ranked = model.rankedRegions();
        const region = ranked[ranked.length - 1].regionId === 1 ? 2 : 1;
        const previous = fetchMock.getMockImplementation();
        const clusterOf = (id, labelId, extra) => ({type: 'Feature', properties: {label_cluster_id: id,
            label_type: 'Obstacle', street_edge_id: 1, intersection_id: null, region_id: region, region_name: 'R',
            label_ids: [labelId], cluster_size: 1, ...extra}});
        const labelOf = (id, extra) => ({label_id: id, label_type: 'Obstacle', crop_url: null,
            backup_image_url: null, ...extra});
        fetchMock.mockImplementation((input) => {
            const url = new URL(String(input), 'http://localhost');
            if (url.pathname === '/v3/api/labelClusters') {
                return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({
                    type: 'FeatureCollection',
                    features: [
                        clusterOf(4, 401, {median_severity: 2, agree_count: 2, disagree_count: 0}),
                        clusterOf(5, 501, {median_severity: 3, agree_count: 0, disagree_count: 0}),
                        clusterOf(6, 601, {median_severity: 1, agree_count: 0, disagree_count: 3}),
                    ],
                })});
            }
            if (url.pathname === '/label/id/401') {
                return Promise.resolve({ok: true, status: 200,
                    json: () => Promise.resolve(labelOf(401, {severity: 3, num_agree: 2, num_disagree: 0}))});
            }
            if (url.pathname === '/label/id/501') {
                return Promise.resolve({ok: true, status: 200,
                    json: () => Promise.resolve(labelOf(501, {severity: 3, num_agree: 0, num_disagree: 1}))});
            }
            if (url.pathname === '/label/id/601') {
                return Promise.resolve({ok: true, status: 200,
                    json: () => Promise.resolve(labelOf(601, {severity: 1, num_agree: 0, num_disagree: 3}))});
            }
            return previous(input);
        });
        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        dock.setSelection({unit: 'regions', id: region});
        flush();
        await settle();
        const ribbon = document.querySelector('.acs-photos__ribbon');
        expect(ribbon.tagName).toBe('OL'); // a ranking, numbered by the CSS
        expect(Array.from(ribbon.querySelectorAll('.acs-photos__item')).map((el) => el.dataset.labelId))
            .toEqual(['401', '501', '601']);
        // The label card pages through the strip in ribbon order.
        ribbon.querySelector('.acs-photos__item .lmc__open').click();
        expect(callbacks.onOpenLabel).toHaveBeenCalledWith(401, [401, 501, 601]);
    });

    test('zoomed in with nothing selected, the strip follows the area in view and a settled pan refreshes it', async () => {
        const moveend = map.on.mock.calls.find(([name]) => name === 'moveend')[1];
        const captionEl = () => document.querySelector('.acs-photos__caption').textContent;
        const shownIds = () => Array.from(document.querySelectorAll('.acs-photos__item')).map((el) => el.dataset.labelId);
        await settle();
        const ranked = model.rankedRegions();
        expect(captionEl()).toBe(`photos-from scope=photos-lowest name=${ranked[ranked.length - 1].name}`);

        // Zoom in over both regions: the strip pools their feeds and keeps only the clusters inside the bounds
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

        // A pan onto a cluster whose label never loads leaves the empty state up, and the next pan over the same
        // cluster retries the label rather than keeping an empty ribbon with no text.
        const labelFetches = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/label/id/')).length;
        map.getBounds = () => ({getWest: () => 0, getSouth: () => 0, getEast: () => 0.15, getNorth: () => 0.15});
        moveend({originalEvent: {}});
        jest.advanceTimersByTime(window.AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
        await settle();
        expect(shownIds()).toEqual([]);
        expect(document.querySelector('.acs-photos__status').textContent).toBe('photos-empty');
        const before = labelFetches();
        map.getBounds = () => ({getWest: () => -0.0004, getSouth: () => 0, getEast: () => 0.15, getNorth: () => 0.15});
        moveend({originalEvent: {}});
        jest.advanceTimersByTime(window.AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
        await settle();
        expect(labelFetches()).toBe(before + 1);
        expect(document.querySelector('.acs-photos__status').textContent).toBe('photos-empty');

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

    test('a city with one neighborhood ranks its streets but drops the neighborhoods list', async () => {
        const oneRegion = [REGIONS[0]];
        const features = FIXTURE.streets.map((c, i) => feature(c, i, {region_id: 1}));
        model = new window.AccessScoreModel(FIXTURE.config, {type: 'FeatureCollection', features},
            {type: 'FeatureCollection', features: []}, oneRegion);
        document.body.innerHTML = DOCK_HTML;
        dock = new window.AccessScoreDock(document.getElementById('acs-dock'), {model, mapView, map,
            config: FIXTURE.config, ...callbacks});
        flush();
        const panel = document.querySelector('.acs-dock__panel--rank');
        const body = document.getElementById('acs-dock-body');
        // The streets leaderboard is a real list in such a city, so the panel opens exactly as anywhere else.
        expect(panel.hidden).toBe(false);
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(window.AccessScoreModel.RANK_LIMIT);
        expect(body.classList).not.toContain('acs-dock__body--no-rank');

        model.setState({unit: 'regions'});
        dock.applyChange({kind: 'Unit', final: true});
        flush();
        expect(panel.hidden).toBe(true);
        expect(body.classList).toContain('acs-dock__body--no-rank');
        // The rest of the band is untouched by the missing column.
        expect(document.querySelectorAll('.acs-histogram__bin')).toHaveLength(10);
        expect(document.querySelectorAll('.acs-whats-here__row')).toHaveLength(FIXTURE.config.scored_types.length);
        // Every path that marks or clears a rank row, the brushed redraw included, still runs.
        expect(() => {
            dock.markHover({unit: 'regions', id: 1, score: 0.5});
            dock.markHover(null);
            dock.setBrush({from: 2, to: 5}, {final: true});
            flush();
            dock.setBrush(null, {final: true});
            flush();
        }).not.toThrow();
        expect(panel.hidden).toBe(true);

        // The panel is out for the unit, not for the city, so the switch back brings it and its list.
        model.setState({unit: 'streets'});
        dock.applyChange({kind: 'Unit', final: true});
        flush();
        expect(panel.hidden).toBe(false);
        expect(body.classList).not.toContain('acs-dock__body--no-rank');
        expect(document.querySelectorAll('.acs-rank__row')).toHaveLength(window.AccessScoreModel.RANK_LIMIT);

        await settle();
        // "(lowest scoring)" is a comparison, so one neighborhood is captioned by its name alone.
        expect(document.querySelector('.acs-photos__caption').textContent).toBe('photos-from scope=Fixture');
    });
});
