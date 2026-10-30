/**
 * The /v3/api-docs/streetGrade preview (#5840): streets colored by slope, where hovering previews a street's elevation
 * profile and clicking (or the picker under the map) pins it. The elevation chart is a stand-in.
 */

import { loadModules, mockModule } from './loader.js';
import {
  FakePopup, flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

/** Every chart drawn: the slot it went in and the options it was given. */
const charts = [];
mockModule('frontend/js/common/AccessScoreElevationProfile.js', async (importOriginal) => {
  const { AccessScoreElevationProfile: Real } = await importOriginal();
  return {
    AccessScoreElevationProfile: class {
      static canDraw = Real.canDraw;

      constructor(slot, profile, options) {
        slot.textContent = 'chart';
        charts.push({ slot, profile, options });
      }
    },
  };
});

const BREAKS = [0.05, 0.08];
const STREETS = '/v3/api/accessScoreStreets?inline=true&regionId=7';

function street(id, properties = {}) {
  return {
    type: 'Feature',
    properties: {
      street_edge_id: id, street_name: null, max_grade: null, mean_grade: null, grade_quality: null, ...properties,
    },
    geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0.002], [0.002, 0.004]] },
  };
}

/** A gentle named street, a steep unnamed one, and a bridge with no grade. */
function streets() {
  return {
    type: 'FeatureCollection',
    features: [
      street(1, { street_name: 'Main <St>', max_grade: 0.03, mean_grade: 0.01, grade_quality: 'measured' }),
      street(2, { max_grade: 0.12, mean_grade: 0.06, grade_quality: 'suspect' }),
      street(3, { grade_quality: 'structure' }),
    ],
  };
}

/** A street's /v3/api/streetGrade answer, with a profile the chart can draw. */
function profile(overrides = {}) {
  return {
    profile: { elevations_meters: [10, 14, 12], spacing_meters: 5 },
    stale: false, max_grade: 0.12, max_grade_from_meters: 0, max_grade_to_meters: 5,
    ...overrides,
  };
}

async function renderPreview(routes = {}) {
  document.body.innerHTML = '<div id="street-grade-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/regionWithMostLabels': regionFeature(),
    '/v3/api/accessScoreConfig': { grade: { map_class_breaks: BREAKS, sources: [] } },
    [STREETS]: streets(),
    '/v3/api/streetGrade?streetEdgeId=': profile(),
    ...routes,
  });
  const { StreetGradePreview } = await loadModules('frontend/js/api-docs/streetGradePreview.js');
  await StreetGradePreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, map: world.maps[0], container: document.getElementById('street-grade-preview') };
}

const profileFetches = (fetchStub) => fetchStub.mock.calls.map(([url]) => url).filter((u) => u.includes('streetGrade'));

/** Clicks a street to pin its popup, and waits for its profile to load. */
async function clickStreet(map, id, properties = streets().features[id - 1].properties) {
  map.fireOn('street-grade-lines', 'click', [{ id, properties }], { lng: 1, lat: 2 });
  await flush();
  return world.popups.at(-1);
}

const openPopup = () => world.popups.filter((p) => !p.removed).at(-1);

