/**
 * A label's own state and the icon work around it (#5840): what a freshly placed label takes from its pano, the
 * status reads and writes the canvas and the tutorial make, a label drawn off the edge of the view, the one-time
 * rasterizing of the label-type icons, and the cursor built from them.
 *
 * jsdom has no canvas, so the raster and cursor tests stand in a 2D context and an Image that loads on demand.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { makeRecordingCtx } from './canvasCtxStub.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const POV = { heading: 90, pitch: -20, zoom: 1 };
const FRAME = { width: 720, height: 480, iconRadius: 17, hitMargin: 15, renderedHFov: () => 90 };

describe('Label state', () => {
  let Label;
  let util;

  /** A placed label with a cached lat/lng, so nothing here reaches the estimator or the minimap. */
  function newLabel(params = {}) {
    return new Label({
      labelType: 'CurbRamp', severity: 1, temporaryLabelId: 1, panoId: 'pano-a', panoXY: { x: 10, y: 20 },
      povOfLabelIfCentered: POV, labelLat: 47.6554, labelLng: -122.3034, ...params,
    }, FRAME, {}, {});
  }

  beforeEach(async () => {
    ({ Label, util } = await loadModules('frontend/js/explore/label/Label.js', 'frontend/js/common/utilities.js'));
    window.labelIconCache = {};
  });

  describe('a label just placed', () => {
    const pano = { width: 8192, height: 4096, cameraHeading: 163.2, lat: 41.87, lng: -87.62 };

    it('takes its pano\'s size, heading and position, and projects itself onto the pano', () => {
      const panoStore = { getPanoData: vi.fn(() => ({ getProperties: () => pano })) };

      const label = new Label({ labelType: 'CurbRamp', panoId: 'pano-a', povOfLabelIfCentered: POV }, FRAME, {},
        panoStore);

      expect(panoStore.getPanoData).toHaveBeenCalledWith('pano-a');
      expect(label.getProperty('panoWidth')).toBe(8192);
      expect(label.getProperty('panoHeight')).toBe(4096);
      expect(label.getProperty('cameraHeading')).toBe(163.2);
      expect(label.getProperty('panoLat')).toBe(41.87);
      expect(label.getProperty('panoLng')).toBe(-87.62);
      expect(label.getProperty('panoXY')).toEqual(util.pano.povToPanoCoord(POV, 163.2, 8192, 4096));
    });

    it('ignores a parameter it has no property for', () => {
      const label = newLabel({ noSuchThing: 1 });

      expect(label.getProperty('noSuchThing')).toBe(false);
      expect(label.getProperties()).not.toHaveProperty('noSuchThing');
    });
  });

  describe('reads', () => {
    it('answers the plain getters from its properties, and hands out a copy of them', () => {
      const label = newLabel({ labelId: 42 });

      expect(label.getLabelId()).toBe(42);
      expect(label.getLabelType()).toBe('CurbRamp');
      expect(label.getPanoId()).toBe('pano-a');
      expect(label.getCanvasXY()).toBeUndefined();
      const copy = label.getProperties();
      copy.tagIds.push(9);
      expect(label.getProperty('tagIds')).toEqual([]);
    });

    it('starts visible, with its hover card showing, and not deleted', () => {
      const label = newLabel();

      expect(label.isVisible()).toBe(true);
      expect(label.getStatus('visibility')).toBe('visible');
      expect(label.getHoverInfoVisibility()).toBe('visible');
      expect(label.isDeleted()).toBe(false);
    });
  });

  describe('status writes', () => {
    it('take only the values each status allows', () => {
      const label = newLabel();

      label.setStatus('visibility', 'invisible');
      expect(label.isVisible()).toBe(true);
      label.setStatus('visibility', 'hidden');
      expect(label.isVisible()).toBe(false);

      label.setStatus('hoverInfoVisibility', 'hidden');
      expect(label.getHoverInfoVisibility()).toBe('hidden');
      expect(label.setHoverInfoVisibility('sometimes')).toBe(label);
      expect(label.getHoverInfoVisibility()).toBe('hidden');

      label.setStatus('deleted', 'yes');
      expect(label.isDeleted()).toBe(false);
      label.setStatus('noSuchStatus', true);
      expect(label.getStatus('noSuchStatus')).toBeUndefined();
    });
  });

  describe('render', () => {
    it('draws nothing for a label outside the view, but keeps its minimap marker on', () => {
      useUtil({ pano: { centeredPovToCanvasCoord: () => null } });
      const marker = { setVisible: vi.fn(), setTitle() {}, setClickable() {}, setZIndex() {} };
      const label = newLabel();
      label.placeOnMinimap({ addMarker: (latLng, content) => Object.assign(marker, { content }) }, null, () => {});
      const ctx = makeRecordingCtx();

      label.render(ctx, POV);

      expect(ctx.alphas).toEqual([]);
      expect(label.getCanvasXY()).toBeNull();
      expect(label.isOn(10, 10)).toBeFalsy();
      expect(marker.setVisible).toHaveBeenLastCalledWith(true);
    });

    it('draws only the rings while the icon raster is not ready', () => {
      const ctx = makeRecordingCtx();

      Label.renderLabelIcon(ctx, 'CurbRamp', 100, 100, 17);

      expect(ctx.images).toEqual([]);
      expect(ctx.arcs).toHaveLength(2);
    });
  });

  describe('without a minimap marker', () => {
    it('takes an era change and the legend toggle without complaint', () => {
      const label = newLabel({ missionId: 3 });

      expect(() => label.refreshMinimapEra(4)).not.toThrow();
      expect(label.getMinimapEra()).toBe('prior');
      expect(() => label.setMinimapMarkerSuppressed(true)).not.toThrow();
      expect(label.isMinimapMarkerSuppressed()).toBe(true);
      expect(label.getMinimapMarker()).toBeNull();
    });
  });

  describe('icons', () => {
    let drawn;
    let failing;

    /** An Image that loads (or fails, for `failing` sources) as soon as it is given a source. */
    class FakeImage {
      set src(value) {
        this.source = value;
        queueMicrotask(() => (failing.has(value) ? this.onerror() : this.onload()));
      }
    }

    beforeEach(() => {
      drawn = [];
      failing = new Set();
      vi.stubGlobal('Image', FakeImage);
      vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
        return { drawImage: (image, ...rest) => drawn.push({ canvas: this, image, rest }) };
      });
      vi.spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,x');
    });

    const iconPath = (labelType) => util.misc.getIconImagePaths(labelType).iconImagePath;

    it('rasterizes every label type once, sized so the raster is always downscaled', async () => {
      window.labelIconCache[iconPath('Obstacle')] = 'already-cached';

      await Label.preloadIcons();

      const types = Object.keys(util.misc.getIconImagePaths()).filter((type) => type !== 'Walk');
      for (const type of types) expect(window.labelIconCache[iconPath(type)]).toBeTruthy();
      expect(window.labelIconCache[iconPath('Obstacle')]).toBe('already-cached');
      expect(drawn).toHaveLength(types.length - 1);
      const [first] = drawn;
      expect(first.canvas.width).toBe(128);
      expect(first.image.width).toBe(128);
      expect(first.rest).toEqual([0, 0, 128, 128]);
    });

    it('lets one icon that fails to load go, so the rest still draw', async () => {
      failing.add(iconPath('CurbRamp'));

      await Label.preloadIcons();

      expect(window.labelIconCache[iconPath('CurbRamp')]).toBeUndefined();
      expect(window.labelIconCache[iconPath('Obstacle')]).toBeTruthy();
    });

    it('builds the labeling cursor from the raster, once, and has none for Walk mode', async () => {
      expect(Label.getCursorImageUrl('Walk')).toBeNull();
      // Not rasterized yet: nothing to build from, and nothing remembered, so the next mousemove tries again.
      expect(Label.getCursorImageUrl('CurbRamp')).toBeNull();

      await Label.preloadIcons();
      drawn.length = 0;

      expect(Label.getCursorImageUrl('CurbRamp')).toBe('data:image/png;base64,x');
      expect(Label.getCursorImageUrl('CurbRamp')).toBe('data:image/png;base64,x');
      expect(drawn).toHaveLength(1);
      expect(drawn[0].rest).toEqual([0, 0, Label.CURSOR_ICON_SIZE, Label.CURSOR_ICON_SIZE]);
      expect(Label.getCursorImageUrl('Walk')).toBeNull();
    });
  });
});
