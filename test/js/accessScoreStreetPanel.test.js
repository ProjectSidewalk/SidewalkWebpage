/**
 * Tests for AccessScoreStreetPanel (frontend/js/access-score/AccessScoreStreetPanel.js, #5748): the panel that
 * says why a street scores what it does. It leads with the verdict and the three components, lists each type's
 * effect worst first with grade among them, draws one tile per cluster along the block and at each crossing from
 * the shared feed, caps a group at twelve until asked for all, lights rows and tiles both ways, re-reads its numbers
 * on a reweighting without refetching a picture, owns the map's right padding, and hands a reader's close to the
 * host.
 */

import {FIXTURE, RAMP, stubI18next, stubFetch, feature} from './support/accessScoreDockHarness.js';
import {loadModules} from './loader.js';

/** A flushed microtask queue, for the feed's fetch chains. */
const settle = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};

/** The panel's shell markup, with the ids the panel reads (mirrors app/views/apps/accessScore.scala.html). */
const PANEL_HTML = `
  <div id="acs-map-holder">
    <aside id="acs-panel" class="acs-panel" aria-labelledby="acs-panel-title" data-docs-url="/docs#scoring" hidden>
      <div class="acs-panel__head">
        <div class="acs-panel__titles">
          <h2 class="acs-panel__title" id="acs-panel-title" tabindex="-1"></h2>
          <p class="acs-panel__meta" id="acs-panel-meta"></p>
        </div>
        <button type="button" id="acs-panel-close" class="acs-panel__close" aria-label="Close"></button>
      </div>
      <div class="acs-panel__body" id="acs-panel-body"></div>
    </aside>
  </div>`;

