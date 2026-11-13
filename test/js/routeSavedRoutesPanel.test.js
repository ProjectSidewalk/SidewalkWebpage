/**
 * Tests for the "Your saved routes" cards on RouteBuilder's intro panel (frontend/js/route-builder/SavedRoutesPanel.js,
 * #5840): signed-in users see their account's routes from the server, guests see the ones kept on their device, and
 * each card's buttons open, explore or share the right route.
 */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, flush, textOf } from './support/routeFetch.js';

const copyToClipboard = vi.fn();
mockModule('frontend/js/common/copyToClipboard.js', () => ({ copyToClipboard }));
mockModule('i18next', () => ({
  default: {
    t: (key, opts) => {
      if (!opts) return key;
      const args = Object.entries(opts).filter(([k]) => k !== 'interpolation').map(([k, v]) => `${k}=${v}`);
      return `${key}(${args.join(',')})`;
    },
  },
}));
const { SavedRoutesPanel } = await loadModules('frontend/js/route-builder/SavedRoutesPanel.js');

/** Builds the saved-routes section as routeBuilder.scala.html renders it. */
function renderPanel() {
  document.body.innerHTML = `
    <div id="saved-routes-panel" hidden>
      <ul id="saved-routes-list"></ul>
      <a id="saved-routes-dashboard-link" href="/dashboard#my-routes">routebuilder.view.in.dashboard</a>
    </div>`;
}

/**
 * One route as GET /userapi/routes sends it.
 * @param {number} id
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
const accountRoute = (id, overrides = {}) => ({
  route_id: id,
  name: `Route ${id}`,
  slug: `route-${id}`,
  description: null,
  region_name: 'Downtown',
  region_count: 1,
  distance_meters: 1000 + id,
  created_at: `2026-10-0${id}T12:00:00Z`,
  started_count: 3,
  completed_count: 1,
  thumbnail_url: null,
  ...overrides,
});

/**
 * Builds a panel wired the way RouteBuilder wires it.
 * @param {boolean} isSignedIn
 * @returns {{panel: object, onView: import('vitest').Mock}}
 */
function makePanel(isSignedIn) {
  const onView = vi.fn();
  const panel = new SavedRoutesPanel({
    isSignedIn,
    formatMeta: (distanceMeters, regionName) => `${distanceMeters} m · ${regionName}`,
    onView,
  });
  return { panel, onView };
}

const section = () => document.getElementById('saved-routes-panel');
const cards = () => [...document.querySelectorAll('.saved-route-card')];
const nameOf = (card) => card.querySelector('.saved-route-name').textContent;
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

/** Stops a clicked link from asking jsdom to navigate, which it can't. */
const blockNavigation = (e) => e.preventDefault();

