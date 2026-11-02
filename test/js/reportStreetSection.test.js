/**
 * Tests for frontend/js/report/ReportStreetSection.js: the link between a street's map and its cards, which is what the
 * report is for. The map and the cards are injected, so what's pinned is the linking itself, in both directions, for
 * pointer and keyboard, and including a card that's still behind "Show more".
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule, useUtil } from './loader.js';

mockModule('i18next', () => ({
  default: { language: 'en', t: (key, options) => `${key}${options ? JSON.stringify(options) : ''}` },
}));
useUtil({ misc: { getIconImagePaths: () => ({ iconImagePath: '/icon.svg' }) } });

const EDGES = [
  { id: 1, wayId: 7, score: 0.4, explored: true, coordinates: [[-122.33, 47.6], [-122.32, 47.6]] },
  { id: 2, wayId: 8, score: 0.9, explored: true, coordinates: [[-122.32, 47.6], [-122.31, 47.6]] },
];

/**
 * @param {number} id - The cluster, which is also its label's id plus 100.
 * @param {string} [labelType]
 * @param {number} [costPoints]
 * @returns {object} What the page's data holds for a card.
 */
const cardData = (id, labelType = 'Obstacle', costPoints = 2) => ({
  clusterId: id, labelId: id + 100, labelType, severity: 3, lat: 47.6, lng: -122.325,
  labelIds: [id + 100], atCrossing: false, costPoints, poolSize: 1,
});

/** @returns {HTMLElement} A section as the template renders it. */
function sectionElement() {
  document.body.innerHTML = `<li class="report-street" data-street="7">
    <div data-street-map></div><ul data-street-cards></ul><button data-street-more hidden></button></li>`;
  return document.querySelector('.report-street');
}

