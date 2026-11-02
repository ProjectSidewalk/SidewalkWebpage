/**
 * Tests for AccessScoreCrossingCard (frontend/js/access-score/AccessScoreCrossingCard.js, #5748): the card a
 * crossing's dot opens in the street panel. It builds one inset map on the first open and recenters it after, draws
 * the street and the crossing's clusters on it once loaded, lists the corner types worst first with their effects,
 * shows the costliest clusters' crops as pictures only and counts the rest, says so when there is nothing, and drops
 * a crop that arrives after it has closed.
 */

import {stubI18next} from './support/accessScoreDockHarness.js';
import {loadModules, mockModule} from './loader.js';

const maps = [];
class FakeMap {
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.sources = new Map();
    this.layers = [];
    this.jumpTo = vi.fn();
    this.resize = vi.fn();
    this.remove = vi.fn();
    maps.push(this);
  }

  on(event, handler) { this.handlers[event] = handler; }

  addSource(id, spec) { this.sources.set(id, {...spec, setData: vi.fn()}); }

  getSource(id) { return this.sources.get(id); }

  addLayer(spec) { this.layers.push(spec); }
}

/** A flushed microtask queue, for the feed's label promises. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('AccessScoreCrossingCard', () => {
  let AccessScoreCrossingCard;
  let el;
  let feed;
  let labels;

  const cluster = (id, type, severity, labelId, lng = -74) => ({
    label_cluster_id: id, label_type: type, median_severity: severity, cluster_size: 1, label_ids: [labelId],
    intersection_id: 7, tag_counts: {}, coordinates: [lng, 40.8],
  });
  const explanation = {
    intersectionId: 7, terms: {
      CurbRamp: {clusterCount: 2, term: 1.5},
      NoCurbRamp: {clusterCount: 1, term: -1},
      Crosswalk: {clusterCount: 0, term: 0},
    },
  };
  const crossing = (clusters) => ({
    key: 'start', name: 'Start crossing', lngLat: {lng: -74, lat: 40.8}, line: [[-74, 40.8], [-74, 40.801]],
    explanation, clusters, termOf: (p) => ({term: p.label_type === 'CurbRamp' ? 0.75 : -1}),
  });

  beforeAll(async () => {
    stubI18next();
    mockModule('frontend/js/common/mapboxgl.js', () => ({default: {Map: FakeMap}}));
    ({AccessScoreCrossingCard} = await loadModules('frontend/js/access-score/AccessScoreCrossingCard.js'));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    maps.length = 0;
    document.body.innerHTML = '<div id="card" role="tooltip" hidden></div>';
    el = document.getElementById('card');
    labels = {
      10: {label_id: 10, label_type: 'NoCurbRamp', crop_url: 'https://example.test/10.jpg'},
      11: {label_id: 11, label_type: 'CurbRamp', crop_url: null, backup_image_url: 'https://example.test/pano11.jpg'},
      12: {label_id: 12, label_type: 'CurbRamp', crop_url: null, backup_image_url: null},
      13: {label_id: 13, label_type: 'Obstacle', crop_url: 'https://example.test/13.jpg'},
      14: {label_id: 14, label_type: 'Obstacle', crop_url: 'https://example.test/14.jpg'},
    };
    feed = {label: vi.fn((id) => (labels[id] ? Promise.resolve(labels[id]) : Promise.reject(new Error('nope'))))};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeCard = () => new AccessScoreCrossingCard(el, {
    feed, types: ['CurbRamp', 'NoCurbRamp', 'Obstacle'], styleUrl: 'mapbox://styles/fixture/light',
  });
  const beat = () => vi.advanceTimersByTime(AccessScoreCrossingCard.MAP_DELAY_MS + 1);

  test('builds one inset on the first open, recenters it on the next, and draws the street and the clusters once loaded',
    () => {
      const card = makeCard();
      expect(card.open).toBe(false);
      card.show(crossing([cluster(1, 'NoCurbRamp', 3, 10)]));
      expect(card.open).toBe(true);
      expect(el.dataset.acsCardTail).toBe('start');
      expect(el.getAttribute('aria-label')).toBe('panel-crossing-card name=Start crossing');
      // A card open for a moment only, as a focus passing through leaves it, builds no map: a load is billed.
      expect(maps).toHaveLength(0);
      card.close();
      beat();
      expect(maps).toHaveLength(0);
      card.show(crossing([cluster(1, 'NoCurbRamp', 3, 10)]));
      beat();
      expect(maps).toHaveLength(1);
      expect(maps[0].options).toMatchObject({
        center: [-74, 40.8], zoom: AccessScoreCrossingCard.ZOOM, interactive: false, attributionControl: false,
        style: 'mapbox://styles/fixture/light',
      });
      expect(maps[0].options.container.classList.contains('acs-crossing-card__map')).toBe(true);
      // Nothing is drawn before the style has loaded; the pending crossing is drawn as it does.
      expect(maps[0].sources.size).toBe(0);
      maps[0].handlers.load();
      expect(maps[0].layers.map((l) => l.id)).toEqual(['acs-card-street', 'acs-card-clusters']);
      // The dots take the label palette; the layer's match expression covers every scored type and a fallback.
      const fill = maps[0].layers[1].paint['circle-color'];
      expect(fill[0]).toBe('match');
      expect(fill).toContain('NoCurbRamp');
      expect(fill).toHaveLength(2 + 3 * 2 + 1);
      expect(maps[0].getSource('acs-card-street').setData.mock.calls[0][0].features[0].geometry.coordinates)
        .toEqual([[-74, 40.8], [-74, 40.801]]);
      expect(maps[0].getSource('acs-card-clusters').setData.mock.calls[0][0].features).toEqual([
        {type: 'Feature', geometry: {type: 'Point', coordinates: [-74, 40.8]},
          properties: {label_type: 'NoCurbRamp', label_cluster_id: 1}},
      ]);
      // The next crossing reuses the map, and at once: only the first build waits. A resize for the container
      // that was hidden, a jump, fresh data.
      card.close();
      expect(card.open).toBe(false);
      card.show({...crossing([cluster(2, 'CurbRamp', 1, 11, -73.9)]), key: 'end', lngLat: {lng: -73.9, lat: 40.8}});
      expect(maps).toHaveLength(1);
      expect(maps[0].resize).toHaveBeenCalled();
      expect(maps[0].jumpTo).toHaveBeenCalledWith({center: [-73.9, 40.8], zoom: AccessScoreCrossingCard.ZOOM});
      expect(el.dataset.acsCardTail).toBe('end');
      expect(maps[0].getSource('acs-card-clusters').setData.mock.calls.at(-1)[0].features[0].properties.label_cluster_id)
        .toBe(2);
      card.destroy();
      expect(maps[0].remove).toHaveBeenCalled();
    });

  test('lists the corner types with clusters worst first, and says so when the crossing has none', () => {
    const card = makeCard();
    card.show(crossing(null));
    const rows = [...el.querySelectorAll('.acs-crossing-card__row')];
    expect(rows.map((r) => r.querySelector('.acs-crossing-card__type').textContent)).toEqual(['no-curb-ramp', 'curb-ramp']);
    expect(rows[0].querySelector('.acs-row__count').textContent).toBe('panel-clusters count=1');
    expect(rows[0].querySelector('.acs-row__effect').textContent).toBe('−1.00');
    expect(rows[0].querySelector('.acs-row__effect').classList.contains('acs-row__effect--problem')).toBe(true);
    expect(rows[1].querySelector('.acs-row__effect').textContent).toBe('+1.50');
    // The clusters not yet known: no crops, no "more", and nothing fetched.
    expect(el.querySelector('[data-acs-card-crops]').children).toHaveLength(0);
    expect(feed.label).not.toHaveBeenCalled();
    card.show({...crossing([]), explanation: {terms: {}}});
    expect(el.querySelector('.acs-crossing-card__row--empty').textContent).toBe('panel-crossing-no-clusters');
  });

  test('shows the first four clusters\' crops as pictures only, falls back to the placeholder, and counts the rest',
    async () => {
      const card = makeCard();
      card.show(crossing([
        cluster(1, 'NoCurbRamp', 3, 10), cluster(2, 'CurbRamp', 1, 11), cluster(3, 'CurbRamp', 1, 12),
        cluster(4, 'Obstacle', 2, 13), cluster(5, 'Obstacle', 2, 14),
      ]));
      await settle();
      const crops = [...el.querySelectorAll('.acs-crossing-card__crop')];
      expect(crops).toHaveLength(4);
      expect(crops.map((c) => c.dataset.clusterId)).toEqual(['1', '2', '3', '4']);
      expect(feed.label).not.toHaveBeenCalledWith(14);
      // A crop, the backup image where there is no crop, and the shared placeholder where there is neither.
      expect(crops[0].querySelector('.acs-crossing-card__image').getAttribute('src')).toBe('https://example.test/10.jpg');
      expect(crops[0].querySelector('.acs-crossing-card__icon').getAttribute('src')).toContain('NoCurbRamp_small.svg');
      expect(crops[0].title).toBe('cluster-effect type=no-curb-ramp value=−1.00');
      expect(crops[1].querySelector('.acs-crossing-card__image').getAttribute('src')).toBe('https://example.test/pano11.jpg');
      expect(crops[2].querySelector('.acs-crossing-card__image')).toBeNull();
      expect(crops[2].querySelector('.lmc__placeholder img').getAttribute('src')).toContain('CurbRamp_small.svg');
      expect(el.querySelector('.acs-crossing-card__more').textContent).toBe('panel-crossing-more count=1');
      // Nothing in a tooltip can be pressed.
      expect(el.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
      // A picture that fails to load gives way to the placeholder too.
      crops[0].querySelector('.acs-crossing-card__image').dispatchEvent(new Event('error'));
      expect(crops[0].querySelector('.lmc__placeholder')).not.toBeNull();
    });

  test('a label that arrives after the card has closed, or after another crossing opened, renders nothing', async () => {
    const card = makeCard();
    let release;
    feed.label = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    card.show(crossing([cluster(1, 'NoCurbRamp', 3, 10)]));
    card.close();
    release(labels[10]);
    await settle();
    expect(el.querySelectorAll('.acs-crossing-card__crop')).toHaveLength(0);
    // The next crossing's crops are its own.
    card.show(crossing([cluster(2, 'CurbRamp', 1, 11)]));
    const second = release;
    card.show(crossing([cluster(3, 'Obstacle', 2, 13)]));
    second(labels[11]);
    release(labels[13]);
    await settle();
    const crops = [...el.querySelectorAll('.acs-crossing-card__crop')];
    expect(crops.map((c) => c.dataset.clusterId)).toEqual(['3']);
  });
});
