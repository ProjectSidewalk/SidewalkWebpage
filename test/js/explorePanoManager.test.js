/**
 * Tests Explore's pano manager (frontend/js/explore/panorama/PanoManager.js) (#5840): how the viewer is seeded and
 * which way the street then runs, what the first pano announces, Google's attribution links, moving to a pano or a
 * place, and every way the view is turned and kept in bounds. The fallback points and the give-up path have their
 * own suites. Runs over a fake viewer; no imagery is loaded.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule, useUtil } from './loader.js';
import { fakePanoOverlays, fakeTracker, navigationAttempts } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

/** The viewer the GSV class hands back; rebuilt per test. */
let viewer;

class GsvViewer {
  static SOURCE = 'gsv';

  static create = vi.fn(() => Promise.resolve(viewer));
}
mockModule('frontend/js/common/pano-viewer/GsvViewer.js', () => ({ GsvViewer }));
mockModule('frontend/js/common/pano-viewer/MapillaryViewer.js', () => ({ MapillaryViewer: class {} }));

// A straight ~400 m street running east along one latitude.
const LAT = 47.6;
const START_LNG = -122.33;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (meters) => START_LNG + meters / M_PER_DEG_LNG;
const STREET = turf.lineString([[START_LNG, LAT], [lngAt(400), LAT]]);
const START = { lat: LAT, lng: START_LNG };
const END = { lat: LAT, lng: lngAt(400) };

/**
 * @param {string} panoId
 * @param {Record<string, any>} [props] - What `getProperty` answers by key.
 * @returns {object} A pano's metadata, as the manager reads it.
 */
const panoData = (panoId, props = {}) => ({ getPanoId: () => panoId, getProperty: (key) => props[key] });

/** How the suite sees the move to /explore a street given up on ends in. */
const navigations = navigationAttempts();

