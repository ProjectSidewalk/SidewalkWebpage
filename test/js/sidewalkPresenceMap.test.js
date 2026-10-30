/** Tests for the admin Sidewalks page's map: how each street side is drawn, its popup, and focusing streets (#5840). */

import { loadModules, mockModule } from './loader.js';
import { stubMapbox } from './support/adminMapHarness.js';

const mapboxgl = {};
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
const { SidewalkPresenceMap, SidewalkPresenceStyle } =
  await loadModules('frontend/js/admin-dashboard/SidewalkPresenceMap.js');

/** @returns {object} One street side as SidewalksPage.join builds it from /adminapi/sidewalkPresence. */
function face(streetId, side, coords, props = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      street_edge_id: streetId, street_side: side, face_id: `${streetId}:${side}`, region_name: 'Downtown',
      presence: 'absent', presence_basis: 'no_sidewalk_labels', other_presence: 'present',
      no_sidewalk_label_count: 3, no_sidewalk_user_count: 2, validated_no_sidewalk_count: 1,
      rejected_no_sidewalk_count: 0, curb_ramp_count: 4, problem_label_count: 1200, audit_count: 2, ...props,
    },
  };
}

const LINE_A = [[-122.5, 47.5], [-122.25, 47.75]];
const LINE_B = [[-122, 47], [-121.5, 47.25]];
const FACES = { type: 'FeatureCollection', features: [
  face(1, 'left', LINE_A), face(1, 'right', LINE_A, { presence: 'present' }),
  face(2, 'left', LINE_B), face(2, 'right', LINE_B),
] };

/** @returns {{state: object, map: object, ready: Promise<void>}} A map built over FACES; it loads on `state.load()`. */
function build() {
  const state = stubMapbox(mapboxgl);
  const map = new SidewalkPresenceMap('sidewalks-map', { mapboxToken: 'pk.test' });
  const ready = map.init(FACES);
  return { state, map, ready };
}

/** @returns {Promise<{state: object, map: object}>} A map built over FACES and loaded. */
async function loaded() {
  const built = build();
  built.state.load();
  await built.ready;
  return built;
}

/** @returns {Array<[string, string]>} The popup's rows as [label, value text] pairs. */
function popupRows(state) {
  const el = document.createElement('div');
  el.innerHTML = state.popup.html;
  return [...el.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]);
}

const over = (props) => ({ lngLat: {}, features: [{ id: props.face_id, properties: props }] });

beforeAll(() => {
  const root = document.documentElement.style;
  root.setProperty('--color-label-no-sidewalk', '#BE87D8');
  root.setProperty('--color-success-200', ' #1a7f37 ');
  root.setProperty('--color-error-200', '#c62828');
  root.setProperty('--color-neutral-700', '#555555');
});

describe('SidewalkPresenceStyle', () => {
  test('names each verdict and basis, and passes through a value it does not know yet', () => {
    expect(SidewalkPresenceStyle.presenceLabel('absent')).toBe('No sidewalk');
    expect(SidewalkPresenceStyle.presenceLabel('partial')).toBe('partial');
    expect(SidewalkPresenceStyle.basisLabel('unaudited')).toBe('Not audited');
    expect(SidewalkPresenceStyle.basisLabel('osm_tag')).toBe('osm_tag');
  });

  test('reads a color token from the page\'s styles, trimmed', () => {
    expect(SidewalkPresenceStyle.color('--color-success-200')).toBe('#1a7f37');
  });
});