describe('SavedRoutesPanel', () => {
  beforeEach(() => {
    renderPanel();
    localStorage.clear();
    copyToClipboard.mockClear();
    window.logWebpageActivity = vi.fn();
    document.addEventListener('click', blockNavigation);
  });

  afterEach(() => {
    document.removeEventListener('click', blockNavigation);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('signed-in users', () => {
    test('show their newest three account routes, and the dashboard link counts them all', async () => {
      routeFetch({ '/userapi/routes': [1, 4, 2, 3].map((id) => accountRoute(id)) });
      const { panel } = makePanel(true);

      panel.refresh();
      await flush();

      expect(section().hidden).toBe(false);
      expect(cards().map(nameOf)).toEqual(['Route 4', 'Route 3', 'Route 2']);
      expect(document.getElementById('saved-routes-dashboard-link').textContent).toBe('see-all-routes(count=4)');
    });

    test('a card shows the route\'s distance, region, description, thumbnail and how often it was walked', async () => {
      routeFetch({
        '/userapi/routes': [accountRoute(1, {
          description: 'Along the <b>water</b>',
          region_count: 3,
          thumbnail_url: '/routeThumbnail/1.png',
        })],
      });
      const { panel } = makePanel(true);

      panel.refresh();
      await flush();

      const [card] = cards();
      expect(card.querySelector('.saved-route-meta').textContent)
        .toBe('1001 m · region-and-more(region=Downtown,more=2)');
      const desc = card.querySelector('.saved-route-desc');
      expect(desc.hidden).toBe(false);
      expect(desc.textContent).toBe('Along the <b>water</b>');
      expect(desc.querySelector('b')).toBeNull();
      expect(card.querySelector('.saved-route-thumb').getAttribute('src')).toBe('/routeThumbnail/1.png');
      expect(textOf(card.querySelector('.saved-route-usage'))).toBe('route-usage(started=3,completed=1)');
      expect(card.querySelector('.saved-route-explore').getAttribute('href')).toBe('/explore?routeId=1');
    });

    test('a route name is shown as text, never as markup', async () => {
      routeFetch({ '/userapi/routes': [accountRoute(1, { name: '<img src=x onerror=alert(1)>' })] });
      const { panel } = makePanel(true);

      panel.refresh();
      await flush();

      expect(nameOf(cards()[0])).toBe('<img src=x onerror=alert(1)>');
      expect(document.querySelector('.saved-route-name img')).toBeNull();
    });

    test('a failed request hides the section', async () => {
      routeFetch({ '/userapi/routes': { status: 500, body: {} } });
      const { panel } = makePanel(true);
      section().hidden = false;

      panel.refresh();
      await flush();

      expect(section().hidden).toBe(true);
    });

    test('a network error hides the section', async () => {
      routeFetch({ '/userapi/routes': new TypeError('Failed to fetch') });
      const { panel } = makePanel(true);
      section().hidden = false;

      panel.refresh();
      await flush();

      expect(section().hidden).toBe(true);
    });

    test('a just-saved route is highlighted, and the one on the map stays marked across refreshes', async () => {
      routeFetch({ '/userapi/routes': [accountRoute(1), accountRoute(2)] });
      const { panel } = makePanel(true);
      panel.markActive(1);

      panel.refresh(2);
      await flush();

      const [newest, older] = cards();
      expect(newest.classList.contains('saved-route-card--new')).toBe(true);
      expect(older.classList.contains('saved-route-card--active')).toBe(true);

      panel.markActive(2);
      expect(newest.classList.contains('saved-route-card--active')).toBe(true);
      expect(older.classList.contains('saved-route-card--active')).toBe(false);
    });
  });

  describe('guests', () => {
    test('see the routes saved on this device, and nothing when there are none', () => {
      const { panel } = makePanel(false);

      panel.refresh();
      expect(section().hidden).toBe(true);

      panel.recordGuestRoute({ routeId: 7, name: 'Guest walk', regionName: 'Uptown', distanceMeters: 500 });
      panel.refresh();

      expect(section().hidden).toBe(false);
      expect(cards().map(nameOf)).toEqual(['Guest walk']);
      expect(cards()[0].querySelector('.saved-route-meta').textContent).toBe('500 m · Uptown');
      // Guest records carry no usage counts or description.
      expect(cards()[0].querySelector('.saved-route-usage')).toBeNull();
      expect(cards()[0].querySelector('.saved-route-desc').hidden).toBe(true);
    });

    test('saving a route again moves it to the top instead of listing it twice', () => {
      const { panel } = makePanel(false);
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
        panel.recordGuestRoute({ routeId: 1, name: 'First' });
        vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
        panel.recordGuestRoute({ routeId: 2, name: 'Second' });
        vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
        panel.recordGuestRoute({ routeId: 1, name: 'First, renamed' });
      } finally {
        vi.useRealTimers();
      }

      panel.refresh();

      expect(cards().map(nameOf)).toEqual(['First, renamed', 'Second']);
    });

    test('the device keeps only the newest twenty', () => {
      const { panel } = makePanel(false);

      for (let id = 1; id <= SavedRoutesPanel.MAX_GUEST_ROUTES + 1; id++) panel.recordGuestRoute({ routeId: id });

      const stored = JSON.parse(localStorage.getItem(SavedRoutesPanel.STORAGE_KEY));
      expect(stored).toHaveLength(SavedRoutesPanel.MAX_GUEST_ROUTES);
      expect(stored[0].routeId).toBe(SavedRoutesPanel.MAX_GUEST_ROUTES + 1);
    });

    test('a record with no distance or region shows an empty meta line, and undated ones sort last', () => {
      localStorage.setItem(SavedRoutesPanel.STORAGE_KEY, JSON.stringify([
        { routeId: 1, name: 'Undated' },
        { routeId: 2, name: 'Dated', regionName: 'Uptown', savedAt: '2026-10-01T00:00:00Z' },
        { routeId: 3, name: 'Also undated' },
      ]));
      const { panel } = makePanel(false);

      panel.refresh();

      expect(cards().map(nameOf)).toEqual(['Dated', 'Undated', 'Also undated']);
      expect(cards()[0].querySelector('.saved-route-meta').textContent).toBe('Uptown');
      expect(cards()[1].querySelector('.saved-route-meta').textContent).toBe('');
    });

    test.each([
      ['not a list', JSON.stringify({ routeId: 1 })],
      ['corrupted', '{not json'],
    ])('a stored list that is %s shows nothing', (_what, raw) => {
      localStorage.setItem(SavedRoutesPanel.STORAGE_KEY, raw);
      const { panel } = makePanel(false);

      panel.refresh();

      expect(section().hidden).toBe(true);
    });

    test('blocked storage neither breaks saving nor showing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { panel } = makePanel(false);

      expect(() => panel.recordGuestRoute({ routeId: 1, name: 'x' })).not.toThrow();
      panel.refresh();

      expect(section().hidden).toBe(true);
    });
  });

  describe('card buttons', () => {
    beforeEach(() => {
      localStorage.setItem(SavedRoutesPanel.STORAGE_KEY, JSON.stringify([
        { routeId: 5, name: 'With slug', slug: 'with-slug', savedAt: '2026-10-02T00:00:00Z' },
        { routeId: 6, name: 'Old record', savedAt: '2026-10-01T00:00:00Z' },
      ]));
    });

    test('clicking a card opens that route in the editor', () => {
      const { panel, onView } = makePanel(false);
      panel.refresh();

      click(document.querySelector('.saved-route-view[data-route-id="6"]'));

      expect(onView).toHaveBeenCalledWith(6);
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SavedRoute_Edit_RouteId=6');
    });

    test('Explore is logged on its way to the route', () => {
      const { panel } = makePanel(false);
      panel.refresh();

      click(document.querySelector('.saved-route-explore[data-route-id="5"]'));

      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SavedRoute_Explore_RouteId=5');
    });

    test('copy link shares the short /r/ link, or the routeId link for a record from before slugs', () => {
      const { panel } = makePanel(false);
      panel.refresh();
      const [withSlug, old] = [5, 6].map((id) => document.querySelector(`.saved-route-copy[data-route-id="${id}"]`));

      click(withSlug);
      click(old);

      expect(copyToClipboard.mock.calls).toEqual([
        [withSlug, `${window.location.origin}/r/with-slug`],
        [old, `${window.location.origin}/explore?routeId=6`],
      ]);
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SavedRoute_Copy_RouteId=5');
    });
  });

  test('a page without the section does nothing', () => {
    document.body.innerHTML = '';
    const stub = routeFetch({});
    const { panel } = makePanel(true);

    panel.refresh();
    panel.markActive(1);

    expect(stub).not.toHaveBeenCalled();
  });

  test('the region label names just the one region when the route stays in it', () => {
    expect(SavedRoutesPanel.regionLabel('Downtown')).toBe('Downtown');
    expect(SavedRoutesPanel.regionLabel('Downtown', 2)).toBe('region-and-more(region=Downtown,more=1)');
  });
});
