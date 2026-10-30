/**
 * The /v3/api-docs/sidewalkPresence preview (#5840): one map of the busiest region's block faces, each street drawn
 * twice and colored by what the labels say about that side, with a legend of the verdicts present, a summary, and a
 * popup that sets a face beside the other side of its street.
 */

import { loadModules } from './loader.js';
import {
  FakeMap, flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

function face(streetEdgeId, side, properties = {}) {
  return {
    type: 'Feature',
    properties: { street_edge_id: streetEdgeId, street_side: side, presence: 'unknown', ...properties },
    geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] },
  };
}

/**
 * Street 1 has no sidewalk on its left (three labels, one confirmed) and one on its right; street 2's left is called
 * absent from the other side's tag; street 3 is unaudited on both sides, and street 4's two faces are absent on one
 * and two labels.
 */
function faces() {
  return {
    type: 'FeatureCollection',
    features: [
      face(1, 'left', { presence: 'absent', no_sidewalk_label_count: 3, validated_no_sidewalk_count: 1 }),
      face(1, 'right', { presence: 'present' }),
      face(2, 'left', { presence: 'absent', no_sidewalk_label_count: 0 }),
      face(3, 'left'),
      face(3, 'right'),
      face(4, 'left', { presence: 'absent', no_sidewalk_label_count: 1 }),
      face(4, 'right', { presence: 'absent', no_sidewalk_label_count: 2 }),
    ],
  };
}

/** Loads the preview onto a page with its container, and runs it against the given responses. */
async function renderPreview({ region = regionFeature(), faceData = faces(), routes = {} } = {}) {
  document.body.innerHTML = '<div id="sidewalk-presence-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/regionWithMostLabels': region,
    '/v3/api/sidewalkPresence?regionId=7': faceData,
    ...routes,
  });
  const { SidewalkPresencePreview } = await loadModules('frontend/js/api-docs/sidewalkPresencePreview.js');
  await SidewalkPresencePreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, map: world.maps[0], container: document.getElementById('sidewalk-presence-preview') };
}

/** @returns {string[]} The text of each of an element's direct children. */
const rows = (el) => [...el.children].map(textOf);

/** Clicks a face on the map and returns its popup. */
function clickFace(map, properties) {
  map.fireOn('face-lines', 'click', [{ properties }], { lng: 1, lat: 2 });
  return world.popups.at(-1);
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a region with block faces', () => {
  it('draws every face, each with an id of its own, on a map framed on the region', async () => {
    const { map, container } = await renderPreview();
    expect(container.querySelector('.loading-message')).toBeNull();
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.01, 0.01]]);
    expect(textOf(container.querySelector('.map-chip'))).toBe('Region: Fremont');
    const ids = map.sources['sidewalk-presence'].data.features.map((f) => f.properties.face_id);
    expect(ids).toEqual(['1:left', '1:right', '2:left', '3:left', '3:right', '4:left', '4:right']);
    expect(map.layers['face-lines'].paint['line-offset']).toEqual(['match', ['get', 'street_side'], 'left', -3.5, 3.5]);
  });

  it('sums up the verdicts, the streets missing a side, and the evidence behind each absent face', async () => {
    const { container } = await renderPreview();
    expect(rows(container.querySelector('.map-stats'))).toEqual([
      'Summary',
      'Street sides: 7',
      'No sidewalk: 57%',
      'Sidewalk: 14%',
      'Unknown: 29%',
      'Streets missing a side: 3',
      'By label count (1 / 2 / 3+): 1 / 1 / 1',
      'Validator-confirmed: 1',
    ]);
  });

  it('lists in the legend only the verdicts the region has', async () => {
    const data = { type: 'FeatureCollection', features: [face(1, 'left', { presence: 'present' }), face(1, 'right')] };
    const { container } = await renderPreview({ faceData: data });
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Sidewalk presence');
    expect([...legend.querySelectorAll('.map-legend-item')].map(textOf))
      .toEqual(['Sidewalk', 'Unknown (street not audited)']);
    expect(textOf(legend.querySelector('.map-legend-note')))
      .toBe('Each street is drawn twice: its left and right side.');
    expect(rows(container.querySelector('.map-stats'))).toContain('No sidewalk: 0%');
  });

  it('marks the face under the pointer as hovered', async () => {
    const { map } = await renderPreview();
    map.fireOn('face-lines', 'mousemove', [{ id: '1:left' }]);
    expect(map.stateOf('sidewalk-presence', '1:left')).toEqual({ hover: true });
  });
});

