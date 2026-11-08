/**
 * Tests for PannellumViewer loading from a PanoImageCache (frontend/js/common/pano-viewer/PannellumViewer.js,
 * issue #5562).
 *
 * The viewer's first attempt at a pano is the URL its width ladder (#5256) puts at rung 0, and that is the URL a
 * prefetch was keyed by, so a held copy stands in for exactly that attempt. The later rungs stay network URLs: a held
 * copy that fails is the same bytes failing to decode or texture, and the right retry is a smaller copy, not the
 * download that produced them. The entry is released once the load has settled either way, and the viewer records
 * whether the load was served from the cache, which is what Validate logs as `PanoPrefetch`.
 *
 * Pannellum itself is the pano viewer harness's fake, which settles each scene's load by whether its URL is on a
 * failing list, so the assertions read the URLs it was handed, in order.
 */

import { loadModules } from './loader.js';
import { installFakePannellum } from './support/panoViewerHarness.js';

const NATIVE_URL = '/backupImage/p1';
const NEXT_URL = '/backupImage/p2';

/**
 * A cache holding the given network URL -> blob URL entries, recording what the viewer releases.
 * @param {Object<string, string>} held
 * @returns {{resolve: import('vitest').Mock, release: import('vitest').Mock}}
 */
function fakeCache(held) {
  return {
    resolve: vi.fn((url) => held[url]),
    settle: vi.fn((url) => Promise.resolve(held[url])),
    release: vi.fn((url) => { delete held[url]; }),
  };
}

describe('PannellumViewer loads from the image cache first (issue #5562)', () => {
  let PannellumViewer;
  let canvas;

  beforeEach(async () => {
    canvas = document.createElement('div');
    document.body.appendChild(canvas);

    // No WebGL in jsdom, so the width cap is unknown and rung 0 is the native file.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    ({ PannellumViewer } = await loadModules('frontend/js/common/pano-viewer/PannellumViewer.js'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const metadata = (panoId, imageUrl) => ({
    pano_id: panoId, image_url: imageUrl, width: 16384, height: 8192, camera_heading: 0, lat: 47.6, lng: -122.3,
  });

  /**
     * Creates a viewer on the first pano.
     * @param {?object} imageCache - The cache to attach, or null for none.
     * @returns {Promise<PannellumViewer>}
     */
  async function viewerWith(imageCache) {
    const viewer = new PannellumViewer();
    await viewer.initialize(canvas, { panoMetadata: metadata('p1', NATIVE_URL), imageCache });
    return viewer;
  }

  test('a held copy is loaded in place of the network URL, and released once it has loaded', async () => {
    const { attempted } = installFakePannellum();
    const cache = fakeCache({ [NATIVE_URL]: 'blob:p1' });

    const viewer = await viewerWith(cache);

    expect(attempted).toEqual(['blob:p1']);
    expect(cache.release).toHaveBeenCalledWith(NATIVE_URL);
    expect(viewer.lastLoadPrefetched).toBe(true);
  });

  test('with nothing held the network URL is loaded, and the miss is recorded', async () => {
    const { attempted } = installFakePannellum();
    const cache = fakeCache({});

    const viewer = await viewerWith(cache);

    expect(attempted).toEqual([NATIVE_URL]);
    expect(viewer.lastLoadPrefetched).toBe(false);
  });

  test('a held copy that fails steps down to a smaller network copy rather than the same bytes again', async () => {
    const { attempted, loaded } = installFakePannellum(new Set(['blob:p1']));
    const cache = fakeCache({ [NATIVE_URL]: 'blob:p1' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const viewer = await viewerWith(cache);

    expect(warn).toHaveBeenCalledWith('Pano p1 failed to load; retrying at a smaller size.', expect.any(Error));
    expect(attempted).toEqual(['blob:p1', `${NATIVE_URL}?maxWidth=8192`]);
    expect(loaded).toEqual([`${NATIVE_URL}?maxWidth=8192`]);
    expect(cache.release).toHaveBeenCalledWith(NATIVE_URL);
    expect(viewer.lastLoadPrefetched).toBe(false); // The network was paid for after all.
  });

  test('a load waits for a prefetch still in flight rather than downloading beside it', async () => {
    const { attempted } = installFakePannellum();
    const cache = fakeCache({});
    // Nothing held yet, but a download about to finish: settle() is what hands it over.
    cache.settle = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('blob:p1'), 0)));

    const viewer = await viewerWith(cache);

    expect(cache.settle).toHaveBeenCalledWith(NATIVE_URL, PannellumViewer.PREFETCH_WAIT_MS);
    expect(attempted).toEqual(['blob:p1']);
    expect(viewer.lastLoadPrefetched).toBe(true);
  });

  test('the next pano is looked up the same way', async () => {
    const { attempted } = installFakePannellum();
    const cache = fakeCache({ [NEXT_URL]: 'blob:p2' });
    const viewer = await viewerWith(cache);

    await viewer.loadPano('p2', metadata('p2', NEXT_URL), { heading: 0, pitch: 0, zoom: 1 });

    expect(attempted).toEqual([NATIVE_URL, 'blob:p2']);
    expect(cache.release).toHaveBeenLastCalledWith(NEXT_URL);
    expect(viewer.lastLoadPrefetched).toBe(true);
    expect(viewer.getPanoId()).toBe('p2');
  });

  test('asking for the pano already shown fetches nothing and reports no prefetch outcome', async () => {
    const { attempted } = installFakePannellum();
    const cache = fakeCache({});
    const viewer = await viewerWith(cache);
    expect(viewer.lastLoadPrefetched).toBe(false);

    await viewer.loadPano('p1', metadata('p1', NATIVE_URL), { heading: 0, pitch: 0, zoom: 1 });

    expect(attempted).toEqual([NATIVE_URL]);
    expect(viewer.lastLoadPrefetched).toBeNull();
  });

  test('a next pano that fails even at the smallest copy is still released', async () => {
    const failing = new Set(['blob:p2', `${NEXT_URL}?maxWidth=8192`, `${NEXT_URL}?maxWidth=4096`]);
    installFakePannellum(failing);
    const cache = fakeCache({ [NEXT_URL]: 'blob:p2' });
    const viewer = await viewerWith(cache);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(viewer.loadPano('p2', metadata('p2', NEXT_URL), { heading: 0, pitch: 0, zoom: 1 }))
      .rejects.toThrow();

    expect(cache.release).toHaveBeenLastCalledWith(NEXT_URL);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a next pano that fails on a lost WebGL context is still released (#5939)', async () => {
    const pannellum = installFakePannellum();
    const cache = fakeCache({ [NEXT_URL]: 'blob:p2' });
    const viewer = await viewerWith(cache);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    pannellum.webgl.lost = true;
    await expect(viewer.loadPano('p2', metadata('p2', NEXT_URL), { heading: 0, pitch: 0, zoom: 1 }))
      .rejects.toThrow('WebGL context lost');

    expect(cache.release).toHaveBeenLastCalledWith(NEXT_URL);
    expect(cache.release.mock.calls.filter((c) => c[0] === NEXT_URL)).toHaveLength(2);
  });

  test('a viewer with no cache loads from the network and reports the question as not applicable', async () => {
    const { attempted } = installFakePannellum();

    const viewer = await viewerWith(null);

    expect(attempted).toEqual([NATIVE_URL]);
    expect(viewer.lastLoadPrefetched).toBeNull();
  });
});
