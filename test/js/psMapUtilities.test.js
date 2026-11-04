/**
 * Tests for the label and street filters and the label feed fetch in frontend/js/ps-map/psMapUtilities.js (#5840).
 *
 * Every label map's sidebar ends in these Mapbox filter expressions, so a wrong one hides labels or streets with no
 * error anywhere. The feed fetch is pinned too, since its error text is what tells a broken stream from a bad URL.
 */

import { loadModules, mockModule } from './loader.js';
import { FakeMap, fakeMapboxgl } from './support/psMapHarness.js';

mockModule('frontend/js/common/mapboxgl.js', () => ({ default: fakeMapboxgl() }));

const {
  CreateMapLayerTracker, emphasizeStreetState, fetchLabelFeed, filterLabelLayers, filterStreetLayer, toggleLabelLayer,
} = await loadModules('frontend/js/ps-map/psMapUtilities.js');

/**
 * A map holding a layer for CurbRamp and Obstacle only, with a tracker that names those two.
 * @returns {{map: FakeMap, mapData: object}} The map and its tracker.
 */
function labelMap() {
  const map = new FakeMap();
  const mapData = CreateMapLayerTracker();
  mapData.layerNames.CurbRamp = 'labels-CurbRamp';
  mapData.layerNames.Obstacle = 'labels-Obstacle';
  map.addLayer({ id: 'labels-CurbRamp' });
  map.addLayer({ id: 'labels-Obstacle' });
  return { map, mapData };
}

describe('fetchLabelFeed', () => {
  /**
   * @param {object} response - What the stubbed fetch resolves with.
   * @returns {import('vitest').Mock} The stub, now installed as `fetch`.
   */
  const stubFetch = (response) => {
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  test('hands back the parsed feed, passing the abort signal through', async () => {
    const feed = { type: 'FeatureCollection', features: [] };
    const fetch = stubFetch({ ok: true, json: async () => feed });
    const signal = new AbortController().signal;
    await expect(fetchLabelFeed('/labels/all', { signal })).resolves.toBe(feed);
    expect(fetch).toHaveBeenCalledWith('/labels/all', { signal });
  });

  test('names the HTTP status when the server refuses', async () => {
    stubFetch({ ok: false, status: 503 });
    await expect(fetchLabelFeed('/labels/all')).rejects.toThrow('Label feed /labels/all failed with HTTP 503.');
  });

  test('says the body was unreadable when a 200 stream breaks off mid-feed', async () => {
    const parseError = new SyntaxError('Unexpected end of JSON input');
    stubFetch({ ok: true, json: async () => { throw parseError; } });
    const error = await fetchLabelFeed('/labels/all').catch((e) => e);
    expect(error.message).toBe(
      'Label feed /labels/all returned an unreadable body (truncated stream?): Unexpected end of JSON input');
    expect(error.cause).toBe(parseError);
  });

  test('lets a cancelled request through as the abort it is, not as a feed failure', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    stubFetch({ ok: true, json: async () => { throw abort; } });
    await expect(fetchLabelFeed('/labels/all')).rejects.toBe(abort);
  });
});

describe('toggleLabelLayer', () => {
  test('shows and hides a label type that has a layer', () => {
    const { map, mapData } = labelMap();
    toggleLabelLayer('CurbRamp', false, map, mapData);
    expect(map.layout['labels-CurbRamp.visibility']).toBe('none');
    toggleLabelLayer('CurbRamp', true, map, mapData);
    expect(map.layout['labels-CurbRamp.visibility']).toBe('visible');
  });

  test('leaves alone a label type whose layer was never made', () => {
    const { map, mapData } = labelMap();
    toggleLabelLayer('Signal', false, map, mapData);
    mapData.layerNames.Signal = 'labels-Signal';
    toggleLabelLayer('Signal', false, map, mapData);
    expect(map.layout).toEqual({});
  });
});