describe('AccessScoreStreetPanel', () => {
  const REGION = {region_id: 1, name: 'Fixture', rate: 1, total_distance_m: 6100, completed_distance_m: 6100};
  let AccessScoreModel;
  let AccessScoreClusterFeed;
  let AccessScoreStreetPanel;
  let model;
  let map;
  let panel;
  let callbacks;
  let fetchMock;
  let root;

  /** The fixture street whose name says what is on it, by its 1-based id in the model. */
  const streetId = (name) => FIXTURE.streets.findIndex((c) => c.name === name) + 1;

  const cluster = (id, type, street, severity, labelIds, extra = {}) => ({
    label_cluster_id: id, label_type: type, street_edge_id: street, intersection_id: null, region_id: 1,
    median_severity: severity, cluster_size: labelIds.length, agree_count: 1, disagree_count: 0,
    label_ids: labelIds, tag_counts: {}, coordinates: [0, 0], ...extra,
  });
  const label = (id, type, severity = 2) => ({
    label_id: id, label_type: type, severity, tags: [], crop_url: `https://example.test/${id}.jpg`,
    crop_marker: {x: 0.5, y: 0.5}, backup_image_url: null, num_agree: 1, num_disagree: 0, num_unsure: 0,
    user_validation: null, from_current_user: false, timestamp: '2026-09-01T12:00:00Z',
  });

  beforeAll(async () => {
    stubI18next();
    RAMP.forEach((hex, i) => document.documentElement.style.setProperty(`--color-score-ramp-${i + 1}`, hex));
    ({AccessScoreModel, AccessScoreClusterFeed, AccessScoreStreetPanel} = await loadModules(
      'frontend/js/common/scoreRamp.js', 'frontend/js/common/LabelMiniCard.js',
      'frontend/js/access-score/AccessScoreModel.js', 'frontend/js/access-score/AccessScoreClusterFeed.js',
      'frontend/js/access-score/AccessScoreStreetPanel.js'));
  });

  beforeEach(() => {
    document.body.innerHTML = PANEL_HTML;
    root = document.getElementById('acs-panel');
    // jsdom lays nothing out; the panel reads its width for the map's padding.
    Object.defineProperty(root, 'offsetWidth', {value: 400, configurable: true});
    const streets = {type: 'FeatureCollection', features: FIXTURE.streets.map((c, i) => feature(c, i))};
    model = new AccessScoreModel(FIXTURE.config, streets, {type: 'FeatureCollection', features: []}, [REGION]);
    // The map's canvas is focusable, as Mapbox's is (tabindex 0): where focus goes when the panel closes under it.
    const canvas = document.createElement('div');
    canvas.id = 'acs-canvas';
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    map = {
      getPadding: () => ({left: 0, top: 0, right: 0, bottom: 0}),
      easeTo: vi.fn(),
      getContainer: () => ({clientWidth: 1000}),
      project: vi.fn(() => ({x: 100, y: 100})),
      getCanvas: () => canvas,
    };
    callbacks = {
      streetCenter: vi.fn(() => ({lng: -74, lat: 40.8})), onClose: vi.fn(), onOpenLabel: vi.fn(),
      onOpenSheet: vi.fn(), onHoverCluster: vi.fn(), log: vi.fn(),
    };
    const ramp = streetId('one good curb ramp');
    const many = streetId('mixed street');
    fetchMock = stubFetch({
      clustersByRegion: {
        1: [
          cluster(1, 'CurbRamp', ramp, 1, [11]),
          ...Array.from({length: 14}, (_, k) => cluster(100 + k, 'Obstacle', many, (k % 3) + 1, [200 + k])),
          cluster(300, 'Signal', many, null, [301, 302]),
        ],
      },
      labels: Object.fromEntries([
        [11, label(11, 'CurbRamp', 1)],
        ...Array.from({length: 14}, (_, k) => [200 + k, label(200 + k, 'Obstacle', (k % 3) + 1)]),
        [302, label(302, 'Signal', null)],
      ]),
    });
    panel = new AccessScoreStreetPanel(root, {
      model, config: FIXTURE.config, map, feed: new AccessScoreClusterFeed({types: FIXTURE.config.scored_types}),
      ...callbacks,
    });
  });

  const rows = () => [...root.querySelectorAll('.acs-row')];
  const tiles = (group) => [...root.querySelectorAll(`[data-acs-group="${group}"] .acs-tile`)];

  test('starts hidden and inert, and opens on a street with the verdict first and the map padded on the right', async () => {
    expect(root.hidden).toBe(true);
    expect(root.inert).toBe(true);
    const id = streetId('one good curb ramp');
    expect(panel.showStreet(id)).toBe(true);
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(panel.streetId).toBe(id);
    expect(document.activeElement).toBe(document.getElementById('acs-panel-title'));
    expect(document.getElementById('acs-panel-title').textContent).toBe(`popup-street id=${id}`);
    expect(document.getElementById('acs-panel-meta').textContent).toContain('length meters=100');
    const street = model.explainStreet(id);
    expect(root.querySelector('.acs-panel__score').textContent).toBe(`${(street.score * 100).toFixed(1)}/ 100`);
    // The sentence: the block helped most by its one good ramp, and with no scored crossing the street is the block.
    const sentence = root.querySelector('.acs-panel__sentence').textContent;
    expect(sentence).toContain('panel-verdict-block-good');
    expect(sentence).toContain('type=curb-ramp value=+0.75');
    expect(sentence).toContain('panel-verdict-crossings-none');
    expect(root.querySelector('.acs-panel__components')).not.toBeNull();
    expect(root.querySelectorAll('.acs-panel__dot--none')).toHaveLength(2);
    // One row for the one type with a cluster, nothing for grade on a street with no slope.
    expect(rows().map((r) => r.dataset.type)).toEqual(['CurbRamp']);
    expect(rows()[0].querySelector('.acs-row__effect').textContent).toBe('+0.75');
    expect(rows()[0].querySelector('.acs-row__effect').classList.contains('acs-row__effect--feature')).toBe(true);
    expect(root.querySelector('[data-acs-grade]').hidden).toBe(true);
    expect(callbacks.log).toHaveBeenCalledWith('Panel', 'open');
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({padding: expect.objectContaining({right: 400})}));
    expect(document.getElementById('acs-map-holder').style.getPropertyValue('--acs-panel-width')).toBe('400px');
    expect(root.querySelector('[data-acs-hop="ExploreHere"]').getAttribute('href')).toBe('/explore?lat=40.80000&lng=-74.00000');

    await settle();
    // The evidence: the block's one cluster, as a tile wearing its effect; no crossing groups on a dead-end fixture.
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({pathname: '/v3/api/labelClusters'}));
    expect(tiles('block')).toHaveLength(1);
    expect(tiles('start')).toHaveLength(0);
    expect(root.querySelector('[data-acs-group="start"]')).toBeNull();
    const tile = tiles('block')[0];
    expect(tile.dataset.clusterId).toBe('1');
    expect(tile.querySelector('.lmc__type').textContent).toBe('curb-ramp');
    expect(tile.querySelector('.acs-tile__effect').textContent).toBe('+0.75');
    expect(tile.querySelector('.acs-tile__size')).toBeNull();
    expect(root.querySelector('[data-acs-group="block"] .acs-group__caption').textContent)
      .toBe('panel-group-caption-block count=1');
    expect(root.querySelector('[data-acs-group="block"] .acs-group__score').textContent)
      .toBe((street.segmentScore * 100).toFixed(1));
  });

  test('a selection a link carried in moves no focus and logs nothing', () => {
    document.getElementById('acs-panel-close').focus();
    panel.showStreet(streetId('one good curb ramp'), {fromUrl: true});
    expect(document.activeElement).not.toBe(document.getElementById('acs-panel-title'));
    expect(callbacks.log).not.toHaveBeenCalled();
    expect(panel.showStreet(99999)).toBe(false);
  });

  test('a group shows twelve tiles worst first until asked for all, and a cluster of several labels opens the sheet',
    async () => {
      const id = streetId('mixed street');
      panel.showStreet(id);
      await settle();
      const shown = tiles('block');
      expect(shown).toHaveLength(12);
      // Worst first: the High obstacles lead, then the Medium ones.
      const severities = shown.map((t) => Number(t.querySelector('.lmc__rating')?.textContent.endsWith('high') ? 3
        : t.querySelector('.lmc__rating')?.textContent.endsWith('medium') ? 2 : 1));
      expect(severities).toEqual([...severities].sort((a, b) => b - a));
      const more = root.querySelector('[data-acs-group="block"] .acs-group__more');
      expect(more.hidden).toBe(false);
      expect(more.textContent).toBe('panel-all count=15');
      more.click();
      await settle();
      expect(tiles('block')).toHaveLength(15);
      expect(root.querySelector('[data-acs-group="block"] .acs-group__more').hidden).toBe(true);
      expect(callbacks.log).toHaveBeenCalledWith('PanelExpandGroup', 'block');
      // The Signal cluster of two labels is shown by its newest and carries the way to both.
      const signal = root.querySelector('.acs-tile[data-cluster-id="300"]');
      expect(signal.querySelector('.lmc').dataset.labelId).toBe('302');
      expect(signal.querySelector('.acs-tile__size').textContent).toBe('cluster-size count=2');
      signal.querySelector('.acs-tile__size').click();
      expect(callbacks.onOpenSheet).toHaveBeenCalledWith(expect.objectContaining({label_cluster_id: 300}),
        expect.stringContaining('cluster-effect'));
      expect(callbacks.log).toHaveBeenCalledWith('PanelSheet_labelClusterId', 300);
      // A picture opens the full card, paging over every tile on show.
      signal.querySelector('.lmc__open').click();
      expect(callbacks.onOpenLabel).toHaveBeenCalledWith(302, expect.arrayContaining([200, 302]));
      expect(callbacks.log).toHaveBeenCalledWith('PanelOpenLabel_labelId', 302);
    });

  test('rows and tiles light each other, and a tile\'s hover reaches the map', async () => {
    panel.showStreet(streetId('mixed street'));
    await settle();
    // Every tile on show, the unrated Signal cluster included (it ranks last, past the cap).
    root.querySelector('[data-acs-group="block"] .acs-group__more').click();
    await settle();
    const obstacleRow = rows().find((r) => r.dataset.type === 'Obstacle');
    obstacleRow.dispatchEvent(new Event('mouseenter'));
    expect(callbacks.log).toHaveBeenCalledWith('PanelRow', 'Obstacle');
    expect(tiles('block').filter((t) => t.classList.contains('is-dim')).map((t) => t.dataset.clusterId))
      .toEqual(['300']);
    obstacleRow.dispatchEvent(new Event('mouseleave'));
    expect(tiles('block').some((t) => t.classList.contains('is-dim'))).toBe(false);
    const tile = root.querySelector('.acs-tile[data-cluster-id="300"]');
    tile.dispatchEvent(new Event('mouseenter'));
    expect(callbacks.onHoverCluster).toHaveBeenCalledWith(expect.objectContaining({label_cluster_id: 300}));
    expect(callbacks.log).toHaveBeenCalledWith('PanelHoverCluster_labelClusterId', 300);
    expect(tile.classList.contains('is-on')).toBe(true);
    expect(rows().find((r) => r.dataset.type === 'Signal').classList.contains('is-on')).toBe(true);
    tile.dispatchEvent(new Event('mouseleave'));
    expect(callbacks.onHoverCluster).toHaveBeenLastCalledWith(null);
    expect(tile.classList.contains('is-on')).toBe(false);
    // From the map: the dot under the pointer marks its tile and row.
    panel.lightCluster(100);
    expect(root.querySelector('.acs-tile[data-cluster-id="100"]').classList.contains('is-on')).toBe(true);
    expect(rows().find((r) => r.dataset.type === 'Obstacle').classList.contains('is-on')).toBe(true);
    panel.lightCluster(null);
    expect(root.querySelector('.acs-tile.is-on')).toBeNull();
  });

  test('a reweighting re-reads every number and keeps the pictures; a vote elsewhere refreshes one card', async () => {
    panel.showStreet(streetId('one good curb ramp'));
    await settle();
    const before = fetchMock.mock.calls.length;
    // A weight is the whole magnitude a Good ramp earns, not a multiplier on the engine's 0.75.
    model.setState({weights: {...model.state.weights, CurbRamp: 2}});
    panel.refresh();
    expect(rows()[0].querySelector('.acs-row__effect').textContent).toBe('+2.00');
    expect(tiles('block')[0].querySelector('.acs-tile__effect').textContent).toBe('+2.00');
    expect(root.querySelector('.acs-panel__sentence').textContent).toContain('value=+2.00');
    expect(fetchMock.mock.calls.length).toBe(before);
    panel.refreshLabel({...label(11, 'CurbRamp', 1), num_agree: 7});
    expect(tiles('block')[0].querySelector('.lmc__vote--agree .lmc__vote-count').textContent).toBe('7');
  });

  test('Escape and the close button ask the host to deselect; close() clears and returns focus to the map', () => {
    panel.showStreet(streetId('one good curb ramp'));
    root.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(callbacks.onClose).toHaveBeenCalledWith('escape');
    expect(callbacks.log).toHaveBeenCalledWith('PanelClose', 'escape');
    document.getElementById('acs-panel-close').click();
    expect(callbacks.onClose).toHaveBeenCalledWith('button');
    // The host deselects, which comes back as close().
    map.easeTo.mockClear();
    panel.close();
    expect(root.hidden).toBe(true);
    expect(root.inert).toBe(true);
    expect(panel.open).toBe(false);
    expect(panel.streetId).toBeNull();
    expect(document.getElementById('acs-panel-body').innerHTML).toBe('');
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({padding: expect.objectContaining({right: 0})}));
    expect(document.getElementById('acs-map-holder').style.getPropertyValue('--acs-panel-width')).toBe('0px');
    expect(document.activeElement).toBe(document.getElementById('acs-canvas'));
    // Closed, a reader's close is nothing.
    callbacks.onClose.mockClear();
    root.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  test('an unaudited street has a verdict and no evidence; a place heads its nearest street\'s panel', async () => {
    const streets = {type: 'FeatureCollection', features: [feature(FIXTURE.streets[1], 0, {audit_count: 0})]};
    const unaudited = new AccessScoreModel(FIXTURE.config, streets, {type: 'FeatureCollection', features: []}, [REGION]);
    const quiet = new AccessScoreStreetPanel(root, {
      model: unaudited, config: FIXTURE.config, map,
      feed: new AccessScoreClusterFeed({types: FIXTURE.config.scored_types}), ...callbacks,
    });
    quiet.showStreet(1);
    expect(root.querySelector('.acs-panel__score').textContent).toBe('unaudited');
    expect(root.querySelector('.acs-panel__sentence').textContent).toBe('panel-verdict-unaudited');
    expect(root.querySelector('[data-acs-rows]').hidden).toBe(true);
    expect(root.querySelector('[data-acs-evidence]').hidden).toBe(true);

    const id = streetId('one good curb ramp');
    const place = {
      place_id: 4, name: 'Fixture High School', category: 'school', region_id: 1, nearest_street_edge_id: id,
      nearest_street_distance_m: 25.4, lngLat: {lng: -74.1, lat: 40.9},
    };
    panel.showPlace(place);
    await settle();
    expect(document.getElementById('acs-panel-title').textContent).toBe('Fixture High School');
    expect(document.getElementById('acs-panel-meta').textContent).toBe('place-school defaultValue=school · Fixture');
    expect(root.querySelector('.acs-panel__place-street').textContent)
      .toBe(`popup-nearest-street · popup-street id=${id} · popup-street-distance meters=25`);
    expect(root.querySelector('.acs-panel__score').textContent).toContain('/ 100');
    expect(tiles('block')).toHaveLength(1);
    // The hop opens at the place, not the street's midpoint.
    expect(root.querySelector('[data-acs-hop="ExploreHere"]').getAttribute('href')).toBe('/explore?lat=40.90000&lng=-74.10000');
    expect(panel.streetId).toBe(id);
    // No street in reach: the title and the line that says so, nothing to explain.
    panel.showPlace({...place, name: null, nearest_street_edge_id: null});
    expect(document.getElementById('acs-panel-title').textContent).toBe('place-school defaultValue=school');
    expect(root.querySelector('.acs-panel__place-street').textContent).toBe('popup-no-street-nearby');
    expect(root.querySelector('[data-acs-evidence]').hidden).toBe(true);
    expect(panel.streetId).toBeNull();
  });
});
