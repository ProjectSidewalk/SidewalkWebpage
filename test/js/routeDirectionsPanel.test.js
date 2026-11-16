/**
 * Tests for RouteBuilder's Start/End address fields (frontend/js/route-builder/DirectionsPanel.js, #5840): picking an
 * address plants the route's start or end, Enter takes the top suggestion, and the fields follow the route's ends by
 * reverse geocoding without overwriting what the user typed or letting a slow lookup write a stale name. The Mapbox
 * search box is a double; reverse geocoding answers from a fake `fetch` the test resolves by hand.
 */

import { loadModules, mockModule } from './loader.js';
import { flush } from './support/routeFetch.js';

/** A MapboxSearchBox double: onAdd hands back a field wired to a suggestion list, as the library's does. */
class FakeSearchBox extends EventTarget {
  static instances = [];

  /**
   * @param {object} map - The map the box is added to.
   * @returns {HTMLElement} The box's element, holding its input.
   */
  onAdd(map) {
    this.map = map;
    const n = FakeSearchBox.instances.push(this);
    const el = document.createElement('div');
    el.innerHTML = `<input role="combobox" aria-controls="listbox-${n}">`;
    return el;
  }
}

mockModule('@mapbox/search-js-web', () => ({ MapboxSearchBox: FakeSearchBox }));
mockModule('i18next', () => ({ default: { t: (key) => key } }));
const { DirectionsPanel } = await loadModules('frontend/js/route-builder/DirectionsPanel.js');

const START = [-122.3300, 47.6000];
const END = [-122.3200, 47.6100];
/** About 11 m north of a point: under the distance that's worth a new lookup. */
const nudge = ([lng, lat]) => [lng, lat + 0.0001];
/** About 55 m north of a point: worth a new lookup, but still near a typed address. */
const shift = ([lng, lat]) => [lng, lat + 0.0005];
/** About 220 m north of a point: well away from a typed address. */
const move = ([lng, lat]) => [lng, lat + 0.002];

/**
 * A reverse-geocoding answer in the Mapbox v6 format.
 * @param {Record<string, any>} [properties]
 * @returns {{features: Array<object>}}
 */
const geocoded = (properties) => ({ features: properties ? [{ properties }] : [] });

/** Lookups sent so far, each answered (or failed) by the test. */
let lookups;

/** Stubs `fetch` so each reverse geocode waits until the test answers it. */
function stubGeocoder() {
  lookups = [];
  vi.stubGlobal('fetch', vi.fn((url) => new Promise((resolve, reject) => {
    const params = new URL(url).searchParams;
    lookups.push({
      url,
      lng: Number(params.get('longitude')),
      lat: Number(params.get('latitude')),
      answer: (body) => resolve({ json: async () => body }),
      fail: () => reject(new TypeError('Failed to fetch')),
    });
  })));
}

/** The capture-phase keydown handler each slot was given, so a test can hand it a trusted Enter. */
let keydownHandlers;

/**
 * Builds the panel's markup as routeBuilder.scala.html renders it, and records each slot's keydown handler: jsdom
 * marks every dispatched event untrusted, and the panel acts only on a real key press.
 */
function renderPanel() {
  document.body.innerHTML = `
    <div id="directions-start-slot"></div>
    <div id="directions-end-row" hidden><div id="directions-end-slot"></div></div>
    <ul id="listbox-1"></ul><ul id="listbox-2"></ul>
    <button id="elsewhere"></button>`;
  keydownHandlers = {};
  for (const which of ['start', 'end']) {
    const slot = document.getElementById(`directions-${which}-slot`);
    const add = slot.addEventListener.bind(slot);
    slot.addEventListener = (type, fn, options) => {
      if (type === 'keydown') keydownHandlers[which] = fn;
      add(type, fn, options);
    };
  }
}

/**
 * Builds a panel wired the way RouteBuilder wires it.
 * @returns {{panel: object, onSetStart: import('vitest').Mock, onSetEnd: import('vitest').Mock}}
 */
function makePanel() {
  const onSetStart = vi.fn();
  const onSetEnd = vi.fn();
  const panel = new DirectionsPanel({
    map: { id: 'map' },
    mapboxApiKey: 'pk.test',
    bbox: [[-122.4, 47.5], [-122.2, 47.7]],
    onSetStart,
    onSetEnd,
  });
  return { panel, onSetStart, onSetEnd };
}

