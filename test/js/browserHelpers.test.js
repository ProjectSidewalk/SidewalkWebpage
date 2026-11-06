/**
 * The small page-and-browser readers in frontend/js/common/utilities.js: which browser this is (Explore turns away
 * one it doesn't support, and every submission records it), a URL query parameter, the unit turf measures in, and
 * `getImage`, which Validate's and Explore's example tooltips load their pictures through. (#5840)
 */

import { loadModules } from './loader.js';

const USER_AGENTS = {
  Chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 '
    + 'Safari/537.36',
  Firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  Safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 '
    + 'Safari/605.1.15',
};

/**
 * Loads a fresh utilities.js under the given user agent, since the browser is read once per page.
 * @param {string} [userAgent] - What `navigator.userAgent` answers; jsdom's own when omitted.
 * @returns {Promise<object>} The module's `util`.
 */
async function loadUtil(userAgent) {
  if (userAgent) vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  return (await loadModules('frontend/js/common/utilities.js')).util;
}

describe('browser detection', () => {
  test.each(Object.keys(USER_AGENTS))('recognizes %s, and only it', async (name) => {
    const util = await loadUtil(USER_AGENTS[name]);
    expect(util.getBrowser()).toBe(name);
    expect({ Chrome: util.isChrome(), Firefox: util.isFirefox(), Safari: util.isSafari() })
      .toEqual({ Chrome: name === 'Chrome', Firefox: name === 'Firefox', Safari: name === 'Safari' });
  });

  test('reads the version and operating system a submission records', async () => {
    const util = await loadUtil(USER_AGENTS.Firefox);
    expect(util.getBrowserVersion()).toBe('132.0');
    expect(util.getOperatingSystem()).toBe('Linux');
  });
});

describe('util.getURLParameter', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  test('reads a parameter, decoded', async () => {
    const util = await loadUtil();
    window.history.replaceState(null, '', '/explore?regionId=12&name=Capitol%20Hill');
    expect(util.getURLParameter('name')).toBe('Capitol Hill');
  });

  test('answers an empty string for a parameter the address doesn\'t have', async () => {
    const util = await loadUtil();
    window.history.replaceState(null, '', '/explore?regionId=12');
    expect(util.getURLParameter('streetEdgeId')).toBe('');
  });
});

describe('util.turfDistanceUnits', () => {
  afterEach(() => delete document.documentElement.dataset.measurementSystem);

  test('measures in kilometers for a metric reader and miles otherwise', async () => {
    const util = await loadUtil();
    document.documentElement.dataset.measurementSystem = 'metric';
    expect(util.turfDistanceUnits()).toBe('kilometers');
    document.documentElement.dataset.measurementSystem = 'imperial';
    expect(util.turfDistanceUnits()).toBe('miles');
  });
});

describe('util.getImage', () => {
  /**
   * Answers every fetch with the given response.
   * @param {object} response - What `fetch` resolves to.
   * @returns {import('vitest').Mock} The stub.
   */
  const answerFetch = (response) => {
    const stub = vi.fn(async () => response);
    vi.stubGlobal('fetch', stub);
    return stub;
  };

  test('hands back the image as a data URL a tooltip can show', async () => {
    const util = await loadUtil();
    const gif = new Blob(['GIF89a'], { type: 'image/gif' });
    const fetchStub = answerFetch({ ok: true, status: 200, blob: async () => gif });
    await expect(util.getImage('/assets/images/examples/CurbRamp.gif'))
      .resolves.toBe(`data:image/gif;base64,${btoa('GIF89a')}`);
    expect(fetchStub).toHaveBeenCalledWith('/assets/images/examples/CurbRamp.gif');
  });

  // Explore tries a city's own example first and falls back to the generic one on this rejection.
  test('rejects for an image the server doesn\'t have', async () => {
    const util = await loadUtil();
    answerFetch({ ok: false, status: 404 });
    await expect(util.getImage('/assets/images/examples/seattle/CurbRamp.gif')).rejects.toThrow('Image not found');
  });

  test('rejects on any other failed response', async () => {
    const util = await loadUtil();
    answerFetch({ ok: false, status: 503 });
    await expect(util.getImage('/assets/images/examples/CurbRamp.gif')).rejects.toThrow('Other network error');
  });
});