describe('filterLabelLayers', () => {
  test('by default keeps every severity, including unrated labels', () => {
    const { map, mapData } = labelMap();
    filterLabelLayers(map, mapData, false);
    const [, severity] = map.filters['labels-CurbRamp'];
    expect(severity).toEqual(['any',
      ['==', ['get', 'severity'], null],
      ['==', ['get', 'severity'], 1],
      ['==', ['get', 'severity'], 2],
      ['==', ['get', 'severity'], 3],
    ]);
  });

  test('with every severity switched off, matches no label at all', () => {
    const { map, mapData } = labelMap();
    mapData.severities = { 0: false, 1: false, 2: false, 3: false };
    filterLabelLayers(map, mapData, false);
    expect(map.filters['labels-CurbRamp'][1]).toEqual(['any', false]);
  });

  test('carries the validation checkboxes into the filter', () => {
    const { map, mapData } = labelMap();
    mapData.incorrect = true;
    mapData.unvalidated = false;
    filterLabelLayers(map, mapData, false);
    const [, , validation] = map.filters['labels-CurbRamp'];
    expect(validation[1][1]).toBe(true); // correct
    expect(validation[2][1]).toBe(true); // incorrect
    expect(validation[3][1]).toBe(true); // unsure
    expect(validation[4][1]).toBe(false); // unvalidated
  });

  test('adds the low-quality-user and admin-validated clauses only when asked', () => {
    const { map, mapData } = labelMap();
    filterLabelLayers(map, mapData, false);
    expect(map.filters['labels-CurbRamp']).toHaveLength(3);

    mapData.notAdminValidated = true;
    filterLabelLayers(map, mapData, true);
    expect(map.filters['labels-CurbRamp'].slice(3)).toEqual([
      ['any', false, ['==', ['get', 'high_quality_user'], true]],
      ['==', ['get', 'has_admin_validation'], false],
    ]);
  });

  test('narrows only the label type with selected tags to labels carrying one of them', () => {
    const { map, mapData } = labelMap();
    mapData.selectedTags.Obstacle = new Set(['tree', 'pole']);
    filterLabelLayers(map, mapData, false);
    expect(map.filters['labels-Obstacle'].at(-1))
      .toEqual(['any', ['in', 'tree', ['get', 'tags']], ['in', 'pole', ['get', 'tags']]]);
    expect(map.filters['labels-CurbRamp']).toHaveLength(3);
  });

  test('keeps the spotlit label visible whatever the filters say', () => {
    const { map, mapData } = labelMap();
    mapData.spotlightLabelId = 42;
    mapData.selectedTags.Obstacle = new Set(['tree']);
    filterLabelLayers(map, mapData, false);
    for (const layer of ['labels-CurbRamp', 'labels-Obstacle']) {
      const [any, , spotlight] = map.filters[layer];
      expect(any).toBe('any');
      expect(spotlight).toEqual(['==', ['get', 'label_id'], 42]);
    }
  });

  test('skips a label type whose layer is not on the map', () => {
    const { map, mapData } = labelMap();
    mapData.layerNames.Signal = 'labels-Signal';
    filterLabelLayers(map, mapData, false);
    expect(Object.keys(map.filters).sort()).toEqual(['labels-CurbRamp', 'labels-Obstacle']);
  });
});

describe('emphasizeStreetState', () => {
  test('does nothing on a map that draws no streets', () => {
    const map = new FakeMap();
    emphasizeStreetState(map, 'audited');
    expect(map.paint).toEqual({});
  });
});

describe('filterStreetLayer', () => {
  const AUDITED = ['==', ['get', 'audited'], true];
  const OUTDATED = ['==', ['get', 'outdated'], true];
  const UNAUDITED = ['all', ['!=', ['get', 'audited'], true], ['!=', ['get', 'outdated'], true]];

  /**
   * Puts the sidebar's street checkboxes on the page.
   * @param {Record<string, boolean>} checked - Each checkbox id to render, and whether it is ticked.
   */
  const checkboxes = (checked) => {
    document.body.innerHTML = Object.entries(checked)
      .map(([id, on]) => `<input type="checkbox" id="${id}" ${on ? 'checked' : ''}>`).join('');
  };

  test('shows every street, unfiltered, when all three boxes are ticked', () => {
    checkboxes({ 'audited-street': true, 'outdated-street': true, 'unaudited-street': true });
    const map = new FakeMap();
    filterStreetLayer(map);
    expect(map.layout['streets.visibility']).toBe('visible');
    expect(map.filters.streets).toBeNull();
  });

  test('hides the layer outright when no box is ticked', () => {
    checkboxes({ 'audited-street': false, 'outdated-street': false, 'unaudited-street': false });
    const map = new FakeMap();
    filterStreetLayer(map);
    expect(map.layout['streets.visibility']).toBe('none');
    expect(map.filters).toEqual({});
  });

  test('shows only the ticked states', () => {
    checkboxes({ 'audited-street': false, 'outdated-street': true, 'unaudited-street': true });
    const map = new FakeMap();
    filterStreetLayer(map);
    expect(map.filters.streets).toEqual(['any', OUTDATED, UNAUDITED]);
  });

  test('on a page with no outdated box, outdated streets follow the audited one', () => {
    checkboxes({ 'audited-street': true, 'unaudited-street': false });
    const map = new FakeMap();
    filterStreetLayer(map);
    expect(map.filters.streets).toEqual(['any', AUDITED, OUTDATED]);
  });
});
