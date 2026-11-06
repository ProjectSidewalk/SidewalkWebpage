/**
 * The contract every pano viewer inherits from PanoViewer (frontend/js/common/pano-viewer/PanoViewer.js): the base
 * can't be built on its own, a provider that leaves out a method it must supply fails loudly rather than quietly, the
 * optional hooks are safe no-ops, and listeners come and go by event name. A page holds a viewer only through this
 * interface, so a gap here surfaces as a blank pano on whichever provider fell into it (#5840).
 */

import { loadModules } from './loader.js';

const { PanoViewer } = await loadModules('frontend/js/common/pano-viewer/PanoViewer.js');

/** A provider that supplies nothing of its own, so every call lands on the base class. */
class BareViewer extends PanoViewer {
  static SOURCE = 'bare';

  /** Tells its pano listeners about a move, the way each real provider does once a pano has loaded. */
  announcePano() {
    for (const listener of this.panoChangedListeners) listener();
  }
}

describe('PanoViewer', () => {
  test('cannot be built on its own, only as a provider', () => {
    expect(() => new PanoViewer()).toThrow('Cannot instantiate abstract class directly');
    expect(new BareViewer().getViewerType()).toBe('bare');
  });

  test('a provider that leaves out a method it must supply fails loudly when that method is called', async () => {
    const viewer = new BareViewer();
    const here = { lat: 47.6, lng: -122.3 };

    await expect(viewer.initialize(document.createElement('div'))).rejects.toThrow('must implement initialize()');
    await expect(viewer.setLocation(here)).rejects.toThrow('setLocation(latLng, excludedPanos) must be implemented');
    await expect(viewer.setPano('p1')).rejects.toThrow('setPano(panoId) must be implemented');
    for (const method of ['getPanoId', 'getPosition', 'getLinkedPanos', 'getPov', 'setPov', 'hideNavigationArrows',
      'showNavigationArrows']) {
      expect(() => viewer[method]({})).toThrow(`${method}() must be implemented by subclass`);
    }
  });

  test('the optional hooks are harmless no-ops for a provider that has nothing to offer', async () => {
    const viewer = new BareViewer();
    const here = { lat: 47.6, lng: -122.3 };

    expect(viewer.prefetchLocation(here)).toBeUndefined();
    expect(viewer.clearPrefetchCache()).toBeUndefined();
    expect(viewer.prefetchPano('p1')).toBeUndefined();
    expect(viewer.resize()).toBeUndefined();
    await expect(viewer.preloadPanoNear(here)).resolves.toBeUndefined();
    await expect(viewer.lookupPanoPosition('p1')).resolves.toBeNull();
    await expect(BareViewer.preloadLibrary()).resolves.toBeUndefined();
    expect(viewer.publicViewerLink('p1', {})).toBeNull();
  });

  test('listeners are added and removed by event name, and an unknown name is ignored', () => {
    const viewer = new BareViewer();
    const pano = vi.fn();
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    const pov = vi.fn();
    viewer.addListener('pano_changed', pano);
    viewer.addListener('pov_changed', pov);
    viewer.addListener('pano_moved', pano);

    viewer.announcePano();
    viewer._firePovChangedAfterResize();
    frames.shift()();
    frames.shift()();
    expect(pano).toHaveBeenCalledTimes(1);
    expect(pov).toHaveBeenCalledTimes(1);

    viewer.removeListener('pano_changed', pano);
    viewer.removeListener('pov_changed', pov);
    viewer.removeListener('pano_moved', pano);
    viewer.announcePano();
    viewer._firePovChangedAfterResize();
    frames.shift()();
    frames.shift()();
    expect(pano).toHaveBeenCalledTimes(1);
    expect(pov).toHaveBeenCalledTimes(1);
  });
});