beforeEach(() => {
  resetWorld();
  charts.length = 0;
  stampColorTokens();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe("the busiest region's streets", () => {
  it('draws them, framed on them, in the backend-sourced slope classes, with a count', async () => {
    const { map, container } = await renderPreview();
    expect(container.querySelector('.loading-message')).toBeNull();
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.002, 0.004]]);
    expect(map.sources['street-grade-streets'].data.features).toHaveLength(3);
    expect(map.sources['street-grade-streets'].attribution).toBeUndefined();
    const color = map.layers['street-grade-lines'].paint['line-color'];
    expect(color[3].filter((v) => typeof v === 'number')).toEqual([0.05 + Number.EPSILON, 0.08 + Number.EPSILON]);
    expect(textOf(container.querySelector('.map-chip'))).toBe('3 streets');
  });

  it('lists the classes steepest first in the legend, then the streets with no grade', async () => {
    const { container } = await renderPreview();
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Steepest grade (max_grade)');
    expect([...legend.querySelectorAll('.map-legend-item')].map(textOf)).toEqual([
      'accessscore:grade-class-over {"from":"8%"}',
      'accessscore:grade-class-between {"from":"5%","to":"8%"}',
      'accessscore:grade-class-under {"to":"5%"}',
      'No grade (bridge, tunnel, or no data)',
    ]);
  });

  it("credits the city's elevation models, linking only those with an https page", async () => {
    const sources = [
      { credit: 'USGS <3DEP>', url: 'https://www.usgs.gov/3dep' },
      { credit: 'Local LiDAR', url: 'javascript:alert(1)' },
      { credit: 'Copernicus', url: null },
    ];
    const grade = { map_class_breaks: BREAKS, sources };
    const { map } = await renderPreview({ '/v3/api/accessScoreConfig': { grade } });
    expect(map.sources['street-grade-streets'].attribution).toBe(
      '<a href="https://www.usgs.gov/3dep" target="_blank" rel="noopener">USGS &lt;3DEP&gt;</a>'
      + ' | Local LiDAR | Copernicus');
  });

  it("says '1 street' for a region of one", async () => {
    const one = { type: 'FeatureCollection', features: [streets().features[0]] };
    const { container } = await renderPreview({ [STREETS]: one });
    expect(textOf(container.querySelector('.map-chip'))).toBe('1 street');
  });
});

describe('when there is nothing to grade', () => {
  it('says there are no streets in a city with none', async () => {
    const { map, container } = await renderPreview({ [STREETS]: { type: 'FeatureCollection' } });
    expect(map.options).toMatchObject({ center: [0, 0], zoom: 1 });
    expect(textOf(container.querySelector('.map-message[role="status"]'))).toBe('No streets found for this city.');
    expect(map.layers['street-grade-lines']).toBeUndefined();
  });

  it("says the grades haven't been loaded when the city has no slope classes, or no street has a grade", async () => {
    let { container } = await renderPreview({ '/v3/api/accessScoreConfig': {} });
    expect(textOf(container.querySelector('.map-message'))).toBe("This city's street grades have not been loaded yet.");

    resetWorld();
    ({ container } = await renderPreview({
      [STREETS]: { type: 'FeatureCollection', features: [streets().features[2]] },
    }));
    expect(textOf(container.querySelector('.map-message'))).toBe("This city's street grades have not been loaded yet.");
    expect(document.querySelector('.street-grade-picker')).toBeNull();
  });

  it('falls back to the whole city when the region lookup fails or finds nothing', async () => {
    for (const region of [{ status: 500 }, null]) {
      resetWorld();
      const { fetchStub } = await renderPreview({
        '/v3/api/regionWithMostLabels': region,
        '/v3/api/accessScoreStreets?inline=true': streets(),
      });
      expect(fetchStub.mock.calls.map(([u]) => u))
        .toContain('/v3/api/accessScoreStreets?inline=true&utm_source=apiDocs');
    }
  });

  it('shows an alert when the configuration or streets request fails', async () => {
    for (const routes of [{ '/v3/api/accessScoreConfig': { status: 500 } }, { [STREETS]: { status: 500 } }]) {
      resetWorld();
      const { container } = await renderPreview(routes);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(textOf(container)).toBe('Unable to load street grade data for the preview.');
    }
  });

  it('does nothing but report it when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { StreetGradePreview } = await loadModules('frontend/js/api-docs/streetGradePreview.js');
    await StreetGradePreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Street grade preview container not found.');
  });
});