/** @returns {object} A stand-in for ReportMap that records what it's told. */
function fakeMap() {
  return {
    lightLocation: vi.fn(),
    showViewpoint: vi.fn(),
    viewpointMinRadiusMeters: () => 10,
    setVisibleTypes: vi.fn(),
    setSidewalks: vi.fn(),
    setSidewalksVisible: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('ReportStreetSection', () => {
  let ReportStreetSection;
  let map;
  let mapOptions;
  let deps;

  /**
   * @param {object[]} cards
   * @returns {InstanceType<ReportStreetSection>} A section with its map up.
   */
  const build = (cards) => {
    const section = new ReportStreetSection(sectionElement(), { wayId: 7, score: 0.4, edgeIds: [1], cards }, deps);
    section.mountMap();
    return section;
  };
  const itemOf = (id) => document.querySelector(`.report-card[data-cluster-id="${id}"]`);

  beforeEach(async () => {
    ({ ReportStreetSection } = await loadModules('frontend/js/report/ReportStreetSection.js'));
    map = fakeMap();
    Element.prototype.scrollIntoView = vi.fn();
    deps = {
      edges: EDGES,
      cityId: 'seattle',
      createMap: vi.fn((_, options) => { mapOptions = options; return map; }),
      fetchCards: vi.fn(async (ids) => new Map(ids.map((id) => [id, {
        label: { label_id: id, camera_lat: 47.6, camera_lng: -122.33, heading: 90, lat: 47.6, lng: -122.325, zoom: 1 },
      }]))),
      buildCard: vi.fn(() => ({
        render: (host) => host.insertAdjacentHTML('beforeend', '<img class="static-gallery-image" alt="">'),
        refitTags: vi.fn(),
        loadImage: vi.fn(() => Promise.resolve(true)),
      })),
      sidewalks: vi.fn(() => Promise.resolve({ type: 'FeatureCollection', features: [] })),
      log: vi.fn(),
    };
  });

  test('draws the sketch from its own street only, before there is any map', () => {
    new ReportStreetSection(sectionElement(), { wayId: 7, score: 0.4, edgeIds: [1], cards: [cardData(1)] }, deps);
    const sketch = document.querySelector('[data-street-map] svg');
    expect(sketch.querySelectorAll('path')).toHaveLength(1);
    expect(deps.createMap).not.toHaveBeenCalled();
  });

  test('hovering a card lights its icon and shows where its photo was taken', async () => {
    const section = build([cardData(1)]);
    await section.loadCards();
    itemOf(1).dispatchEvent(new MouseEvent('mouseenter'));
    expect(itemOf(1).classList.contains('is-lit')).toBe(true);
    expect(map.lightLocation).toHaveBeenLastCalledWith(1);
    expect(map.showViewpoint.mock.lastCall[0].camera).toEqual([-122.33, 47.6]);

    itemOf(1).dispatchEvent(new MouseEvent('mouseleave'));
    expect(itemOf(1).classList.contains('is-lit')).toBe(false);
    expect(map.lightLocation).toHaveBeenLastCalledWith(null);
    expect(map.showViewpoint).toHaveBeenLastCalledWith(null);
  });

  test('hovering an icon lights its card', async () => {
    const section = build([cardData(1), cardData(2)]);
    await section.loadCards();
    mapOptions.onLocationHover(2);
    expect(itemOf(2).classList.contains('is-lit')).toBe(true);
    expect(itemOf(1).classList.contains('is-lit')).toBe(false);
    mapOptions.onLocationHover(null);
    expect(itemOf(2).classList.contains('is-lit')).toBe(false);
  });

  test('keyboard focus inside a card lights it as a pointer does', async () => {
    const section = build([cardData(1)]);
    await section.loadCards();
    itemOf(1).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(map.lightLocation).toHaveBeenLastCalledWith(1);
    itemOf(1).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(map.lightLocation).toHaveBeenLastCalledWith(null);
  });

  test('clicking an icon draws a card still behind "Show more", then scrolls to it and lights it', async () => {
    const cards = Array.from({ length: ReportStreetSection.PAGE_SIZE + 3 }, (_, i) => cardData(i + 1));
    const section = build(cards);
    await section.loadCards();
    const last = cards.at(-1).clusterId;
    expect(itemOf(last)).toBeNull();

    await mapOptions.onLocationClick(last);
    expect(itemOf(last).hidden).toBe(false);
    expect(itemOf(last).scrollIntoView).toHaveBeenCalled();
    expect(itemOf(last).classList.contains('is-lit')).toBe(true);
    expect(deps.log).toHaveBeenCalledWith('Report_MapLocationClick');
  });

  test('shows a page of cards and offers the rest', async () => {
    const cards = Array.from({ length: ReportStreetSection.PAGE_SIZE + 2 }, (_, i) => cardData(i + 1));
    const section = build(cards);
    await section.loadCards();
    const more = document.querySelector('[data-street-more]');
    expect(document.querySelectorAll('.report-card')).toHaveLength(ReportStreetSection.PAGE_SIZE);
    expect(more.hidden).toBe(false);
    expect(more.textContent).toContain('"count":2');

    more.click();
    await vi.waitFor(() => expect(document.querySelectorAll('.report-card')).toHaveLength(cards.length));
    await vi.waitFor(() => expect(more.hidden).toBe(true));
    expect(deps.log).toHaveBeenCalledWith('Report_ShowMoreCards');
  });

  test('two callers waiting on one card get one card', async () => {
    const section = build([cardData(1)]);
    await Promise.all([section.loadCards(), section.loadCards()]);
    expect(document.querySelectorAll('.report-card')).toHaveLength(1);
  });

  test('a label the server can no longer serve leaves no card and no error', async () => {
    deps.fetchCards.mockResolvedValue(new Map());
    const section = build([cardData(1)]);
    await section.loadCards();
    expect(itemOf(1)).toBeNull();
  });

  test('a failed fetch leaves the map and the section standing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    deps.fetchCards.mockRejectedValue(new Error('offline'));
    const section = build([cardData(1)]);
    await expect(section.loadCards()).resolves.toBeUndefined();
    expect(section.hasMap).toBe(true);
    consoleError.mockRestore();
  });

  test('the type filter reaches both the map and the cards', async () => {
    const section = build([cardData(1, 'Obstacle'), cardData(2, 'CurbRamp', 0)]);
    await section.loadCards();
    section.setVisibleTypes(new Set(['CurbRamp']));
    expect(map.setVisibleTypes).toHaveBeenLastCalledWith(new Set(['CurbRamp']));
    await vi.waitFor(() => expect(itemOf(1).hidden).toBe(true));
    expect(itemOf(2).hidden).toBe(false);
  });

  test('a rebuilt map gets the filter and the sidewalk switch as they now stand', () => {
    const section = build([cardData(1, 'Obstacle')]);
    section.setVisibleTypes(new Set());
    section.setSidewalksVisible(false);
    section.unmountMap();
    expect(map.destroy).toHaveBeenCalled();
    expect(section.hasMap).toBe(false);

    const second = fakeMap();
    deps.createMap.mockReturnValue(second);
    section.mountMap();
    expect(second.setVisibleTypes).toHaveBeenCalledWith(new Set());
    expect(second.setSidewalksVisible).toHaveBeenCalledWith(false);
  });

  test('sidewalks arriving after the map came down go nowhere', async () => {
    let answer;
    deps.sidewalks.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const section = build([cardData(1)]);
    section.unmountMap();
    answer({ type: 'FeatureCollection', features: [] });
    await new Promise((resolve) => setTimeout(resolve));
    expect(map.setSidewalks).not.toHaveBeenCalled();
  });

  test('states a cost only where it says something, and always how to reach the label without a pointer', async () => {
    const section = build([cardData(1, 'Obstacle', 2.5), cardData(2, 'CurbRamp', 0.2)]);
    await section.loadCards();
    expect(itemOf(1).querySelector('.report-card__cost').textContent).toContain('report:card.cost');
    expect(itemOf(2).querySelector('.report-card__cost')).toBeNull();
    const reference = itemOf(1).querySelector('a[data-report-event="Report_OpenLabel"]');
    expect(reference.textContent).toBe('seattle:101');
    expect(reference.getAttribute('href')).toBe('/label/101');
  });

  test('logs the link being found once per section, not every wander of the pointer', async () => {
    const section = build([cardData(1), cardData(2)]);
    await section.loadCards();
    mapOptions.onLocationHover(1);
    mapOptions.onLocationHover(2);
    mapOptions.onLocationHover(1);
    expect(deps.log.mock.calls.filter(([event]) => event === 'Report_LinkedHover')).toHaveLength(1);
  });
});
