/**
 * Tests for the dialog-open fade in Label#render (frontend/js/explore/label/Label.js, issue #4824).
 *
 * While a label's context menu is open, that label's icon draws at reduced opacity: the marker sits exactly on the
 * feature the user is rating, so fading it lets them see the feature while they rate it. The dialog's tail still
 * points at the spot.
 *
 * Whether a label is the open dialog's target is Canvas's call (it holds the context menu); the label only takes the
 * verdict as render()'s `faded` argument, in and out of the tutorial alike (#4824). The fade showing the instant the
 * panel opens or closes is ContextMenu.show()/hide() re-rendering the canvas, pinned in exploreContextMenuRerender.
 */

import { loadModules, useUtil } from './loader.js';
import { makeRecordingCtx } from './canvasCtxStub.js';

describe('Label render fade while the context menu is open', () => {
  let Label;
  let frame;

  /** A placed label with a cached lat/lng, so toLatLng() would short-circuit past the estimator. */
  function newLabel({ labelType = 'CurbRamp', severity = 1 } = {}) {
    const label = new Label({
      labelType,
      severity,
      temporaryLabelId: 1,
      panoXY: { x: 10, y: 20 },   // Present, so the constructor skips the pano-store lookup.
      povOfLabelIfCentered: { heading: 90, pitch: -20, zoom: 1 },
      panoLat: 47.6553,
      panoLng: -122.3035,
      labelLat: 47.6554,
      labelLng: -122.3034,
    }, frame, {}, {});
    // The hover card is a DOM concern and is suppressed anyway whenever the context menu is open; keep it out.
    label.setHoverInfoVisibility('hidden');
    return label;
  }

  /** Renders `label` as Canvas would with the context menu reporting `{ open, target }`, returning the alphas. */
  function renderWith(label, { open, target }) {
    const ctx = makeRecordingCtx();
    label.render(ctx, { heading: 90, pitch: -20, zoom: 1 }, open && target === label);
    return ctx;
  }

  beforeEach(async () => {
    let util;
    // Label's icon geometry is expressed in terms of util.labelIconHalfExtent/labelIconScale, and a stub of
    // those would be the formula copied into the test.
    ({ Label, util } = await loadModules('frontend/js/explore/label/Label.js', 'frontend/js/common/utilities.js'));
    frame = { width: 720, height: 480, iconRadius: util.labelIconRadius(1), renderedHFov: () => 90 };
    useUtil({
      pano: { centeredPovToCanvasCoord: () => ({ x: 360, y: 240 }) },
      misc: { getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }) },
    });
    window.labelIconCache = { 'CurbRamp.svg': {} }; // Truthy, so renderLabelIcon reaches its drawImage.
  });

  test('draws at full opacity when no context menu is open', () => {
    const ctx = renderWith(newLabel(), { open: false, target: null });

    expect(ctx.alphas.length).toBeGreaterThan(0);
    expect(ctx.alphas.every((a) => a === 1)).toBe(true);
    expect(ctx.saveCount).toBe(0); // No save/restore pair at all when there's nothing to fade.
  });

  test('fades the label the open context menu points at', () => {
    const label = newLabel();
    const ctx = renderWith(label, { open: true, target: label });

    expect(ctx.alphas.length).toBeGreaterThan(0);
    expect(ctx.alphas.every((a) => a === 0.3)).toBe(true);
  });

  test('leaves the alpha it was handed once the label is drawn', () => {
    const label = newLabel();
    const ctx = renderWith(label, { open: true, target: label });

    expect(ctx.globalAlpha).toBe(1); // restore() ran, so the next label in the loop draws unfaded.
  });

  test('does not fade other labels while one label\'s menu is open', () => {
    const other = newLabel();
    const ctx = renderWith(newLabel(), { open: true, target: other });

    expect(ctx.alphas.every((a) => a === 1)).toBe(true);
  });

  test('fades the unrated-severity alert along with the icon', () => {
    const label = newLabel({ severity: null }); // No severity yet, so render() also paints the "!" alert.
    const ctx = renderWith(label, { open: true, target: label });

    // More draw calls than the icon alone makes, and every one of them faded.
    expect(ctx.alphas.length).toBeGreaterThan(renderWith(newLabel(), { open: true, target: null }).alphas.length);
    expect(ctx.alphas.every((a) => a === 0.3)).toBe(true);
  });

  test('does not fade a hidden or deleted label (it is not drawn at all)', () => {
    const label = newLabel();
    label.remove();
    const ctx = renderWith(label, { open: true, target: label });

    expect(ctx.alphas).toEqual([]);
  });
});