const input = (which) => document.querySelector(`#directions-${which}-slot input`);
const box = (which) => FakeSearchBox.instances[which === 'start' ? 0 : 1];
const listbox = (which) => document.getElementById(which === 'start' ? 'listbox-1' : 'listbox-2');

/**
 * Picks a search result in a field, as the library reports it.
 * @param {string} which - 'start' or 'end'.
 * @param {Array<number>} coord - [lng, lat].
 * @param {Record<string, any>} [properties]
 */
const pick = (which, coord, properties = {}) => box(which).dispatchEvent(new CustomEvent('retrieve', {
  detail: { features: [{ geometry: { coordinates: coord }, properties }] },
}));

/**
 * Presses a key in a field the way a user does (a trusted event).
 * @param {string} which - 'start' or 'end'.
 * @param {string} [key='Enter']
 * @returns {{preventDefault: import('vitest').Mock, stopPropagation: import('vitest').Mock}} The event, to check
 *   whether the panel took it over from the library.
 */
function press(which, key = 'Enter') {
  const event = { key, isTrusted: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  keydownHandlers[which](event);
  return event;
}

/**
 * Records the keys the library would see on a field's input.
 * @param {string} which - 'start' or 'end'.
 * @returns {Array<string>} Filled in as keys arrive.
 */
function keysSeenBy(which) {
  const keys = [];
  input(which).addEventListener('keydown', (e) => keys.push(e.key));
  return keys;
}

describe('DirectionsPanel', () => {
  beforeEach(() => {
    FakeSearchBox.instances = [];
    window.logWebpageActivity = vi.fn();
    renderPanel();
    stubGeocoder();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sets up a search box in each slot, limited to the city and in the page language', () => {
    makePanel();

    expect(box('start').accessToken).toBe('pk.test');
    expect(box('start').options).toEqual({
      bbox: [[-122.4, 47.5], [-122.2, 47.7]],
      language: 'common:mapbox-language-code',
    });
    expect(box('start').placeholder).toBe('directions-start-placeholder');
    expect(box('end').placeholder).toBe('directions-end-placeholder');
    expect(input('start').getAttribute('aria-expanded')).toBe('false');
    expect(input('end')).not.toBeNull();
  });

  describe('picking an address', () => {
    test('a Start address starts the route there, and an End address extends it', () => {
      const { onSetStart, onSetEnd } = makePanel();

      pick('start', START);
      pick('end', END);

      expect(onSetStart).toHaveBeenCalledWith({ lng: START[0], lat: START[1] });
      expect(onSetEnd).toHaveBeenCalledWith({ lng: END[0], lat: END[1] });
      expect(window.logWebpageActivity.mock.calls).toEqual([
        ['RouteBuilder_Click=SetStartAddress'], ['RouteBuilder_Click=SetEndAddress'],
      ]);
    });

    test('a result without a location does nothing', () => {
      const { onSetStart } = makePanel();

      box('start').dispatchEvent(new CustomEvent('retrieve', { detail: { features: [] } }));
      box('start').dispatchEvent(new CustomEvent('retrieve'));

      expect(onSetStart).not.toHaveBeenCalled();
      expect(window.logWebpageActivity).not.toHaveBeenCalled();
    });

    test('the picked addresses name the route\'s end streets', () => {
      const { panel } = makePanel();

      pick('start', START, { feature_type: 'address', name: '100 Pine St', context: { street: { name: 'Pine St' } } });
      pick('end', END, { feature_type: 'street', name: 'Oak Avenue', name_preferred: 'Oak Ave' });

      expect(panel.getEndpointStreetNames()).toEqual({ start: 'Pine St', end: 'Oak Ave' });
    });

    test('a street result without a preferred name uses its plain name, and a place gives none', () => {
      const { panel } = makePanel();

      pick('start', START, { feature_type: 'street', name: 'Oak Avenue' });
      pick('end', END, { feature_type: 'poi', name: 'City Hall' });

      expect(panel.getEndpointStreetNames()).toEqual({ start: 'Oak Avenue', end: null });
    });

    test('a result with no properties gives no street name', () => {
      const { panel } = makePanel();

      box('start').dispatchEvent(new CustomEvent('retrieve', {
        detail: { features: [{ geometry: { coordinates: START } }] },
      }));

      expect(panel.getEndpointStreetNames().start).toBeNull();
    });
  });

  describe('Enter takes the top suggestion', () => {
    test('with suggestions showing, Enter is replayed as ArrowDown + Enter', () => {
      makePanel();
      input('start').value = '100 Pine';
      listbox('start').innerHTML = '<li role="option">100 Pine St</li>';
      const keys = keysSeenBy('start');

      const event = press('start');

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(keys).toEqual(['ArrowDown', 'Enter']);
    });

    test('an Enter before the suggestions arrive is honored when they do, once', () => {
      makePanel();
      input('end').value = '100 Pine';
      const keys = keysSeenBy('end');

      press('end');
      expect(keys).toEqual([]);
      box('end').dispatchEvent(new Event('suggest'));
      box('end').dispatchEvent(new Event('suggest'));

      expect(keys).toEqual(['ArrowDown', 'Enter']);
    });

    test('a field whose suggestion list is unnamed waits for suggestions too', () => {
      makePanel();
      input('start').value = '100 Pine';
      input('start').removeAttribute('aria-controls');
      const keys = keysSeenBy('start');

      expect(press('start').preventDefault).toHaveBeenCalled();
      box('start').dispatchEvent(new Event('suggest'));

      expect(keys).toEqual(['ArrowDown', 'Enter']);
    });

    test('clearing the field drops a waiting Enter', () => {
      makePanel();
      input('start').value = '100 Pine';
      const keys = keysSeenBy('start');

      press('start');
      box('start').dispatchEvent(new Event('clear'));
      box('start').dispatchEvent(new Event('suggest'));

      expect(keys).toEqual([]);
    });

    test('leaving the field drops a waiting Enter, but moving within it does not', () => {
      makePanel();
      input('start').value = '100 Pine';
      const keys = keysSeenBy('start');
      const slot = document.getElementById('directions-start-slot');
      const inner = document.createElement('button');
      slot.append(inner);

      press('start');
      input('start').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: inner }));
      box('start').dispatchEvent(new Event('suggest'));
      expect(keys).toEqual(['ArrowDown', 'Enter']);

      keys.length = 0;
      press('start');
      input('start').dispatchEvent(new FocusEvent('focusout', {
        bubbles: true, relatedTarget: document.getElementById('elsewhere'),
      }));
      box('start').dispatchEvent(new Event('suggest'));
      expect(keys).toEqual([]);
    });

    test('a suggestion the user arrowed to is left for the library to take', () => {
      makePanel();
      input('start').value = '100 Pine';
      listbox('start').innerHTML = '<li role="option" aria-selected="true">100 Pine St</li>';
      const keys = keysSeenBy('start');

      expect(press('start').preventDefault).not.toHaveBeenCalled();
      expect(keys).toEqual([]);
    });

    test.each([
      ['an empty field', 'Enter', '   '],
      ['any other key', 'a', '100 Pine'],
    ])('%s is left to the library', (_what, key, value) => {
      makePanel();
      input('start').value = value;

      expect(press('start', key).preventDefault).not.toHaveBeenCalled();
    });

    test('a field whose input has gone is left alone', () => {
      makePanel();
      const keys = keysSeenBy('start');
      input('start').value = '100 Pine';
      press('start');
      input('start').remove();

      expect(press('start').preventDefault).not.toHaveBeenCalled();
      box('start').dispatchEvent(new Event('suggest'));
      expect(keys).toEqual([]);
    });
  });

  describe('following the route', () => {
    test('fills each field with the nearest address name and street', async () => {
      const { panel } = makePanel();

      panel.updateFromRoute(START, END);
      expect(lookups.map(({ lng, lat }) => [lng, lat])).toEqual([START, END]);
      const params = new URL(lookups[0].url).searchParams;
      expect(params.get('types')).toBe('address,street');
      expect(params.get('access_token')).toBe('pk.test');
      lookups[0].answer(geocoded({ name: '100 Pine St', context: { street: { name: 'Pine St' } } }));
      lookups[1].answer(geocoded({ feature_type: 'street', name: 'Oak Ave' }));
      await flush();

      expect(input('start').value).toBe('100 Pine St');
      expect(input('end').value).toBe('Oak Ave');
      expect(panel.getEndpointStreetNames()).toEqual({ start: 'Pine St', end: 'Oak Ave' });
    });

    test('the field prefers the preferred name, then the plain name, then the full address', async () => {
      const { panel } = makePanel();

      panel.updateFromRoute(START, END);
      lookups[0].answer(geocoded({ name_preferred: 'Pine', name: 'Pine Street' }));
      lookups[1].answer(geocoded({ full_address: '1 Oak Ave, Seattle' }));
      await flush();

      expect(input('start').value).toBe('Pine');
      expect(input('end').value).toBe('1 Oak Ave, Seattle');
    });

    test('a spot with no address leaves the field as it was', async () => {
      const { panel } = makePanel();
      input('start').value = 'before';

      panel.updateStart(START);
      lookups[0].answer(geocoded());
      await flush();

      expect(input('start').value).toBe('before');
      expect(panel.getEndpointStreetNames().start).toBeNull();
    });

    test('an end that barely moved is not looked up again', () => {
      const { panel } = makePanel();

      panel.updateStart(START);
      panel.updateStart(nudge(START));
      expect(lookups).toHaveLength(1);

      panel.updateStart(shift(START));
      expect(lookups).toHaveLength(2);
    });

    test('a typed address stays while the route\'s end snaps nearby, and gives way once it moves off', () => {
      const { panel } = makePanel();
      pick('start', START, { context: { street: { name: 'Pine St' } } });

      panel.updateStart(shift(START));
      expect(lookups).toHaveLength(0);
      expect(panel.getEndpointStreetNames().start).toBe('Pine St');

      panel.updateStart(move(START));
      expect(lookups).toHaveLength(1);
      expect(panel.getEndpointStreetNames().start).toBeNull();
    });

    test('a field the user is typing in is not overwritten', () => {
      const { panel } = makePanel();
      input('start').focus();

      panel.updateStart(START);

      expect(lookups).toHaveLength(0);
    });

    test('only the newest lookup may write, however the answers arrive', async () => {
      const { panel } = makePanel();

      panel.updateStart(START);
      panel.updateStart(move(START));
      lookups[1].answer(geocoded({ name: 'New St', context: { street: { name: 'New St' } } }));
      await flush();
      lookups[0].answer(geocoded({ name: 'Old St', context: { street: { name: 'Old St' } } }));
      await flush();

      expect(input('start').value).toBe('New St');
      expect(panel.getEndpointStreetNames().start).toBe('New St');
    });

    test('typing an address beats a lookup still on its way', async () => {
      const { panel } = makePanel();

      panel.updateStart(START);
      pick('start', move(START), { context: { street: { name: 'Typed St' } } });
      input('start').value = 'Typed St 1';
      lookups[0].answer(geocoded({ name: 'Looked-up St', context: { street: { name: 'Looked-up St' } } }));
      await flush();

      expect(input('start').value).toBe('Typed St 1');
      expect(panel.getEndpointStreetNames().start).toBe('Typed St');
    });

    test('a failed lookup leaves the field alone and names no street', async () => {
      const { panel } = makePanel();
      pick('start', START, { context: { street: { name: 'Pine St' } } });
      input('start').value = 'Pine St 1';

      panel.updateStart(move(START));
      lookups[0].fail();
      await flush();

      expect(input('start').value).toBe('Pine St 1');
      expect(panel.getEndpointStreetNames().start).toBeNull();
    });

    test('a field whose input has gone still learns the street', async () => {
      const { panel } = makePanel();
      input('start').remove();

      panel.updateStart(START);
      lookups[0].answer(geocoded({ name: 'Pine St', context: { street: { name: 'Pine St' } } }));
      await flush();

      // The street is still learned for the suggested route name.
      expect(panel.getEndpointStreetNames().start).toBe('Pine St');
    });
  });

  describe('resetting', () => {
    test('clears both fields, forgets the streets, and ignores lookups still on their way', async () => {
      const { panel } = makePanel();
      pick('end', END, { context: { street: { name: 'Oak Ave' } } });
      panel.updateStart(START);
      input('start').value = 'Pine St';
      input('end').value = 'Oak Ave';

      panel.clearFields();
      lookups[0].answer(geocoded({ name: 'Pine St' }));
      await flush();

      expect(input('start').value).toBe('');
      expect(input('end').value).toBe('');
      expect(panel.getEndpointStreetNames()).toEqual({ start: null, end: null });

      // Forgotten too: the same spot is looked up again.
      panel.updateStart(START);
      expect(lookups).toHaveLength(2);
    });

    test('the End row shows once the route has a start', () => {
      const { panel } = makePanel();
      const row = document.getElementById('directions-end-row');

      panel.setEndVisible(true);
      expect(row.hidden).toBe(false);
      panel.setEndVisible(false);
      expect(row.hidden).toBe(true);
    });

    test('a page without the End row is left alone', () => {
      const { panel } = makePanel();
      document.getElementById('directions-end-row').replaceWith(document.getElementById('directions-end-slot'));

      expect(() => panel.setEndVisible(true)).not.toThrow();
    });
  });
});
