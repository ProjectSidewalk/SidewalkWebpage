/**
 * Tests for frontend/js/report/ReportPage.js: when the maps exist. A browser has room for about 16 WebGL contexts and a
 * region can have fifty streets, so what's pinned is that the page never holds more than its budget, however the reader
 * scrolls, and that the sidebar's controls reach every section.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule, useUtil } from './loader.js';

mockModule('i18next', () => ({ default: { language: 'en', t: (key) => key } }));
mockModule('frontend/js/common/LabelMiniCard.js', () => ({ LabelMiniCard: { placeholder: () => {
  const el = document.createElement('div');
  el.className = 'test-placeholder';
  return el;
} } }));
useUtil({ misc: { getIconImagePaths: () => ({ iconImagePath: '/icon.svg' }), labelTypeName: (type) => type } });

const STREET_COUNT = 8;
const flush = () => new Promise((resolve) => { setTimeout(resolve); });
/** @param {object} grade - The config's `grade`. @returns {Function} `util.fetchJson`, answering the config only. */
const fetchJsonStub = (grade) => vi.fn(async () => ({ grade }));

describe('ReportPage', () => {
  let ReportPage;
  let observers;
  let maps;
  let deps;
  const data = () => ({
    regionId: 10,
    cityId: 'seattle',
    basemap: { tilesUrl: null, glyphsUrl: '' },
    edges: Array.from({ length: STREET_COUNT }, (_, i) => ({
      id: i, score: 0.5, explored: true, coordinates: [[-122.33, 47.6], [-122.32, 47.6]],
    })),
    streets: Array.from({ length: STREET_COUNT }, (_, i) => ({ id: 100 + i, score: 0.5, edgeIds: [i], cards: [] })),
    fixes: [{ labelId: 55, streetId: 100, edgeIds: [0], locations: [{ clusterId: 9, labelType: 'Obstacle', lat: 47.6, lng: -122.33 }] }],
  });

  /** @param {Element} target - Reports it as near the viewport or not to whichever observer watches it. */
  const intersect = (target, isIntersecting) => {
    for (const observer of observers) {
      if (observer.observed.includes(target)) observer.callback([{ target, isIntersecting }]);
    }
  };
  const live = () => maps.filter((m) => !m.destroy.mock.calls.length);

  beforeEach(async () => {
    observers = [];
    maps = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.observed = []; observers.push(this); }

      observe(el) { this.observed.push(el); }

      disconnect() { this.observed = []; }
    });
    document.body.innerHTML = `
      <ol><li class="report-rank__row" data-street="100"><a href="#street-100">A</a></li></ol>
      <div id="report-region-map"></div>
      ${Array.from({ length: STREET_COUNT }, (_, i) => `<li class="report-street" id="street-${100 + i}" data-street="${100 + i}">
        <div data-street-map></div><ul data-street-cards></ul><button data-street-more hidden></button></li>`).join('')}
      <li class="report-fix" data-label-id="55"><a data-fix-map></a><a data-fix-photo></a></li>
      <fieldset id="report-color-by" hidden>
        <input type="radio" name="c" id="report-color-score" value="score" checked>
        <input type="radio" name="c" id="report-color-slope" value="slope">
        <ul id="report-slope-legend" hidden></ul>
      </fieldset>
      <div id="report-map-controls" hidden>
        <input type="checkbox" id="report-sidewalks-toggle"><ul id="report-sidewalk-legend" hidden></ul>
      </div>`;
    ({ ReportPage } = await loadModules('frontend/js/report/ReportPage.js'));
    deps = {
      createMap: vi.fn((host, options) => {
        const map = {
          host,
          options,
          destroy: vi.fn(),
          lightStreet: vi.fn(),
          setSidewalks: vi.fn(),
          setSidewalksVisible: vi.fn(),
          colorBy: vi.fn(),
          snapshot: vi.fn(async () => 'data:image/png;base64,AAAA'),
        };
        maps.push(map);
        return map;
      }),
      fetchCards: vi.fn(async (ids) => new Map(ids.map((id) => [id, { label: { label_id: id } }]))),
      buildCard: vi.fn(() => ({ render: vi.fn(), refitTags: vi.fn(), loadImage: vi.fn(() => Promise.resolve(true)) })),
      log: vi.fn(),
    };
  });

  test('builds no map until its section nears the viewport', () => {
    new ReportPage(data(), deps).start();
    expect(deps.createMap).not.toHaveBeenCalled();
    intersect(document.querySelector('[data-street="100"].report-street'), true);
    expect(deps.createMap).toHaveBeenCalledTimes(1);
  });

  test('never holds more live maps than its budget, however many sections are near', () => {
    new ReportPage(data(), deps).start();
    for (const element of document.querySelectorAll('.report-street')) {
      intersect(element, true);
      expect(live().length).toBeLessThanOrEqual(ReportPage.MAX_LIVE_MAPS);
    }
    expect(live()).toHaveLength(ReportPage.MAX_LIVE_MAPS);
  });

  test('a section that went without a map gets one when another leaves, though it never moved itself', () => {
    new ReportPage(data(), deps).start();
    const elements = [...document.querySelectorAll('.report-street')];
    for (const element of elements) intersect(element, true);
    const before = maps.length;

    intersect(elements[0], false);
    expect(live()).toHaveLength(ReportPage.MAX_LIVE_MAPS);
    expect(maps).toHaveLength(before + 1);
  });

  test('gives its maps to the sections closest to the viewport, not the first to arrive', () => {
    const elements = [...document.querySelectorAll('.report-street')];
    elements.forEach((element, i) => {
      // The last section is on screen; the rest run away from it.
      const top = (elements.length - 1 - i) * 2000;
      element.getBoundingClientRect = () => ({ top, bottom: top + 100 });
    });
    new ReportPage(data(), deps).start();
    for (const element of elements) intersect(element, true);
    const lit = elements.filter((element) => {
      const host = element.querySelector('[data-street-map]');
      return live().some((map) => map.host === host);
    });
    expect(lit).toEqual(elements.slice(-ReportPage.MAX_LIVE_MAPS));
  });

  test('frees a map when its section leaves, and rebuilds it on return', () => {
    new ReportPage(data(), deps).start();
    const element = document.querySelector('.report-street');
    intersect(element, true);
    intersect(element, false);
    expect(live()).toHaveLength(0);
    intersect(element, true);
    expect(live()).toHaveLength(1);
    expect(maps).toHaveLength(2);
  });

  test('passes every map the city\'s basemap', () => {
    new ReportPage(data(), deps).start();
    intersect(document.querySelector('.report-street'), true);
    expect(maps[0].options.basemap).toEqual({ tilesUrl: null, glyphsUrl: '' });
  });

  test('links a list row and the region map, both ways', () => {
    new ReportPage(data(), deps).start();
    intersect(document.getElementById('report-region-map'), true);
    const row = document.querySelector('.report-rank__row');

    row.dispatchEvent(new MouseEvent('mouseenter'));
    expect(maps[0].lightStreet).toHaveBeenLastCalledWith(100);
    row.dispatchEvent(new MouseEvent('mouseleave'));
    expect(maps[0].lightStreet).toHaveBeenLastCalledWith(null);

    maps[0].options.onStreetHover(100);
    expect(row.classList.contains('is-highlighted')).toBe(true);
    maps[0].options.onStreetHover(null);
    expect(row.classList.contains('is-highlighted')).toBe(false);
  });

  test('clicking a segment on the region map shows its row, opening the fold it may be in; an unlisted one does nothing', () => {
    document.getElementById('report-region-map').insertAdjacentHTML('beforebegin',
      '<details><ol><li class="report-rank__row" data-street="300"><a href="/accessScore">Far</a></li></ol></details>');
    new ReportPage(data(), deps).start();
    intersect(document.getElementById('report-region-map'), true);
    const row = document.querySelector('[data-street="300"].report-rank__row');
    row.scrollIntoView = vi.fn();
    maps[0].options.onStreetClick(999);
    expect(deps.log).not.toHaveBeenCalledWith('Report_RegionMapClick');
    maps[0].options.onStreetClick(300);
    expect(row.closest('details').open).toBe(true);
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(maps[0].lightStreet).toHaveBeenLastCalledWith(300);
    expect(window.location.hash).not.toBe('#street-300');
  });

  test('sidewalks start off; the switch reaches every map and shows its key', () => {
    new ReportPage(data(), deps).start();
    intersect(document.querySelector('.report-street'), true);
    expect(maps[0].setSidewalksVisible).toHaveBeenLastCalledWith(false);
    const toggle = document.getElementById('report-sidewalks-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(maps[0].setSidewalksVisible).toHaveBeenLastCalledWith(true);
    expect(document.getElementById('report-sidewalk-legend').hidden).toBe(false);
    expect(deps.log).toHaveBeenCalledWith('Report_SidewalksToggle_Shown=true');
  });

  test('each side reaches the maps with its street, which is how it takes the street\'s color', async () => {
    useUtil({ fetchJson: vi.fn(async () => ({ features: [{
      geometry: { type: 'LineString', coordinates: [] },
      properties: { presence: 'present', street_side: 'left', street_edge_id: 3, label_count: 4 },
    }] })) });
    new ReportPage(data(), deps).start();
    intersect(document.getElementById('report-region-map'), true);
    await vi.waitFor(() => expect(maps[0].setSidewalks).toHaveBeenCalled());
    expect(maps[0].setSidewalks.mock.lastCall[0].features[0].properties)
      .toEqual({ presence: 'present', street_side: 'left', street_edge_id: 3 });
  });

  describe('coloring by slope', () => {
    const graded = () => {
      const d = data();
      d.edges[0].grade = 0.09;
      return d;
    };

    test('stays hidden, and asks for nothing, in a region with no grade', async () => {
      useUtil({ fetchJson: fetchJsonStub({ sources: ['x'], map_class_breaks: [0.05] }) });
      new ReportPage(data(), deps).start();
      await flush();
      expect(document.getElementById('report-color-by').hidden).toBe(true);
    });

    test('stays hidden where the city has no slope classes', async () => {
      useUtil({ fetchJson: fetchJsonStub({ sources: [], map_class_breaks: [] }) });
      new ReportPage(graded(), deps).start();
      await flush();
      expect(document.getElementById('report-color-by').hidden).toBe(true);
    });

    test('reaches the region map and every street map, and a map built later', async () => {
      useUtil({ fetchJson: fetchJsonStub({ sources: ['x'], map_class_breaks: [0.05, 0.083] }) });
      new ReportPage(graded(), deps).start();
      await flush();
      const group = document.getElementById('report-color-by');
      expect(group.hidden).toBe(false);
      intersect(document.getElementById('report-region-map'), true);
      const slope = document.getElementById('report-color-slope');
      slope.checked = true;
      slope.dispatchEvent(new Event('change', { bubbles: true }));
      expect(maps[0].colorBy).toHaveBeenLastCalledWith([0.05, 0.083]);
      expect(document.getElementById('report-slope-legend').hidden).toBe(false);
      expect(deps.log).toHaveBeenCalledWith('Report_ColorBy_Slope');

      intersect(document.querySelector('.report-street'), true);
      expect(maps[1].colorBy).toHaveBeenLastCalledWith([0.05, 0.083]);
    });
  });

  describe('weights', () => {
    const CONFIG = {
      scored_types: ['Obstacle'], presets: { default: { Obstacle: 1 } }, grade: { sources: [] },
      type_weights: { Obstacle: { base_weight: -1 } },
    };
    let fetchJson;
    const weighted = (types, custom = false) => ({
      ...data(), weights: { types, grade: 1, custom }, contributions: { Obstacle: -0.4 },
    });

    beforeEach(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="report-weights-control" hidden>
          <button id="acs-weights-toggle" aria-expanded="false"><img alt="" data-down-src="d" data-up-src="u"></button>
          <span id="acs-weights-summary"></span><button id="acs-reset" hidden></button>
          <div id="acs-weights" hidden></div><p id="acs-weights-flash"></p>
        </div>`);
      fetchJson = vi.fn(async (url) => (url.startsWith('/v3/api/accessScoreConfig') ? CONFIG : { features: [] }));
      useUtil({ fetchJson });
      deps.navigate = vi.fn();
      sessionStorage.clear();
    });

    test('appear with the config, folded, on the weights the server scored under', async () => {
      new ReportPage(weighted({ Obstacle: 1 }), deps).start();
      await flush();
      expect(document.getElementById('report-weights-control').hidden).toBe(false);
      expect(document.getElementById('acs-weights').hidden).toBe(true);
      expect(document.getElementById('acs-weight-Obstacle').value).toBe('1');
      expect(document.querySelector('.ps-weight__bar').classList.contains('ps-weight__bar--problem')).toBe(true);
    });

    test('a link\'s custom weights open the panel on them', async () => {
      new ReportPage(weighted({ Obstacle: 2 }, true), deps).start();
      await flush();
      expect(document.getElementById('acs-weights').hidden).toBe(false);
      expect(document.getElementById('acs-weight-Obstacle').value).toBe('2');
      expect(document.getElementById('acs-reset').hidden).toBe(false);
    });

    test('stay away if the config fails, leaving the report as it is', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchJson.mockRejectedValue(new Error('offline'));
      new ReportPage(weighted({ Obstacle: 1 }), deps).start();
      await flush();
      expect(document.getElementById('report-weights-control').hidden).toBe(true);
      warn.mockRestore();
    });

    test('a drag only moves the slider; letting go reopens the report under the new weights, and logs', async () => {
      window.history.replaceState(null, '', '/report/neighborhood/10#report-streets-title');
      new ReportPage(weighted({ Obstacle: 1 }), deps).start();
      await flush();
      const slider = document.getElementById('acs-weight-Obstacle');
      slider.value = '2';
      slider.dispatchEvent(new Event('input'));
      expect(deps.navigate).not.toHaveBeenCalled();
      slider.dispatchEvent(new Event('change'));
      expect(deps.log).toHaveBeenCalledWith('Report_Weight_Obstacle_value=2');
      const url = new URL(deps.navigate.mock.calls[0][0]);
      expect(url.pathname).toBe('/report/neighborhood/10');
      expect(url.searchParams.get('w')).toBe('Obstacle:2');
      expect(url.hash).toBe('#report-streets-title');
    });

    test('Reset reopens the report on the engine\'s own weights, with no weights in the link', async () => {
      window.history.replaceState(null, '', '/report/neighborhood/10?w=Obstacle:2');
      new ReportPage(weighted({ Obstacle: 2 }, true), deps).start();
      await flush();
      document.getElementById('acs-reset').click();
      expect(deps.log).toHaveBeenCalledWith('Report_Reset');
      const url = new URL(deps.navigate.mock.calls[0][0]);
      expect(url.searchParams.has('w')).toBe(false);
      expect(document.getElementById('acs-weight-Obstacle').value).toBe('1');
    });

    test('the reopened report scrolls back to where the reader was', () => {
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      sessionStorage.setItem('report:scrollY', '640');
      new ReportPage(weighted({ Obstacle: 1 }), deps).start();
      expect(scrollTo).toHaveBeenCalledWith(0, 640);
      expect(sessionStorage.getItem('report:scrollY')).toBeNull();
      scrollTo.mockRestore();
    });
  });

  test('printing fills the fixes\' panes, once, however many ask: photo, then the map as a still picture', async () => {
    const page = new ReportPage(data(), deps);
    page.start();
    deps.fetchCards.mockResolvedValue(new Map([[55, { thumbnailUrl: '/thumb/55.jpg' }]]));
    const done = Promise.all([page.prepareForPrint(), page.prepareForPrint()]);
    const photo = await vi.waitFor(() => {
      const img = document.querySelector('[data-fix-photo] img');
      if (!img) throw new Error('no photo yet');
      return img;
    });
    expect(photo.getAttribute('src')).toBe('/thumb/55.jpg');
    photo.dispatchEvent(new Event('load'));
    await done;
    expect(deps.fetchCards.mock.calls.filter(([ids]) => ids.includes(55))).toHaveLength(1);
    const still = maps.find((m) => m.options.still);
    expect(still.options.center).toEqual([-122.33, 47.6]);
    expect(still.options.focusEdgeIds).toEqual([0]);
    expect(still.destroy).toHaveBeenCalled();
    expect(document.querySelector('.report-fix__still').getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  test('a fix with no photo gets the Gallery\'s placeholder, and one whose map never settles keeps its sketch', async () => {
    deps.createMap.mockImplementation((host, options) => {
      const map = { host, options, destroy: vi.fn(), colorBy: vi.fn(), snapshot: vi.fn(async () => null) };
      maps.push(map);
      return map;
    });
    deps.fetchCards.mockResolvedValue(new Map());
    const page = new ReportPage(data(), deps);
    page.start();
    await page.loadFixes();
    expect(document.querySelector('[data-fix-photo] .test-placeholder')).not.toBeNull();
    expect(document.querySelector('.report-fix__still')).toBeNull();
    expect(document.querySelector('[data-fix-map] .report-map__sketch')).not.toBeNull();
    expect(document.querySelector('.report-fix__live')).toBeNull();
  });
});