describe('SidewalkPresenceMap', () => {
  test('refuses to start without a Mapbox token', () => {
    stubMapbox(mapboxgl);
    expect(() => new SidewalkPresenceMap('sidewalks-map', {}).init(FACES)).toThrow(/missing Mapbox access token/);
  });

  test('opens on every side, keyed by face, colored by verdict from the page\'s color tokens', async () => {
    const { state } = await loaded();
    expect(mapboxgl.accessToken).toBe('pk.test');
    expect(state.options.bounds.toArray()).toEqual([[-122.5, 47], [-121.5, 47.75]]);
    expect(state.sources['sidewalk-faces']).toMatchObject({ data: FACES, promoteId: 'face_id' });
    expect(state.layers['sidewalk-face-line'].paint['line-color']).toEqual(['match', ['get', 'presence'],
      'absent', '#BE87D8', 'present', '#1a7f37', 'unknown', '#c62828', '#555555']);
    // Left sides sit left of the centerline and right sides right of it.
    expect(state.layers['sidewalk-face-line'].paint['line-offset']).toEqual(
      ['match', ['get', 'street_side'], 'left', -3, 3]);
    expect(state.layers['sidewalk-face-halo'].filter).toEqual(['in', ['get', 'face_id'], ['literal', []]]);
  });

  test('hovering a side shows its verdict, the evidence for it, and the other side\'s verdict', async () => {
    const { state } = await loaded();
    state.fire('mousemove', 'sidewalk-face-line', over(FACES.features[0].properties));

    expect(state.cursor).toBe('pointer');
    expect(state.stateOf('1:left')).toEqual({ hover: true });
    expect(state.popup.open).toBe(true);
    expect(state.popup.html).toContain('Street 1, left side');
    expect(popupRows(state)).toEqual([
      ['This side', 'No sidewalk'],
      ['Basis', 'NoSidewalk labels on this side'],
      ['NoSidewalk', '3 labels from 2 users, 1 confirmed'],
      ['Other labels', '4 curb ramps, 1,200 obstacle/surface'],
      ['Other side', 'Sidewalk'],
      ['Audits', '2'],
      ['Region', 'Downtown'],
    ]);
  });

  test('a side validators rejected says so; one with no NoSidewalk labels skips that row', async () => {
    const { state } = await loaded();
    state.fire('mousemove', 'sidewalk-face-line', over(face(3, 'right', LINE_A, {
      presence: 'present', presence_basis: 'audited_no_labels', no_sidewalk_label_count: 0,
      rejected_no_sidewalk_count: 2, region_name: '<b>Harbor</b>',
    }).properties));
    const rows = popupRows(state);
    expect(rows.map(([label]) => label)).not.toContain('NoSidewalk');
    expect(rows).toContainEqual(['Rejected', '2 NoSidewalk by validators']);
    expect(rows).toContainEqual(['Region', '<b>Harbor</b>']);
  });

  test('a verdict the page does not know yet shows its raw value with a neutral swatch', async () => {
    const { state } = await loaded();
    state.fire('mousemove', 'sidewalk-face-line', over(face(3, 'left', LINE_A, {
      presence: 'partial', other_presence: null,
    }).properties));
    expect(popupRows(state)[0]).toEqual(['This side', 'partial']);
    expect(state.popup.html).toContain('background:var(--color-neutral-700)');
  });

  test('moving between sides unhovers the first; staying on one sets nothing new; leaving clears it', async () => {
    const { state } = await loaded();
    state.fire('mousemove', 'sidewalk-face-line', over(FACES.features[0].properties));
    state.fire('mousemove', 'sidewalk-face-line', over(FACES.features[0].properties));
    expect(state.featureStates).toHaveLength(1);
    state.fire('mousemove', 'sidewalk-face-line', over(FACES.features[1].properties));
    expect(state.stateOf('1:left')).toEqual({ hover: false });
    expect(state.stateOf('1:right')).toEqual({ hover: true });

    state.fire('mouseleave', 'sidewalk-face-line');
    expect(state.stateOf('1:right')).toEqual({ hover: false });
    expect(state.cursor).toBe('');
    expect(state.popup.open).toBe(false);
  });

  test('a mouse move over no side is ignored', async () => {
    const { state } = await loaded();
    state.fire('mousemove', 'sidewalk-face-line', { features: [] });
    expect(state.popup.open).toBe(false);
  });

  test('a filter shows only the sides that pass it; before the map exists it is a no-op', async () => {
    stubMapbox(mapboxgl);
    expect(() => new SidewalkPresenceMap('sidewalks-map', { mapboxToken: 'pk.test' }).setFilter(['all']))
      .not.toThrow();

    const { state, map } = await loaded();
    map.setFilter(['==', ['get', 'presence'], 'absent']);
    expect(state.filters['sidewalk-face-line']).toEqual(['==', ['get', 'presence'], 'absent']);
  });

  test('focusing streets halos both their sides and fits the view to them', async () => {
    const { state, map } = await loaded();
    map.focusStreets([1, 2]);
    expect(state.filters['sidewalk-face-halo'])
      .toEqual(['in', ['get', 'face_id'], ['literal', ['1:left', '1:right', '2:left', '2:right']]]);
    expect(state.fits).toEqual([{ bounds: [[-122.5, 47], [-121.5, 47.75]], options: { padding: 48, maxZoom: 17 } }]);
  });

  test('focusing nothing clears the halo and leaves the view alone', async () => {
    const { state, map } = await loaded();
    map.focusStreets([]);
    expect(state.filters['sidewalk-face-halo']).toEqual(['in', ['get', 'face_id'], ['literal', []]]);
    expect(state.fits).toEqual([]);
  });

  test('a street chosen before the map loads is focused once it does', async () => {
    const { state, map, ready } = build();
    map.focusStreets([2]);
    expect(state.filters['sidewalk-face-halo']).toBeUndefined();
    state.load();
    await ready;
    expect(state.filters['sidewalk-face-halo']).toEqual(['in', ['get', 'face_id'], ['literal', ['2:left', '2:right']]]);
    expect(state.fits[0].bounds).toEqual(LINE_B);
  });

  test('fitting skips streets the map does not have, and does nothing if none are left', async () => {
    const { state, map } = await loaded();
    map.fitStreets([99], 15);
    expect(state.fits).toEqual([]);
    map.fitStreets(['1', 99], 15);
    expect(state.fits).toEqual([{ bounds: LINE_A, options: { padding: 48, maxZoom: 15 } }]);
  });

  test('fitting before the map exists does nothing', () => {
    stubMapbox(mapboxgl);
    expect(() => new SidewalkPresenceMap('sidewalks-map', { mapboxToken: 'pk.test' }).fitStreets([1], 15))
      .not.toThrow();
  });
});