describe("a pinned street's popup", () => {
  it("gives the street's grades, and draws its profile with the stretch that set its steepest grade", async () => {
    const { map } = await renderPreview();
    const popup = await clickStreet(map, 2);
    expect(popup.options).toMatchObject({ className: 'map-popup map-popup--profile', closeButton: true });
    expect(popup.lngLat).toEqual({ lng: 1, lat: 2 });
    expect(textOf(popup.element.querySelector('h4'))).toBe('Street 2');
    expect(popup.text()).toContain('Steepest: 12% Mean: 6%');
    expect(popup.text()).toContain("straight line between the street's two ends");
    expect(popup.text()).not.toContain('Click the street to pin');
    expect(charts).toHaveLength(1);
    expect(charts[0].slot.hasAttribute('aria-live')).toBe(false);
    expect(charts[0].options.breaks).toEqual(BREAKS);
    expect(charts[0].options.steepest).toEqual({ from: 0, to: 5, grade: 0.12 });
    expect(charts[0].options.label).toContain('"start":"accessscore:elevation {\\"meters\\":10');
  });

  it("brackets no stretch on a stale street, or one whose stretch the API didn't place", async () => {
    const { map } = await renderPreview({
      '/v3/api/streetGrade?streetEdgeId=1': profile({ stale: true }),
      '/v3/api/streetGrade?streetEdgeId=2': profile({ max_grade_to_meters: null }),
    });
    await clickStreet(map, 1);
    await clickStreet(map, 2);
    expect(charts.map((c) => c.options.steepest)).toEqual([null, null]);
  });

  it("names a named street, and fetches no profile for one that can't have one", async () => {
    const { map, fetchStub } = await renderPreview();
    expect(textOf((await clickStreet(map, 1)).element.querySelector('h4'))).toBe('Main <St> · Street 1');
    const bridge = await clickStreet(map, 3);
    expect(bridge.text()).toBe('Street 3 A bridge, tunnel, or covered way: an elevation model sees the ground under '
      + 'it, not its deck, so it has no grade.');
    expect(profileFetches(fetchStub)).toEqual(['/v3/api/streetGrade?streetEdgeId=1&utm_source=apiDocs']);
  });

  it.each([
    ['no_data', 'The elevation model has no data under this street.'],
    [null, 'This street has not been sampled yet.'],
  ])('explains a %s grade', async (quality, note) => {
    const { map } = await renderPreview();
    expect((await clickStreet(map, 3, { ...street(3).properties, grade_quality: quality })).text()).toContain(note);
  });

  it('says there is no profile to draw when the one returned has no shape', async () => {
    const { map } = await renderPreview({ '/v3/api/streetGrade?streetEdgeId=': profile({ profile: null }) });
    const popup = await clickStreet(map, 1);
    expect(textOf(popup.element.querySelector('.map-popup__profile'))).toBe('accessscore:profile-none');
    expect(charts).toHaveLength(0);
  });

  it('says the profile failed, and fetches it again the next time, when its request fails', async () => {
    let failing = true;
    const { map, fetchStub } = await renderPreview({
      '/v3/api/streetGrade?streetEdgeId=': () => (failing ? { status: 500 } : profile()),
    });
    const popup = await clickStreet(map, 1);
    expect(textOf(popup.element.querySelector('.map-popup__profile'))).toBe('accessscore:profile-failed');
    failing = false;
    await clickStreet(map, 1);
    expect(charts).toHaveLength(1);
    expect(profileFetches(fetchStub)).toHaveLength(2);
  });

  it("fetches a street's profile once, however often it is opened", async () => {
    const { map, fetchStub } = await renderPreview();
    await clickStreet(map, 1);
    await clickStreet(map, 1);
    expect(charts).toHaveLength(2);
    expect(profileFetches(fetchStub)).toHaveLength(1);
  });

  it('drops a profile that arrives after its popup was replaced', async () => {
    const { map } = await renderPreview();
    const routed = window.fetch;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.fetch = vi.fn(async (url) => {
      if (url.includes('streetEdgeId=1')) await gate;
      return routed(url);
    });
    map.fireOn('street-grade-lines', 'click', [{ id: 1, properties: streets().features[0].properties }]);
    const first = world.popups.at(-1);
    await clickStreet(map, 2);
    release();
    await flush();
    expect(charts.map((c) => c.slot)).toEqual([world.popups.at(-1).element.querySelector('.map-popup__profile')]);
    expect(textOf(first.element.querySelector('.map-popup__profile'))).toBe('accessscore:profile-loading');
  });

  it('pans a pinned popup into the frame by however far it overhangs', async () => {
    const { map } = await renderPreview();
    map.container.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 300 });
    const place = (box) => vi.spyOn(FakePopup.prototype, 'getElement').mockImplementation(function () {
      this.element.getBoundingClientRect = () => box;
      return this.element;
    });

    place({ left: 100, right: 200, top: 100, bottom: 200 });
    await clickStreet(map, 1);
    expect(map.panned).toEqual([]);

    place({ left: -20, right: 80, top: 250, bottom: 330 });
    await clickStreet(map, 2);
    expect(map.panned).toEqual([[-28, 38]]);

    window.matchMedia = vi.fn(() => ({ matches: true }));
    place({ left: 350, right: 450, top: -5, bottom: 50 });
    await clickStreet(map, 1);
    expect(map.panned.at(-1)).toEqual([58, -13]);
  });
});