describe("a face's popup", () => {
  it("gives a labeled face's evidence, its dates, its rejections, and the other side's verdict", async () => {
    const { map } = await renderPreview();
    const popup = clickFace(map, {
      ...faces().features[0].properties,
      presence_basis: 'no_sidewalk_labels',
      no_sidewalk_user_count: 2,
      first_no_sidewalk_label_date: '2024-01-02T12:00:00Z',
      last_no_sidewalk_label_date: '2025-06-03T12:00:00Z',
      rejected_no_sidewalk_count: 1,
      label_count: 4,
      way_type: 'residential',
      osm_way_id: 55,
    });
    expect(popup.lngLat).toEqual({ lng: 1, lat: 2 });
    expect(popup.text()).toContain('Street 1, left side Verdict: No sidewalk');
    expect(popup.text()).toContain('Basis: 3 NoSidewalk labels from 2 users, 1 validator-confirmed');
    expect(popup.text()).toContain(`NoSidewalk labels placed: ${new Date('2024-01-02T12:00:00Z').toLocaleDateString()}`
      + ` to ${new Date('2025-06-03T12:00:00Z').toLocaleDateString()}`);
    expect(popup.text()).toContain('Rejected by validators: 1 NoSidewalk label');
    expect(popup.text()).toContain('Labels on this side: 4 Other side: Sidewalk Type: residential OSM ID: 55');
    expect(popup.element.querySelector('a[href="https://www.openstreetmap.org/way/55"]')).not.toBeNull();
    expect(popup.element.querySelector('a[href="/explore?streetEdgeId=1"]')).not.toBeNull();
  });

  it('says one label from one user without a confirmation when none was confirmed', async () => {
    const { map } = await renderPreview();
    const popup = clickFace(map, {
      ...faces().features[5].properties, presence_basis: 'no_sidewalk_labels', no_sidewalk_user_count: 1,
    });
    expect(popup.text()).toContain('Basis: 1 NoSidewalk label from 1 user Labels');
    expect(popup.text()).not.toContain('placed');
    expect(popup.text()).not.toContain('Rejected');
  });

  it("explains a face called from the other side's tag, and one audited without a label", async () => {
    const { map } = await renderPreview();
    expect(clickFace(map, { ...faces().features[2].properties, presence_basis: 'other_side_tag' }).text())
      .toContain('Basis: the other side is tagged "street has no sidewalks"');
    expect(clickFace(map, { ...faces().features[1].properties, presence_basis: 'audited_no_labels', audit_count: 1 })
      .text()).toContain('Basis: audited 1 time with no NoSidewalk label on this side');
    expect(clickFace(map, { ...faces().features[1].properties, presence_basis: 'audited_no_labels', audit_count: 3 })
      .text()).toContain('audited 3 times');
  });

  it("gives an unaudited face's basis, and N/A for a missing other side and OSM way", async () => {
    const { map } = await renderPreview();
    const popup = clickFace(map, faces().features[2].properties);
    expect(popup.text()).toContain('Verdict: No sidewalk Basis: the street has not been audited yet');
    expect(popup.text()).toContain('Labels on this side: 0 Other side: N/A Type: Unknown OSM ID: N/A');
    expect(popup.text()).not.toContain('On OSM');
  });

  it('names a verdict the page has no swatch for as the API gave it', async () => {
    const { map } = await renderPreview();
    expect(clickFace(map, { ...faces().features[3].properties, presence: 'partial' }).text())
      .toContain('Verdict: partial');
  });

  it('says which side of each OSM way the face is', async () => {
    const { map } = await renderPreview();
    // Mapbox hands back an array property as a JSON string.
    const osmWays = JSON.stringify([{ osm_way_id: 55, osm_side: 'left' }, { osm_way_id: 56, osm_side: null }]);
    const popup = clickFace(map, { ...faces().features[1].properties, osm_ways: osmWays });
    expect(popup.text()).toContain('On OSM: 55 (its left side); 56 (side unknown)');
  });
});

describe('an empty region', () => {
  it('says the region has no streets, and draws no faces, legend, or summary', async () => {
    const { map, container } = await renderPreview({
      region: regionFeature({ region_id: 7 }), faceData: { type: 'FeatureCollection' },
    });
    const chips = container.querySelectorAll('.map-chip');
    expect(textOf(chips[0])).toBe('Region: Sample Region');
    expect(chips[1].getAttribute('role')).toBe('status');
    expect(textOf(chips[1])).toBe('No streets found in this region.');
    expect(map.layers['face-lines']).toBeUndefined();
    expect(container.querySelector('.map-legend, .map-stats')).toBeNull();
  });
});

describe('when something fails', () => {
  /** @returns {string} What the preview's container reads. */
  const shown = () => textOf(document.getElementById('sidewalk-presence-preview'));

  it('shows the region lookup failing, and fetches no faces', async () => {
    const routes = { '/v3/api/regionWithMostLabels': { status: 500 } };
    const { fetchStub, container } = await renderPreview({ routes });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(shown()).toBe('Failed to load sidewalk presence: Failed to fetch region with most labels');
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('shows the faces request failing', async () => {
    await renderPreview({ routes: { '/v3/api/sidewalkPresence?regionId=7': { status: 503 } } });
    expect(shown()).toBe('Failed to load sidewalk presence: HTTP error! Status: 503');
  });

  it('shows a map that fails to draw as failed, and frees it', async () => {
    vi.spyOn(FakeMap.prototype, 'addSource').mockImplementation(() => { throw new Error('out of contexts'); });
    await renderPreview();
    expect(shown()).toBe('Failed to load sidewalk presence: out of contexts');
    expect(world.maps[0].removed).toBe(true);
  });

  it('does nothing but report it when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { SidewalkPresencePreview } = await loadModules('frontend/js/api-docs/sidewalkPresencePreview.js');
    await SidewalkPresencePreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Sidewalk presence preview container element not found.');
  });
});
