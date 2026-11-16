/**
 * Tests for how Infra3dViewer (frontend/js/common/pano-viewer/Infra3dViewer.js) brings the Infra3d SDK up: the project
 * each city's imagery lives in, the SDK chrome and arrows no page shows, the arrow keys it keeps from moving the pano,
 * and the SDK events it relays to our listeners. Token renewal, init timeouts and download retries have their own
 * suites; the SDK is the fake in infra3dViewerHarness.js. (#5840)
 */

import { fakeInfra3dSdk, infra3dSdk, jwtExpiringAt, loadInfra3dViewer, nodeFor } from './infra3dViewerHarness.js';

const Infra3dViewer = await loadInfra3dViewer();

describe('Infra3dViewer setup', () => {
  let mount;
  let sdk;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="pano-mount"></div>
      <input id="search" type="text"><input id="check" type="checkbox">`;
    mount = document.getElementById('pano-mount');
    sdk = fakeInfra3dSdk();
  });

  afterEach(() => {
    delete window.cityId;
    infra3dSdk.infra3dapi = {};
  });

  /**
   * Brings a viewer up at a start pano, as the pages do.
   * @param {object} [options] - Page options on top of the token and start pano.
   * @returns {Promise<object>} The viewer.
   */
  const create = (options = {}) => Infra3dViewer.create(mount, {
    accessToken: jwtExpiringAt(Date.now() + 60 * 60 * 1000), startPanoId: 'SEED', defaultNavigation: false, ...options,
  });

  it("opens Zurich's project by default and Winterthur's for Winterthur, with the SDK's own chrome off", async () => {
    await create();
    expect(sdk.manager.initViewer).toHaveBeenLastCalledWith(expect.objectContaining({
      project_uid: 'bd8196f8-dbe5-4e67-849f-977452fe7587',
      show_topbar: false, show_toolbar: false, show_mapWindow: false, map_expand: false, show_cockpit: false,
    }));
    expect(infra3dSdk.infra3dapi.init).toHaveBeenCalledWith('pano-mount', expect.stringMatching(/^hdr\./));

    window.cityId = 'winterthur-infra3d';
    await create();
    expect(sdk.manager.initViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ project_uid: 'ab6045da-46b4-44d2-8123-e19c7cdbe7ea' }));
  });

  it('starts at the pano asked for, and only then limits moves to 360° imagery', async () => {
    const viewer = await create();

    expect(viewer.getPanoId()).toBe('SEED');
    expect(sdk.sdkViewer.setFilter).toHaveBeenCalledWith(['in', 'cameraType', 'calotte', 'cubemap']);
    expect(sdk.sdkViewer.setFilter.mock.invocationCallOrder[0])
      .toBeGreaterThan(sdk.sdkViewer.moveToKey.mock.invocationCallOrder[0]);
  });

  it("hides the SDK's arrows on pages that draw their own, and keeps them for the admin label card", async () => {
    await create();
    expect(sdk.sdkViewer.deactivateComponent).toHaveBeenCalledWith('direction');

    sdk = fakeInfra3dSdk();
    await create({ defaultNavigation: true });
    expect(sdk.sdkViewer.deactivateComponent).not.toHaveBeenCalled();
  });

  it("records the new pano's metadata when the admin moves with the SDK's arrows", async () => {
    const viewer = await create({ defaultNavigation: true });

    await sdk.emit('sdkViewer', 'nodechanged', nodeFor('NEXT'));

    expect(viewer.getPanoId()).toBe('NEXT');
  });

  it('relays a pano change and a camera turn to their listeners, one listener after the other', async () => {
    const viewer = await create();
    const order = [];
    viewer.addListener('pano_changed', async () => { await Promise.resolve(); order.push('pano 1'); });
    viewer.addListener('pano_changed', () => order.push('pano 2'));
    viewer.addListener('pov_changed', () => order.push('pov'));

    await sdk.emit('sdkViewer', 'nodechanged', nodeFor('NEXT'));
    await sdk.emit('viewer', 'panorotationchanged', {});

    expect(order).toEqual(['pano 1', 'pano 2', 'pov']);
  });

  describe('the keys that would move the pano', () => {
    beforeEach(async () => {
      await create();
    });

    /**
     * Presses a key on an element and says whether anything past the window's capture phase heard it.
     * @param {Element} target - Where the key is pressed.
     * @param {string} code - The key's code.
     * @returns {boolean} Whether a listener on the element heard it.
     */
    function heard(target, code) {
      const listener = vi.fn();
      target.addEventListener('keydown', listener);
      target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      target.removeEventListener('keydown', listener);
      return listener.mock.calls.length > 0;
    }

    it('stops the arrow keys and space before the SDK hears them', () => {
      for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space']) {
        expect(heard(mount, code)).toBe(false);
      }
    });

    it('lets every other key through', () => {
      expect(heard(mount, 'KeyA')).toBe(true);
    });

    it('lets the arrows through to a text field, where they move the cursor', () => {
      expect(heard(document.getElementById('search'), 'ArrowLeft')).toBe(true);
      expect(heard(document.getElementById('check'), 'ArrowLeft')).toBe(false);
    });
  });
});