describe('hovering the streets', () => {
  const hover = (map, id) => map.fireOn(
    'street-grade-lines', 'mousemove', [{ id, properties: streets().features[id - 1].properties }]);

  /** Renders on real timers so the page can finish loading, then switches to fake ones for the hover delay. */
  async function renderHoverable() {
    vi.useRealTimers();
    const rendered = await renderPreview();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return rendered;
  }

  it('previews a street after a short pause, with a hint to pin it, and closes it as the pointer leaves', async () => {
    const { map } = await renderHoverable();
    hover(map, 1);
    expect(world.popups).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    const popup = openPopup();
    expect(popup.options).toMatchObject({ closeButton: false, closeOnClick: false, focusAfterOpen: false });
    expect(popup.text()).toContain('Click the street to pin this popup.');

    map.fire('mouseleave', {}, 'street-grade-lines');
    expect(popup.removed).toBe(true);
  });

  it('fetches nothing for a street the pointer only crosses', async () => {
    const { map, fetchStub } = await renderHoverable();
    hover(map, 1);
    await vi.advanceTimersByTimeAsync(100);
    hover(map, 2);
    await vi.advanceTimersByTimeAsync(150);
    expect(profileFetches(fetchStub)).toEqual(['/v3/api/streetGrade?streetEdgeId=2&utm_source=apiDocs']);
  });

  it("doesn't reopen the street already shown, or open one for a move over nothing", async () => {
    const { map } = await renderHoverable();
    hover(map, 1);
    await vi.advanceTimersByTimeAsync(150);
    hover(map, 1);
    map.fireOn('street-grade-lines', 'mousemove', []);
    await vi.advanceTimersByTimeAsync(150);
    expect(world.popups).toHaveLength(1);
  });

  it('keeps a pinned popup open through further hovering and the pointer leaving, until it is closed', async () => {
    const { map } = await renderHoverable();
    map.fireOn('street-grade-lines', 'click', [{ id: 1, properties: streets().features[0].properties }]);
    const pinned = world.popups.at(-1);
    hover(map, 2);
    map.fire('mouseleave', {}, 'street-grade-lines');
    await vi.advanceTimersByTimeAsync(150);
    expect(world.popups).toEqual([pinned]);
    expect(pinned.removed).toBeFalsy();

    pinned.remove();
    hover(map, 2);
    await vi.advanceTimersByTimeAsync(150);
    expect(openPopup().text()).toContain('Click the street to pin');
  });

  it("ignores a replaced popup's late close, leaving the new pin in place", async () => {
    const { map } = await renderHoverable();
    map.fireOn('street-grade-lines', 'click', [{ id: 1, properties: streets().features[0].properties }]);
    const first = world.popups.at(-1);
    map.fireOn('street-grade-lines', 'click', [{ id: 2, properties: streets().features[1].properties }]);
    first.handlers.close();
    hover(map, 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(world.popups).toHaveLength(2);
  });

  it('ignores a click that lands on no street', async () => {
    const { map } = await renderHoverable();
    map.fireOn('street-grade-lines', 'click', []);
    expect(world.popups).toHaveLength(0);
  });
});

describe('the street picker', () => {
  it('lists the graded streets steepest first, naming an unnamed one as such', async () => {
    await renderPreview();
    const options = [...document.querySelectorAll('#street-grade-picker-select option')].map(textOf);
    expect(options).toEqual(['Steepest first…', 'Unnamed street · 12% (street 2)', 'Main <St> · 3% (street 1)']);
    // Outside the container, so an error message replacing the map doesn't wipe it.
    expect(document.getElementById('street-grade-preview').nextElementSibling.className).toBe('street-grade-picker');
  });

  it("pins the picked street's popup at its middle vertex, moving focus into it", async () => {
    await renderPreview();
    const select = document.getElementById('street-grade-picker-select');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await flush();
    const popup = world.popups.at(-1);
    expect(popup.lngLat).toEqual([0.001, 0.002]);
    expect(popup.options).toMatchObject({ closeButton: true, focusAfterOpen: true });
    expect(charts).toHaveLength(1);

    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(world.popups).toHaveLength(1);
  });
});