describe('Explore PanoManager', () => {
  let PanoManager;
  let NoImageryFlagGuard;
  let NoImageryError;
  let tracker;
  let panoStore;
  let alertController;
  let task;
  let pov;
  let position;
  let removeListener;

  /**
   * @param {object} seed - Where to open.
   * @returns {Promise<PanoManager>} A manager whose viewer has loaded.
   */
  async function load(seed = { startPanoId: 'pano1' }) {
    const ui = {
      pano: document.getElementById('pano'),
      viewControlLayer: document.getElementById('view-control-layer'),
    };
    const manager = new PanoManager(ui, { viewerType: GsvViewer, viewerAccessToken: 'token' }, panoStore, tracker,
      alertController, seed, { task, missionId: 3 });
    expect(await manager.ready).toBe(true);
    return manager;
  }

  beforeEach(async () => {
    document.body.innerHTML = `
      <div class="tool-ui">
        <div id="pano-holder"><div id="pano"></div></div>
        <div id="view-control-layer"></div>
      </div>`;
    window.sessionStorage.clear();
    removeListener = vi.fn();
    window.google = { maps: { event: { removeListener } } };
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; }

      observe = vi.fn();

      disconnect = vi.fn();
    });

    pov = { heading: 0, pitch: 0, zoom: 1 };
    position = { ...START };
    viewer = {
      initialSeed: 'pano',
      currPanoData: panoData('pano1', { lat: LAT, lng: START_LNG, cameraHeading: 12, cameraPitch: -1 }),
      listeners: {},
      addListener: vi.fn((name, listener) => { viewer.listeners[name] = listener; }),
      getPov: () => (pov ? { ...pov } : null),
      setPov: vi.fn((next) => { pov = { ...next }; }),
      getPosition: () => position,
      getPanoId: () => 'pano1',
      setPano: vi.fn(() => Promise.resolve(panoData('pano2'))),
      setLocation: vi.fn(() => Promise.resolve(panoData('pano3'))),
      gsvPano: { addListener: vi.fn(() => 'links-token') },
    };
    tracker = fakeTracker();
    panoStore = { addPanoMetadata: vi.fn() };
    alertController = { showAlert: vi.fn() };
    task = {
      getFeature: () => STREET,
      getEndCoordinate: () => END,
      reverseStreetDirection: vi.fn(),
      getStreetEdgeId: () => 101,
    };
    fakePanoOverlays();
    ({ PanoManager, NoImageryFlagGuard, NoImageryError } = await loadModules(
      'frontend/js/explore/panorama/PanoManager.js', 'frontend/js/explore/panorama/NoImageryFlagGuard.js',
      'frontend/js/common/pano-viewer/NoImageryError.js',
    ));
  });

  describe('when session storage is blocked', () => {
    let descriptor;

    beforeEach(() => {
      descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    });

    afterEach(() => {
      Object.defineProperty(window, 'sessionStorage', descriptor);
    });

    it('still moves on from a street with no imagery, at the cost of the explanation', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const reportNoImagery = vi.fn(() => Promise.resolve());
      useUtil({ misc: { reportNoImagery } });
      GsvViewer.create.mockImplementationOnce(() => Promise.reject(new NoImageryError('nothing here')));
      const ui = { pano: document.getElementById('pano'), viewControlLayer: null };
      const manager = new PanoManager(ui, { viewerType: GsvViewer, viewerAccessToken: 'token' }, panoStore, tracker,
        alertController, { startPanoId: 'pano1' }, { task, missionId: 3 });
      expect(await manager.ready).toBe(false);
      expect(reportNoImagery).toHaveBeenCalledWith(task, 3);
      expect(navigations).toHaveBeenCalledTimes(1);
      expect(PanoManager.consumeStreetSkippedNotice()).toBeNull();
    });
  });

  describe('seeding the viewer', () => {
    it('tries the pano first, with the lat/lng and the street\'s samples behind it', async () => {
      await load({ startPanoId: 'pano1', startLat: LAT, startLng: lngAt(100) });
      const [mount, options] = GsvViewer.create.mock.calls[0];
      expect(mount).toBe(document.getElementById('pano'));
      expect(options).toMatchObject({
        accessToken: 'token', defaultNavigation: false, preloadNeighbors: true, startPanoId: 'pano1',
        startLatLng: { lat: LAT, lng: lngAt(100) },
      });
      expect(options.backupLatLngs).toHaveLength(40);
      expect(options.backupLatLngs.at(-1)).toEqual(END);
    });

    it('sends no fallback for a seed with no coordinates', async () => {
      await load({ startPanoId: 'pano1' });
      const [, options] = GsvViewer.create.mock.calls[0];
      expect(options).not.toHaveProperty('startLatLng');
      expect(options).not.toHaveProperty('backupLatLngs');
    });

    it('walks the street backwards when the fallback landed nearer its end', async () => {
      viewer.initialSeed = 'latLng';
      position = { ...END };
      await load({ startLat: LAT, startLng: START_LNG });
      expect(task.reverseStreetDirection).toHaveBeenCalledTimes(1);
    });

    it('keeps the street\'s direction when the fallback landed near its start, or the pano itself loaded', async () => {
      viewer.initialSeed = 'latLng';
      await load({ startLat: LAT, startLng: START_LNG });
      viewer.initialSeed = 'pano';
      position = { ...END };
      await load({ startPanoId: 'pano1', startLat: LAT, startLng: START_LNG });
      expect(task.reverseStreetDirection).not.toHaveBeenCalled();
    });

    it('faces a stored view from the pano it was recorded at, within the zoom range', async () => {
      await load({ startPanoId: 'pano1', startPov: { heading: 45, zoom: 5 } });
      expect(pov).toEqual({ heading: 45, pitch: 0, zoom: 3 });
      await load({ startPanoId: 'pano1', startPov: { heading: 45, pitch: -10, zoom: 0.2 } });
      expect(pov).toEqual({ heading: 45, pitch: -10, zoom: 1 });
      await load({ startPanoId: 'pano1', startPov: { heading: 45, pitch: -10 } });
      expect(pov).toEqual({ heading: 45, pitch: -10, zoom: 1 });
    });

    it('faces the seed itself when the pano fell back to coordinates, since the view was from another camera',
      async () => {
        viewer.initialSeed = 'latLng';
        await load({ startPanoId: 'dead', startLat: LAT, startLng: lngAt(100), startPov: { heading: 270, zoom: 2 } });
        expect(pov.heading).toBeCloseTo(90, 0);
        expect(pov).toMatchObject({ pitch: 0, zoom: 1 });
      });

    it('only resets the zoom without a stored view', async () => {
      pov = { heading: 33, pitch: -3, zoom: 2 };
      await load();
      expect(pov).toEqual({ heading: 33, pitch: -3, zoom: 1 });
    });

    it('announces the first pano and its view, and keeps the pano\'s metadata', async () => {
      const onPano = vi.fn();
      const onPov = vi.fn();
      const ui = {
        pano: document.getElementById('pano'),
        viewControlLayer: document.getElementById('view-control-layer'),
      };
      const manager = new PanoManager(ui, { viewerType: GsvViewer, viewerAccessToken: 'token' }, panoStore, tracker,
        alertController, { startPanoId: 'pano1' }, { task, missionId: 3 });
      manager.onPanoChanged(onPano);
      manager.onPovChanged(onPov);
      await manager.ready;
      expect(onPano).toHaveBeenCalledWith(viewer.currPanoData);
      expect(onPov).toHaveBeenCalledWith(0);
      expect(panoStore.addPanoMetadata).toHaveBeenCalledWith('pano1', viewer.currPanoData);
      expect(tracker.push).toHaveBeenCalledWith('PanoId_Changed',
        { panoId: 'pano1', lat: LAT, lng: START_LNG, cameraHeading: 12, cameraPitch: -1 });
      expect(tracker.push).toHaveBeenCalledWith('POV_Changed');
      expect(tracker.trackPano).toHaveBeenCalledWith(manager);
      expect(manager.panoViewer).toBe(viewer);
      expect(manager.getPanoId()).toBe('pano1');
      expect(manager.getPosition()).toBe(position);
    });

    it('logs what the viewer reports about itself, and tells the labeler only of a lost token', async () => {
      await load();
      viewer.listeners.diagnostic('TileFailed', { x: 1 });
      expect(tracker.push).toHaveBeenCalledWith('PanoViewer_TileFailed', { x: 1 });
      expect(alertController.showAlert).not.toHaveBeenCalled();
      viewer.listeners.diagnostic('TokenExpired');
      expect(alertController.showAlert)
        .toHaveBeenCalledWith('popup.imagery-session-expired', 'imagerySessionExpired', false);
    });

    it('adds no attribution hooks for a viewer that has no links bar', async () => {
      class Infra3dViewer {
        static SOURCE = 'infra3d';

        static create = () => Promise.resolve(viewer);
      }
      const ui = { pano: document.getElementById('pano'), viewControlLayer: null };
      const manager = new PanoManager(ui, { viewerType: Infra3dViewer, viewerAccessToken: 'token' }, panoStore,
        tracker, alertController, { startPanoId: 'pano1' }, { task, missionId: 3 });
      expect(await manager.ready).toBe(true);
      expect(viewer.gsvPano.addListener).not.toHaveBeenCalled();
    });

    it('ends a run of streets given up on once a pano loads', async () => {
      NoImageryFlagGuard.recordStreetGivenUp();
      NoImageryFlagGuard.recordStreetGivenUp();
      await load();
      expect(NoImageryFlagGuard.count()).toBe(0);
    });
  });

  describe('Google\'s attribution links', () => {
    /** Puts Google's links bar into the pano, as the SDK injects it a moment after the pano renders. */
    function injectLinks() {
      document.getElementById('pano').insertAdjacentHTML('beforeend', `
        <div id="links-bar"><div>
          <div class="gm-style-cc"><span>icon</span>Keyboard shortcuts</div>
          <div class="gm-style-cc"><span>icon</span>Map data</div>
          <div class="gm-style-cc"><span>icon</span>Terms</div>
          <div class="gm-style-cc"><span>icon</span>Report</div>
        </div></div>`);
      Object.defineProperty(document.getElementById('links-bar'), 'offsetHeight', { value: 14, configurable: true });
    }

    it('moves them where they can be clicked once Google has injected them, then stops watching', async () => {
      await load();
      const [event, onLinksChanged] = viewer.gsvPano.addListener.mock.calls[0];
      expect(event).toBe('links_changed');
      expect(removeListener).not.toHaveBeenCalled();

      injectLinks();
      onLinksChanged();
      const bar = document.getElementById('links-bar');
      expect(bar.parentElement).toBe(document.getElementById('view-control-layer'));
      expect(bar.querySelectorAll('.gm-style-cc')).toHaveLength(3);
      expect(bar.querySelector('span')).toBeNull();
      expect(removeListener).toHaveBeenCalledWith('links-token');
      // The bottom-left overlays sit above the bar by its height.
      expect(document.querySelector('.tool-ui').style.getPropertyValue('--bottom-left-links-clearance')).toBe('14px');
    });

    it('leaves a bar that is already in place alone on later pano changes', async () => {
      await load();
      injectLinks();
      const onLinksChanged = viewer.gsvPano.addListener.mock.calls[0][1];
      onLinksChanged();
      onLinksChanged();
      expect(document.querySelectorAll('.gm-style-cc')).toHaveLength(3);
    });

    it('publishes no clearance it cannot measure, and none on a page without the tool', async () => {
      await load();
      injectLinks();
      Object.defineProperty(document.getElementById('links-bar'), 'offsetHeight', { value: 0 });
      viewer.gsvPano.addListener.mock.calls[0][1]();
      expect(document.querySelector('.tool-ui').style.getPropertyValue('--bottom-left-links-clearance')).toBe('');

      document.querySelector('.tool-ui').classList.remove('tool-ui');
      await load();
      injectLinks();
      expect(() => viewer.gsvPano.addListener.mock.calls[1][1]()).not.toThrow();
    });
  });

  describe('moving', () => {
    it('to a pano, announcing it', async () => {
      const manager = await load();
      const onPano = vi.fn();
      manager.onPanoChanged(onPano);
      const data = await manager.setPanorama('pano2');
      expect(viewer.setPano).toHaveBeenCalledWith('pano2');
      expect(data.getPanoId()).toBe('pano2');
      expect(onPano).toHaveBeenCalledWith(data);
      expect(panoStore.addPanoMetadata).toHaveBeenCalledWith('pano2', data);
    });

    it('to a pano that will not load, logging which', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const manager = await load();
      const error = new Error('gone');
      viewer.setPano.mockImplementation(() => Promise.reject(error));
      await expect(manager.setPanorama('pano9')).rejects.toBe(error);
      expect(tracker.push).toHaveBeenCalledWith('PanoId_NotFound', { TargetPanoId: 'pano9' });
    });

    it('to a place, skipping the panos it is told to', async () => {
      const manager = await load();
      const excluded = new Set([viewer.currPanoData]);
      const data = await manager.setLocation(END, excluded);
      expect(viewer.setLocation).toHaveBeenCalledWith(END, excluded);
      expect(data.getPanoId()).toBe('pano3');
      await manager.setLocation(END);
      expect(viewer.setLocation).toHaveBeenLastCalledWith(END, new Set());
    });
  });

  describe('turning the view', () => {
    let manager;

    beforeEach(async () => {
      manager = await load();
      pov = { heading: 10, pitch: -5, zoom: 2 };
    });

    it('to a zoom, keeping the rest', () => {
      manager.setZoom(3);
      expect(pov).toEqual({ heading: 10, pitch: -5, zoom: 3 });
      expect(manager.getPov()).toEqual(pov);
    });

    it('to a heading, rounded and wrapped, keeping the rest', () => {
      manager.turnTo(-30);
      expect(pov).toEqual({ heading: 330, pitch: -5, zoom: 2 });
      manager.turnTo(405.6);
      expect(pov.heading).toBe(46);
    });

    it('by a drag, scaled, and not above the horizon or into the ground', () => {
      manager.updatePov(8, 8);
      expect(pov).toEqual({ heading: 7, pitch: -2, zoom: 2 });
      manager.updatePov(0, 100);
      expect(pov.pitch).toBe(0);
      manager.updatePov(0, -200);
      expect(pov.pitch).toBe(-35);
    });

    it('not by a drag before the first pano is up', () => {
      pov = null;
      manager.updatePov(8, 8);
      expect(viewer.setPov).not.toHaveBeenCalledWith(expect.objectContaining({ heading: 7 }));
    });

    it('within a heading range, to its nearer edge', () => {
      manager.setHeadingRange({ min: 30, max: 90 });
      manager.turnTo(100);
      expect(pov.heading).toBe(90);
      manager.turnTo(10);
      expect(pov.heading).toBe(30);
      manager.turnTo(50);
      expect(pov.heading).toBe(50);
    });

    it('within a heading range that wraps past north', () => {
      manager.setHeadingRange({ min: 300, max: 60 });
      manager.turnTo(100);
      expect(pov.heading).toBe(60);
      manager.turnTo(250);
      expect(pov.heading).toBe(300);
      // Halfway between the edges, the range's start wins.
      manager.turnTo(180);
      expect(pov.heading).toBe(300);
      manager.turnTo(30);
      expect(pov.heading).toBe(30);
      manager.turnTo(330);
      expect(pov.heading).toBe(330);
    });

    it('smoothly over a duration, the short way round, landing exactly on the target', () => {
      vi.useFakeTimers();
      const done = vi.fn();
      const onPov = vi.fn();
      manager.onPovChanged(onPov);
      pov = { heading: 0, pitch: 0, zoom: 2 };
      viewer.setPov.mockClear();
      tracker.push.mockClear();
      manager.setPov({ heading: 90, pitch: -10, zoom: undefined }, 100, done);
      expect(viewer.setPov).not.toHaveBeenCalled();
      vi.advanceTimersByTime(25);
      expect(pov).toEqual({ heading: 22.5, pitch: -2.5, zoom: 2 });
      expect(onPov).toHaveBeenLastCalledWith(22.5);
      vi.advanceTimersByTime(75);
      expect(done).not.toHaveBeenCalled();
      vi.advanceTimersByTime(25);
      expect(pov).toEqual({ heading: 90, pitch: -10, zoom: 1 });
      expect(done).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(done).toHaveBeenCalledTimes(1);
      // Four steps on the way and the landing, each logged as a view change.
      expect(tracker.push.mock.calls.filter(([event]) => event === 'POV_Changed')).toHaveLength(5);
    });

    it('turns the other way when that is shorter', () => {
      vi.useFakeTimers();
      pov = { heading: 0, pitch: 0, zoom: 1 };
      manager.setPov({ heading: 270, pitch: 0, zoom: 1 }, 100);
      vi.advanceTimersByTime(25);
      expect(pov.heading).toBe(337.5);
      vi.advanceTimersByTime(100);
      expect(pov).toEqual({ heading: 270, pitch: 0, zoom: 1 });
    });

    it('jumps straight there before the first pano, with nothing to animate from', () => {
      vi.useFakeTimers();
      pov = null;
      manager.setPov({ heading: 90, pitch: 0, zoom: 1 }, 100);
      expect(pov).toEqual({ heading: 90, pitch: 0, zoom: 1 });
    });
  });
});
