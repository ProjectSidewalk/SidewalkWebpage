/**
 * Tests for frontend/js/report/ReportPage.js: when the maps exist. A browser has room for about 16 WebGL contexts and a
 * region can have fifty streets, so what's pinned is that the page never holds more than its budget, however the reader
 * scrolls, and that the sidebar's controls reach every section.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule, useUtil } from './loader.js';

mockModule('i18next', () => ({ default: { language: 'en', t: (key) => key } }));
useUtil({ misc: { getIconImagePaths: () => ({ iconImagePath: '/icon.svg' }) } });

const STREET_COUNT = 8;

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
      id: i, wayId: 100 + i, score: 0.5, explored: true, coordinates: [[-122.33, 47.6], [-122.32, 47.6]],
    })),
    streets: Array.from({ length: STREET_COUNT }, (_, i) => ({ wayId: 100 + i, score: 0.5, edgeIds: [i], cards: [] })),
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
      ${Array.from({ length: STREET_COUNT }, (_, i) => `<li class="report-street" data-street="${100 + i}">
        <div data-street-map></div><ul data-street-cards></ul><button data-street-more hidden></button></li>`).join('')}
      <div class="report-card-slot" data-label-id="55"></div>
      <div id="report-type-filter" hidden>
        <button class="report-chip" aria-pressed="true" data-label-type="Obstacle"></button>
        <button class="report-chip" aria-pressed="true" data-label-type="CurbRamp"></button>
      </div>
      <div id="report-map-controls" hidden>
        <input type="checkbox" id="report-sidewalks-toggle" checked><ul id="report-sidewalk-legend"></ul>
      </div>`;
    ({ ReportPage } = await loadModules('frontend/js/report/ReportPage.js'));
    deps = {
      createMap: vi.fn((host, options) => {
        const map = {
          host,
          options,
          destroy: vi.fn(),
          lightStreet: vi.fn(),
          setVisibleTypes: vi.fn(),
          setSidewalks: vi.fn(),
          setSidewalksVisible: vi.fn(),
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

  test('clicking a street on the region map jumps to its section; an unranked street goes nowhere', () => {
    new ReportPage(data(), deps).start();
    intersect(document.getElementById('report-region-map'), true);
    maps[0].options.onStreetClick(999);
    expect(window.location.hash).not.toBe('#street-999');
    maps[0].options.onStreetClick(100);
    expect(window.location.hash).toBe('#street-100');
  });

  test('reveals the sidebar controls, whose chips filter every live map', () => {
    new ReportPage(data(), deps).start();
    expect(document.getElementById('report-type-filter').hidden).toBe(false);
    intersect(document.querySelector('.report-street'), true);

    document.querySelector('[data-label-type="Obstacle"]').click();
    expect(maps[0].setVisibleTypes).toHaveBeenLastCalledWith(new Set(['CurbRamp']));
    expect(deps.log).toHaveBeenCalledWith('Report_FilterType_Type=Obstacle_Shown=false');
  });

  test('the sidewalk switch reaches every map and folds the legend away', () => {
    new ReportPage(data(), deps).start();
    intersect(document.querySelector('.report-street'), true);
    const toggle = document.getElementById('report-sidewalks-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(maps[0].setSidewalksVisible).toHaveBeenLastCalledWith(false);
    expect(document.getElementById('report-sidewalk-legend').hidden).toBe(true);
    expect(deps.log).toHaveBeenCalledWith('Report_SidewalksToggle_Shown=false');
  });

  test('printing draws the fixes\' cards, once, however many ask', async () => {
    const page = new ReportPage(data(), deps);
    page.start();
    await Promise.all([page.prepareForPrint(), page.prepareForPrint()]);
    expect(deps.fetchCards.mock.calls.filter(([ids]) => ids.includes(55))).toHaveLength(1);
    expect(deps.buildCard).toHaveBeenCalledTimes(1);
  });
});
