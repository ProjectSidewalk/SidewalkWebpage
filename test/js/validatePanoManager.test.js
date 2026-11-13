/**
 * Validate's PanoManager (frontend/js/validate/panorama/PanoManager.js) beyond the load choreography its sibling
 * suites pin: the phone layout, the Google attribution links, the capture date, the marker's size, name and AI
 * badge across labels and viewer swaps, the Pannellum fallback's logging, and the small pass-throughs other modules
 * lean on. Fake viewers stand in for every imagery SDK, so nothing here builds a billable pano (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker, fakePanoOverlays } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en' } }));

/** @type {object} The viewer the next primary or fallback `create` hands back. */
let nextPrimary;
let nextPannellum;

/** Stands in for GsvViewer, which PanoManager compares its viewer class against to decide on the link fix-up. */
class FakeGsvViewer {
  static SOURCE = 'gsv';
  /** @returns {Promise<object>} The viewer the test set up. */
  static create() { return Promise.resolve(nextPrimary); }
}

/** A non-Google primary viewer class. */
class FakeViewerType {
  static SOURCE = 'infra3d';
  /** @returns {Promise<object>} The viewer the test set up. */
  static create() { return Promise.resolve(nextPrimary); }
}

/** A primary viewer class that draws a new pano before its load resolves, as Mapillary does. */
class FakePaintingViewerType extends FakeViewerType {
  static PAINTS_DURING_LOAD = true;
}

/** Stands in for PannellumViewer, which PanoManager builds itself the first time a label needs its fallback. */
class FakePannellumViewer {
  /** @type {import('vitest').Mock} Answers with the fallback viewer the test set up; replaced per test. */
  static create;
}

mockModule('frontend/js/common/pano-viewer/GsvViewer.js', () => ({ GsvViewer: FakeGsvViewer }));
mockModule('frontend/js/common/pano-viewer/PannellumViewer.js', () => ({ PannellumViewer: FakePannellumViewer }));

/**
 * @param {string} panoId - What the pano reports as its id.
 * @param {Date} [captureDate] - When it was taken.
 * @returns {object} A PanoData with the two things PanoManager reads off it.
 */
function panoData(panoId, captureDate = new Date(2024, 4, 15)) {
  return { getPanoId: () => panoId, getProperty: (key) => (key === 'captureDate' ? captureDate : undefined) };
}

/**
 * A viewer that loads whatever it is asked, keeps a POV, and lets a test fire the events it subscribes to.
 * @param {string} [type] - What getViewerType answers.
 * @returns {object} The viewer, with `fire(event, ...args)` to raise one of its events.
 */
function fakeViewer(type = 'gsv') {
  const listeners = {};
  let pov = { heading: 0, pitch: 0, zoom: 1 };
  return {
    setPano: vi.fn((id) => Promise.resolve(panoData(id))),
    loadPano: vi.fn(() => Promise.resolve()),
    prefetchPano: vi.fn(),
    addListener: vi.fn((event, callback) => { (listeners[event] ??= []).push(callback); }),
    removeListener: vi.fn(),
    resize: vi.fn(),
    setPov: vi.fn((next) => { pov = { ...next }; }),
    getPov: () => ({ ...pov }),
    getViewerType: () => type,
    fire: (event, ...args) => (listeners[event] ?? []).forEach((callback) => callback(...args)),
  };
}

/**
 * A validate Label with the surface renderPanoMarker and styleMarkerForLabel read.
 * @param {object} [overrides] - Audit properties to change, e.g. `{ aiGenerated: true }`.
 * @returns {object} The label.
 */
function makeLabel(overrides = {}) {
  const audit = { heading: 30, pitch: -5, zoom: 2, aiGenerated: false, labelType: 'CurbRamp', ...overrides };
  return {
    getOriginalPov: () => ({ heading: 50, pitch: -10, zoom: 1 }),
    getAuditProperty: (key) => audit[key],
    getProperty: (key) => (key === 'newLabelType' ? audit.labelType : undefined),
    getIconUrl: () => '/assets/images/icons/label_type_icons/CurbRamp_small.svg',
    getIconColor: () => 'var(--color-curb-ramp)',
  };
}

