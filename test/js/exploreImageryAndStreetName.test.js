/**
 * Two of Explore's server calls that live on util.misc (frontend/js/common/utilitiesSidewalk.js): `reportNoImagery`,
 * which tells our server a street has no imagery so it stops being handed out, and `getStreetNameNear`, which asks
 * Mapbox to name the street a labeler was moved past. The first is a durable record, so its body is pinned; the
 * second is decoration, so every way it can fail must end in null rather than an error. (#5840)
 */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, sentRequests } from './support/routeFetch.js';

const i18next = { t: (key) => (key === 'common:mapbox-language-code' ? 'es' : key) };
mockModule('i18next', () => ({ default: i18next }));

const { util } = await loadModules('frontend/js/common/utilitiesSidewalk.js', 'frontend/js/common/utilities.js');

describe('util.misc.reportNoImagery', () => {
  /**
   * An Explore task for street 4321, as TaskContainer holds it.
   * @param {boolean} reversed - Whether the labeler walks it from its end.
   * @returns {object} The task.
   */
  const task = (reversed) => ({
    getStreetEdgeId: () => 4321,
    getAuditTaskId: () => 77,
    isComplete: () => false,
    getProperty: (key) => ({ startPointReversed: reversed, taskStart: '2026-11-06T18:00:00Z' })[key],
    getStartCoordinate: () => ({ lat: 47.6, lng: -122.33 }),
    getEndCoordinate: () => ({ lat: 47.61, lng: -122.32 }),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T19:00:00Z'));
  });

  test.each([
    ['its start', false, { current_lat: 47.6, current_lng: -122.33 }],
    ['its end, for a street walked backwards', true, { current_lat: 47.61, current_lng: -122.32 }],
  ])('files the street as missing imagery, standing the labeler at %s', async (_, reversed, position) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = routeFetch({ 'POST /explore/nostreetview': {} });
    await util.misc.reportNoImagery(task(reversed), 12);
    expect(sentRequests(fetchStub)).toEqual([{
      method: 'POST',
      url: '/explore/nostreetview',
      body: {
        audit_task: {
          street_edge_id: 4321,
          task_start: '2026-11-06T18:00:00Z',
          audit_task_id: 77,
          completed: false,
          ...position,
          start_point_reversed: reversed,
          current_mission_start: null,
          last_priority_update_time: '2026-11-06T19:00:00.000Z',
          request_updated_street_priority: false,
        },
        mission_id: 12,
      },
    }]);
    expect(error).toHaveBeenCalledWith('Imagery missing for a large portion of street: 4321');
  });
});

describe('util.misc.getStreetNameNear', () => {
  const HERE = { lat: 47.6, lng: -122.33 };
  const GEOCODER = 'https://api.mapbox.com/search/geocode/v6/reverse';

  /**
   * One Mapbox v6 reverse-geocode answer.
   * @param {object} properties - The first feature's properties.
   * @returns {object} The response body.
   */
  const answer = (properties) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties }] });

  test('asks Mapbox in the reader\'s language and names the street an address is on', async () => {
    const fetchStub = routeFetch({ [GEOCODER]: answer({
      feature_type: 'address', name: '1410 NE Campus Pkwy', context: { street: { name: 'NE Campus Pkwy' } },
    }) });
    await expect(util.misc.getStreetNameNear(HERE, 'pk.test')).resolves.toBe('NE Campus Pkwy');
    const params = new URL(fetchStub.mock.calls[0][0]).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      longitude: '-122.33', latitude: '47.6', types: 'address,street', language: 'es', access_token: 'pk.test',
    });
  });

  test('names a street result by its preferred name, else its own', async () => {
    const street = { feature_type: 'street', name: 'Campus Pkwy' };
    routeFetch({ [GEOCODER]: answer({ ...street, name_preferred: 'NE Campus Pkwy' }) });
    await expect(util.misc.getStreetNameNear(HERE, 'pk.test')).resolves.toBe('NE Campus Pkwy');
    routeFetch({ [GEOCODER]: answer(street) });
    await expect(util.misc.getStreetNameNear(HERE, 'pk.test')).resolves.toBe('Campus Pkwy');
  });

  test.each([
    ['there is no Mapbox key', null, undefined],
    ['Mapbox refuses', 'pk.test', { status: 429 }],
    ['Mapbox can\'t be reached', 'pk.test', new TypeError('Failed to fetch')],
    ['nothing is there', 'pk.test', { type: 'FeatureCollection', features: [] }],
    ['the answer is a place with no street', 'pk.test', answer({ feature_type: 'place', name: 'Seattle' })],
  ])('gives null when %s', async (_, key, reply) => {
    const fetchStub = routeFetch({ [GEOCODER]: reply });
    await expect(util.misc.getStreetNameNear(HERE, key)).resolves.toBeNull();
    if (!key) expect(fetchStub).not.toHaveBeenCalled();
  });
});
