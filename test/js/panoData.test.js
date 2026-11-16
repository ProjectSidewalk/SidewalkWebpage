/**
 * PanoData and PanoStore (frontend/js/common/pano-viewer/), the record every viewer keeps of a pano and the store
 * Explore and Validate hold them in until they are sent with a mission. PanoData refuses a record a viewer could not
 * render from; the store keeps the first record it gets for each pano, and never hands the tutorial's made-up panos
 * to the form that saves pano records (#5840).
 */

import { loadModules } from './loader.js';

const { PanoData, PanoStore } = await loadModules('frontend/js/common/pano-viewer/PanoData.js',
  'frontend/js/common/pano-viewer/PanoStore.js');

/**
 * The fields a viewer builds a PanoData from, all present.
 * @param {object} [extra] - Fields to replace.
 * @returns {object} The constructor's params.
 */
const params = (extra = {}) => ({
  panoId: 'p1', source: 'gsv', lat: 47.6, lng: -122.3, cameraHeading: 90, width: 16384, height: 8192,
  captureDate: new Date(2024, 4, 1), linkedPanos: [], history: [], ...extra,
});

describe('PanoData', () => {
  test('a pano with no tiling, address, credit or licence reads as one tile and nulls', () => {
    const data = new PanoData(params());
    expect(data.getPanoId()).toBe('p1');
    expect(data.getProperties()).toMatchObject({
      tileWidth: 16384, tileHeight: 8192, address: null, copyright: null, license: null, submitted: false,
    });
    expect(data.getProperty('cameraPitch')).toBeUndefined();
  });

  test('a field it doesn\'t hold reads as null, and a set one reads back', () => {
    const data = new PanoData(params());
    expect(data.getProperty('nonsense')).toBeNull();
    data.setProperty('submitted', true);
    expect(data.getProperty('submitted')).toBe(true);
  });

  test('refuses a record missing a field a viewer needs', () => {
    expect(() => new PanoData(params({ width: undefined }))).toThrow('Missing required parameter: width');
    expect(() => new PanoData(params({ history: null }))).toThrow('Missing required parameter: history');
  });

  test('refuses an imagery source it doesn\'t know', () => {
    expect(() => new PanoData(params({ source: 'bing' }))).toThrow('Invalid source');
  });

  test('refuses a position, angle or size that isn\'t a real number', () => {
    expect(() => new PanoData(params({ lat: '47.6' }))).toThrow('lat must be a valid number');
    expect(() => new PanoData(params({ cameraPitch: NaN }))).toThrow('cameraPitch must be a valid number');
  });

  test('refuses a capture date that isn\'t a Date', () => {
    expect(() => new PanoData(params({ captureDate: '2024-05' }))).toThrow('captureDate must be a Date object');
  });
});

describe('PanoStore', () => {
  test('keeps the first record per pano, and answers null for one it never saw', () => {
    const store = new PanoStore();
    const first = new PanoData(params());
    store.addPanoMetadata('p1', first);
    store.addPanoMetadata('p1', new PanoData(params({ address: 'later' })));

    expect(store.getPanoData('p1')).toBe(first);
    expect(store.getPanoData('p2')).toBeNull();
    expect(store.getAllPanoData()).toEqual([first]);
  });

  test('stages only what hasn\'t been sent, and never the tutorial\'s made-up panos', () => {
    const store = new PanoStore();
    const fresh = new PanoData(params({ panoId: 'p1' }));
    const sent = new PanoData(params({ panoId: 'p2', submitted: true }));
    const tutorial = new PanoData(params({ panoId: 'tutorial' }));
    store.addPanoMetadata('p1', fresh);
    store.addPanoMetadata('p2', sent);
    store.addPanoMetadata('tutorial', tutorial);

    expect(store.getStagedPanoData()).toEqual([fresh]);
    expect(tutorial.getProperty('submitted')).toBe(true);
  });
});