describe('Validate PanoManager', () => {
  let tracker;
  let overlays;
  let dateEl;
  let controlLayer;
  let panoImageCache;
  let primary;
  let pannellum;

  beforeEach(() => {
    // Cut down from validate.scala.html / mobileValidate.scala.html: the pano holder and its layers.
    document.body.innerHTML = `
      <div id="svv-panorama-holder">
        <div id="svv-panorama"></div>
        <div id="view-control-layer"></div>
        <span id="svv-panorama-date"></span>
      </div>`;
    dateEl = document.getElementById('svv-panorama-date');
    controlLayer = document.getElementById('view-control-layer');
    // jsdom has no WebGL, so PanoMarker takes its 2d projection; null is what jsdom effectively answers.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    tracker = fakeTracker();
    overlays = fakePanoOverlays();
    panoImageCache = { prefetchBackups: vi.fn() };
    primary = fakeViewer();
    pannellum = fakeViewer('pannellum');
    pannellum.currPanoData = panoData('backup-pano');
    nextPrimary = primary;
    nextPannellum = pannellum;
    FakePannellumViewer.create = vi.fn(() => Promise.resolve(nextPannellum));
  });

  /**
   * Builds the manager the way Main.js does.
   * @param {{viewerType?: Function, mobile?: boolean}} [options] - The primary viewer class, and whether this is
   *   the phone layout of the page.
   * @returns {Promise<object>} The PanoManager.
   */
  async function build({ viewerType = FakeViewerType, mobile = false } = {}) {
    useUtil({ isMobile: () => mobile });
    const { PanoManager } = await loadModules('frontend/js/validate/panorama/PanoManager.js');
    return PanoManager.create('token', { date: dateEl, controlLayer }, { viewerType, labelRadius: 10 },
      { addPanoMetadata: vi.fn() }, panoImageCache, tracker);
  }

  /** @returns {?HTMLElement} The label marker on screen. */
  const marker = () => document.getElementById('validate-pano-marker');

  describe('on desktop', () => {
    it('shows the capture month and year of the pano it loaded', async () => {
      const manager = await build();
      await manager.setPanorama('p1');
      expect(dateEl.textContent).toBe('May 2024');
    });

    it('shows no date for a pano whose capture date the provider did not give', async () => {
      primary.setPano = vi.fn((id) => Promise.resolve(panoData(id, new Date(NaN))));
      const manager = await build();
      dateEl.textContent = 'Jan 2020';
      await manager.setPanorama('p1');
      expect(dateEl.textContent).toBe('');
    });

    it('aims at the view the labeler had when they placed the label', async () => {
      const manager = await build();
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      expect(manager.getPov()).toEqual({ heading: 30, pitch: -5, zoom: 2 });
    });

    it('logs what the viewer reports going wrong inside it', async () => {
      await build();
      primary.fire('diagnostic', 'WebGLContextLost', { panoId: 'p1' });
      expect(tracker.push).toHaveBeenCalledWith('PanoViewer_WebGLContextLost', { panoId: 'p1' });
    });

    it('changes only the zoom when asked to zoom', async () => {
      const manager = await build();
      primary.setPov({ heading: 120, pitch: 4, zoom: 1 });
      manager.setZoom(2.5);
      expect(manager.getPov()).toEqual({ heading: 120, pitch: 4, zoom: 2.5 });
    });

    it('passes the upcoming labels\' backup panos on to be downloaded ahead of time', async () => {
      const manager = await build();
      manager.prefetchBackups([{ pano_id: 'b1' }]);
      expect(panoImageCache.prefetchBackups).toHaveBeenCalledWith([{ pano_id: 'b1' }]);
    });
  });

  describe('on a phone', () => {
    beforeEach(() => {
      document.getElementById('svv-panorama-holder').getBoundingClientRect = () => ({ top: 60 });
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(800);
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(390);
    });

    it('fills the screen below the header with the pano and every layer over it', async () => {
      await build({ mobile: true });
      const holder = document.getElementById('svv-panorama-holder');
      for (const el of [holder, controlLayer, document.getElementById('svv-panorama'),
        document.getElementById('svv-panorama-pannellum')]) {
        expect([el.style.width, el.style.height]).toEqual(['390px', '740px']);
      }
      expect(primary.resize).toHaveBeenCalled();
    });

    it('redraws the marker against the new size after a rotation', async () => {
      const manager = await build({ mobile: true });
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      const drawn = vi.fn();
      manager.onMarkerDrawn(drawn);
      manager.sizePano();
      expect(drawn).toHaveBeenCalled();
    });

    it('centers the label itself rather than the labeler\'s view, and leaves out the capture date', async () => {
      const manager = await build({ mobile: true });
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      expect(manager.getPov()).toEqual({ heading: 50, pitch: -10, zoom: 1 });
      expect(dateEl.textContent).toBe('');
    });
  });

  describe('Google Street View\'s own links', () => {
    /** @type {() => void} What Google calls when it redraws the pano's links. */
    let linksChanged;
    /** @type {import('vitest').Mock} The stubbed google.maps.event.removeListener. */
    let removeListener;

    beforeEach(() => {
      removeListener = vi.fn();
      vi.stubGlobal('google', { maps: { event: { removeListener } } });
      primary.gsvPano = {
        addListener: vi.fn((event, callback) => {
          linksChanged = callback;
          return 'links-listener';
        }),
      };
    });

    /**
     * Puts Google's bottom-right link row in the pano, the way the SDK renders it: each link a `.gm-style-cc` whose
     * first child is a spacer, each in its own wrapper inside the row.
     * @param {number} count - How many links the row has.
     * @returns {HTMLElement} The row.
     */
    function googleLinks(count) {
      const row = document.createElement('div');
      row.className = 'gmnoprint';
      row.innerHTML = Array.from({ length: count }, (_, i) => `
        <div><div class="gm-style-cc"><div class="spacer"></div><a id="gsv-link-${i}">Link ${i}</a></div></div>`)
        .join('');
      document.getElementById('svv-panorama').append(row);
      return row;
    }

    it('lifts the links above the label layer so they can be clicked, minus the keyboard shortcuts link', async () => {
      const row = googleLinks(4);
      await build({ viewerType: FakeGsvViewer });
      expect(row.parentElement).toBe(controlLayer);
      expect(document.getElementById('gsv-link-0')).toBeNull();
      expect(row.querySelectorAll('.spacer')).toHaveLength(0);
      expect(row.querySelectorAll('a')).toHaveLength(3);
    });

    it('waits for Google to draw the links, then stops listening once they are moved', async () => {
      await build({ viewerType: FakeGsvViewer });
      const row = googleLinks(4);
      linksChanged();
      expect(row.parentElement).toBe(controlLayer);
      expect(removeListener).toHaveBeenLastCalledWith('links-listener');

      // A later links change finds them already moved and leaves them alone.
      const extra = googleLinks(4);
      linksChanged();
      expect(extra.parentElement.id).toBe('svv-panorama');
      expect(extra.querySelectorAll('a')).toHaveLength(4);
    });

    it('does not touch the links on the phone, which has no label layer over them', async () => {
      const row = googleLinks(4);
      await build({ viewerType: FakeGsvViewer, mobile: true });
      expect(row.parentElement.id).toBe('svv-panorama');
      expect(primary.gsvPano.addListener).not.toHaveBeenCalled();
    });
  });

  describe('the label marker', () => {
    it('is named as the label\'s type and sized from the label radius, capped as the UI scales up', async () => {
      const manager = await build();
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      expect(manager.getPanoMarker().marker_).toBe(marker());
      expect(marker().getAttribute('aria-label')).toBe('common:curb-ramp');
      expect(marker().style.width).toBe('22px');

      manager.setMarkerScale(1.5);
      expect(marker().style.width).toBe('33px');
      manager.setMarkerScale(1.8);
      expect(marker().style.width).toBe('38px');
    });

    it('carries the AI badge only while the label on screen was made by AI', async () => {
      const manager = await build();
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel({ aiGenerated: true }));
      await manager.renderPanoMarker(makeLabel({ aiGenerated: true }));
      expect(marker().querySelectorAll('.ai-icon-marker-validate')).toHaveLength(1);

      await manager.renderPanoMarker(makeLabel({ aiGenerated: false }));
      expect(marker().querySelector('.ai-icon-marker-validate')).toBeNull();
    });

    it('is rebuilt on the fallback viewer when a label\'s imagery is gone, and told to who wires it up', async () => {
      const created = vi.fn((panoMarker) => panoMarker.marker_);
      const manager = await build();
      manager.onMarkerCreated(created);
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      const first = marker();
      expect(manager.getActiveViewerName()).toBe('Default');

      primary.setPano = vi.fn(() => Promise.reject(new Error('gone')));
      await manager.setPanorama('p2', { pano_id: 'backup-pano', camera_heading: 90 });
      await manager.renderPanoMarker(makeLabel());
      expect(manager.getActiveViewerName()).toBe('Pannellum');
      expect(first.isConnected).toBe(false);
      expect(marker()).not.toBe(first);
      expect(created.mock.results.map((result) => result.value)).toEqual([first, marker()]);
      expect(primary.removeListener).toHaveBeenCalledWith('pov_changed', expect.any(Function));
    });

    it('is left alone by a resize or a type pick when a failed load has taken it down', async () => {
      const manager = await build();
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      primary.setPano = vi.fn(() => Promise.reject(new Error('gone')));
      await manager.setPanorama('p2');
      expect(marker()).toBeNull();
      expect(() => {
        manager.setMarkerScale(1.2);
        manager.styleMarkerForLabel(makeLabel({ labelType: 'Obstacle' }));
        manager.replayMarkerPulse();
      }).not.toThrow();
      expect(manager.getPanoMarker()).toBeNull();
    });

    it('skips the held-back pulse when the marker is gone by the time the tutorial closes', async () => {
      const overlay = document.createElement('div');
      overlay.className = 'mission-start-tutorial-overlay';
      document.body.append(overlay);
      const manager = await build();
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      manager.replayMarkerPulse();

      primary.setPano = vi.fn(() => Promise.reject(new Error('gone')));
      await manager.setPanorama('p2');
      expect(() => document.dispatchEvent(new Event('ps:mission-start-tutorial:done'))).not.toThrow();
    });
  });

  describe('the Pannellum fallback', () => {
    beforeEach(() => {
      primary.setPano = vi.fn(() => Promise.reject(new Error('gone')));
    });

    it('opens facing north when the backup does not say where the camera faced', async () => {
      const manager = await build();
      await manager.setPanorama('p1', { pano_id: 'backup-pano' });
      expect(FakePannellumViewer.create.mock.calls.at(-1)[1]).toMatchObject({ startHeading: 0, startPitch: 0 });
    });

    it('shows no credit line for a backup with no attribution', async () => {
      const manager = await build();
      await manager.setPanorama('p1', { pano_id: 'backup-pano' });
      expect(overlays.attribution.show).toHaveBeenLastCalledWith(null);
    });

    it('logs whether the backup image was already downloaded, when the viewer can tell', async () => {
      const manager = await build();
      await manager.setPanorama('p1', { pano_id: 'backup-pano' });
      expect(tracker.push).not.toHaveBeenCalledWith('PanoPrefetch', expect.anything());

      pannellum.lastLoadPrefetched = true;
      await manager.setPanorama('p2', { pano_id: 'backup-2' });
      expect(pannellum.loadPano).toHaveBeenCalledWith('backup-2', { pano_id: 'backup-2' },
        { heading: 0, pitch: 0, zoom: 1 });
      expect(tracker.push).toHaveBeenCalledWith('PanoPrefetch', { hit: true });
    });
  });

  describe('whether a load leaves the pano area blank', () => {
    it('does not while the last pano stays up', async () => {
      const manager = await build();
      await manager.setPanorama('p1');
      expect(manager.blanksPanoWhileLoading()).toBe(false);
    });

    it('does once a failed load has emptied the pano area', async () => {
      primary.setPano = vi.fn(() => Promise.reject(new Error('gone')));
      const manager = await build();
      await manager.setPanorama('p1');
      expect(manager.blanksPanoWhileLoading()).toBe(true);
    });

    it('always does on a viewer that paints mid-load, whose canvas is held blank for the load', async () => {
      const manager = await build({ viewerType: FakePaintingViewerType });
      await manager.setPanorama('p1');
      await manager.renderPanoMarker(makeLabel());
      expect(manager.blanksPanoWhileLoading()).toBe(true);
    });
  });

  it('reveals a held-back canvas when the first label\'s render fails before its marker is drawn', async () => {
    const manager = await build({ viewerType: FakePaintingViewerType });
    await manager.setPanorama('p1');
    const canvas = document.getElementById('svv-panorama');
    expect(canvas.style.visibility).toBe('hidden');
    manager.revealPendingCanvas();
    expect(canvas.style.visibility).toBe('');
    expect(marker()).toBeNull();
  });

  it('leaves a canvas already on screen alone when a failed render asks for the held-back reveal', async () => {
    const manager = await build();
    await manager.setPanorama('p1');
    const canvas = document.getElementById('svv-panorama');
    manager.revealPendingCanvas();
    expect([canvas.style.display, canvas.style.visibility]).toEqual(['', '']);
  });
});
