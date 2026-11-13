/**
 * The life of a label in LabelContainer (#5840): who is told when one is placed or removed, when it may be deleted,
 * what a click on its minimap marker does, which labels the canvas gets for the pano on screen, and how labels fetched
 * to resume a mission are rebuilt into the frame the tool is displaying now.
 *
 * Real Label and util.pano: the resumed label's projection is part of what is checked.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const FRAME = { width: 720, height: 480, iconRadius: 17, renderedHFov: () => 90 };
const POV = { heading: 90, pitch: -10, zoom: 1 };

/** Stands in for a marker made by Minimap.addMarker, keeping the click handler where a test can press it. */
class FakeMarker {
  constructor(latLng, content, { onClick = null } = {}) {
    Object.assign(this, { latLng, content, onClick, visible: true });
    this.element = document.createElement('div');
  }

  setVisible(visible) {
    this.visible = visible;
  }

  setTitle() {}

  setClickable() {}

  setZIndex() {}

  remove() {}
}

describe('LabelContainer', () => {
  let container;
  let tracker;
  let overallStats;
  let storage;
  let config;
  let currentMissionId;
  let panoId;

  /** Params as a placement or a resumed label hands them over: panoXY present, so no pano store lookup. */
  const params = (overrides = {}) => ({
    labelType: 'CurbRamp', temporaryLabelId: 1, missionId: 10, panoId: 'pano-a', panoXY: { x: 10, y: 20 },
    povOfLabelIfCentered: POV, panoLat: 47.6553, panoLng: -122.3035, labelLat: 47.6554, labelLng: -122.3036,
    ...overrides,
  });

  beforeEach(async () => {
    const { LabelContainer } = await loadModules('frontend/js/explore/label/LabelContainer.js');
    tracker = fakeTracker();
    overallStats = { incrementLabelCount: vi.fn(), decrementLabelCount: vi.fn() };
    storage = { get: vi.fn(() => null), set: vi.fn() };
    config = { isOnboarding: false, latLngEstimation: {} };
    currentMissionId = 10;
    panoId = 'pano-a';
    const panoManager = {
      getPanoId: () => panoId,
      getPov: () => POV,
      panoViewer: { getViewerType: () => 'gsv' },
    };
    const missionContainer = { getCurrentMission: () => ({ getProperty: () => currentMissionId }), on: vi.fn() };
    container = new LabelContainer(1, config, FRAME, {},
      { addMarker: (latLng, content, options) => new FakeMarker(latLng, content, options) },
      missionContainer, panoManager, storage, overallStats, tracker);
  });

  describe('placing a label', () => {
    it('counts it, files it, remembers it as the latest, and tells the canvas', () => {
      const placed = vi.fn();
      container.onLabelPlaced(placed);

      const label = container.createLabel(params(), true);

      expect(placed).toHaveBeenCalledWith(label);
      expect(overallStats.incrementLabelCount).toHaveBeenCalledTimes(1);
      expect(container.getLatestLabel()).toBe(label);
      expect(container.getLabelsToLog()).toEqual([label]);
      expect(label.getProperty('temporaryLabelId')).toBe(1);
      expect(container.createLabel(params(), true).getProperty('temporaryLabelId')).toBe(2);
    });

    it('files a label once however many edits it takes', () => {
      const label = container.createLabel(params(), true);

      label.edit({ severity: 2 });
      label.edit({ severity: 3 });

      expect(container.getLabelsToLog()).toEqual([label]);
    });

    it('restores a label without counting it or telling the canvas', () => {
      const placed = vi.fn();
      container.onLabelPlaced(placed);

      container.createLabel(params({ temporaryLabelId: 5 }), false);

      expect(placed).not.toHaveBeenCalled();
      expect(overallStats.incrementLabelCount).not.toHaveBeenCalled();
      expect(container.getLatestLabel()).toBeNull();
    });
  });

  describe('the canvas\'s labels', () => {
    it('are the ones on the pano now showing, and none on a pano without any', () => {
      const here = container.createLabel(params({ panoId: 'pano-a' }), true);
      container.createLabel(params({ panoId: 'pano-b', temporaryLabelId: 2 }), true);

      expect(container.getCanvasLabels()).toEqual([here]);
      panoId = 'pano-c';
      expect(container.getCanvasLabels()).toEqual([]);
      expect(container.countLabels()).toBe(2);
    });
  });

  describe('removing a label', () => {
    it('is refused while deleting is held, and for no label at all', () => {
      const label = container.createLabel(params(), true);
      container.deleting.hold('tutorial');

      expect(container.canDelete(label)).toBe(false);
      expect(container.removeLabel(label)).toBe(false);
      expect(label.isDeleted()).toBe(false);
      container.deleting.release('tutorial');
      expect(container.canDelete(null)).toBe(false);
    });

    it('is allowed in the tutorial only for the label just placed', () => {
      config.isOnboarding = true;
      const earlier = container.createLabel(params(), true);
      const latest = container.createLabel(params({ temporaryLabelId: 2 }), true);

      expect(container.canDelete(earlier)).toBe(false);
      expect(container.canDelete(latest)).toBe(true);
    });

    it('hides the label, uncounts it, files the deletion, logs it, and tells the listeners until they leave', () => {
      const label = container.createLabel(params(), true);
      container.clearLabelsToLog();
      const removed = vi.fn();
      const stop = container.onLabelRemoved(removed);

      expect(container.removeLabel(label)).toBe(true);

      expect(label.isDeleted()).toBe(true);
      expect(overallStats.decrementLabelCount).toHaveBeenCalledTimes(1);
      expect(container.getLabelsToLog()).toEqual([label]);
      expect(tracker.push).toHaveBeenCalledWith('RemoveLabel', { labelType: 'CurbRamp' }, label);
      expect(removed).toHaveBeenCalledWith(label);
      expect(container.countLabels()).toBe(0);
      expect(container.countLabelsByMinimapEra()).toEqual({ current: 0, prior: 0, outdated: 0 });

      stop();
      container.removeLabel(container.createLabel(params({ temporaryLabelId: 2 }), true));
      expect(removed).toHaveBeenCalledTimes(1);
    });
  });

  describe('a click on a label\'s minimap marker', () => {
    it('returns to a label of the current mission, and says so', () => {
      const clicked = vi.fn();
      container.onMarkerClick(clicked);
      const label = container.createLabel(params({ labelId: 77 }), true);

      label.getMinimapMarker().onClick();

      expect(tracker.push).toHaveBeenCalledWith('Click_MinimapLabelMarker', { labelId: 77, panoId: 'pano-a' });
      expect(clicked).toHaveBeenCalledWith(label);
    });

    it('does nothing in the tutorial, or for a label from another mission', () => {
      const clicked = vi.fn();
      container.onMarkerClick(clicked);
      const label = container.createLabel(params(), true);
      const earlier = container.createLabel(params({ missionId: 9, temporaryLabelId: 2 }), false);

      earlier.getMinimapMarker().onClick();
      config.isOnboarding = true;
      label.getMinimapMarker().onClick();

      expect(clicked).not.toHaveBeenCalled();
      expect(tracker.push).not.toHaveBeenCalled();
    });
  });

  describe('resuming a mission', () => {
    /** A label as /label/resumeMission returns it, clicked at the canvas center in the given frame. */
    const served = (overrides = {}) => ({
      labelType: 'CurbRamp', temporaryLabelId: 3, missionId: 9, panoId: 'pano-a', panoX: 100, panoY: 200,
      originalPov: { heading: 45, pitch: -5, zoom: 2 }, canvasX: 360, canvasY: 240, canvasWidth: 720,
      canvasHeight: 480, labelLat: 47.6554, labelLng: -122.3036, ...overrides,
    });

    it('rebuilds each label in the frame it was clicked in, hover card hidden, and logs the eras found', async () => {
      const callback = vi.fn();
      const payload = { labels: [served(), served({ temporaryLabelId: 4, missionId: 10, fromOutdatedImagery: true })] };
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => payload })));

      container.fetchLabelsToResumeMission(7, null, callback);
      await new Promise((resolve) => { setTimeout(resolve, 0); });

      const [prior, current] = container.getAllLabels();
      expect(prior.getHoverInfoVisibility()).toBe('hidden');
      expect(prior.getProperty('originalCanvasXY')).toEqual({ x: 360, y: 240 });
      expect(prior.getProperty('panoXY')).toEqual({ x: 100, y: 200 });
      // A click at the canvas center is the pano's own POV, whatever frame it was made in.
      expect(prior.getProperty('povOfLabelIfCentered').heading).toBeCloseTo(45, 6);
      expect(prior.getProperty('povOfLabelIfCentered').pitch).toBeCloseTo(-5, 6);
      expect(prior.getProperty('currCanvasXY')).toBeTruthy();
      expect(current.getMinimapEra()).toBe('current');
      expect(tracker.push).toHaveBeenCalledWith('MinimapEarlierLabels_Loaded', { current: 1, prior: 1, outdated: 0 });
      expect(callback).toHaveBeenCalledWith(payload);
      expect(container.getLabelsToLog()).toEqual([]);
    });

    it('reads a label stored before frames were recorded as clicked in the boxed canvas', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({ labels: [served({ canvasWidth: undefined, canvasHeight: undefined })] }),
      })));

      container.fetchLabelsToResumeMission(7, null);
      await new Promise((resolve) => { setTimeout(resolve, 0); });

      expect(container.getAllLabels()[0].getProperty('originalCanvasFrame')).toEqual({ width: 720, height: 480 });
    });

    it('hides the earlier passes\' markers straight away when the labeler asked for that before', async () => {
      storage.get.mockReturnValue(false);
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ labels: [served()] }) })));
      const shown = vi.fn();
      container.onEarlierLabelsShownChanged(shown);

      container.fetchLabelsToResumeMission(7, null);
      await new Promise((resolve) => { setTimeout(resolve, 0); });

      expect(container.getAllLabels()[0].getMinimapMarker().visible).toBe(false);
      expect(shown).toHaveBeenCalledWith(false);
    });
  });

  it('logs showing the earlier labels again, with how many there were to show', () => {
    container.createLabel(params({ missionId: 9 }), false);

    container.setEarlierLabelsShown(true);

    expect(tracker.push).toHaveBeenCalledWith('Click_MinimapEarlierLabels_Show', { prior: 1, outdated: 0 });
    expect(storage.set).toHaveBeenCalledWith('minimapShowEarlierLabels', true);
  });
});
