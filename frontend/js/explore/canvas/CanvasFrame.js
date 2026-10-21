/**
 * The logical frame Explore labels in: the 720-wide canvas every click is projected through, plus the label icon's
 * radius and click target. All three follow the displayed pano's size (#4838, #5085), so Main refreshes this one
 * object per layout rather than every reader measuring the page per render. The defaults are the scale-1 values.
 */

import { util } from '../../common/utilities.js';
import '../../common/pano-viewer/panoUtilities.js';

export class CanvasFrame {
  /** @type {number} The frame's width in logical px. */
  width;

  /** @type {number} The frame's height in logical px. */
  height;

  /** @type {number} The drawn label icon's radius in logical px. */
  iconRadius;

  /** @type {number} How far from a label's center a click still counts as on it, in logical px. */
  hitMargin;

  #viewerType;

  /**
   * @param {string} viewerType - The imagery the frame renders (PanoViewer.SOURCE), since only GSV clamps its
   *   vertical field on wide viewports (#5083).
   */
  constructor(viewerType) {
    this.#viewerType = viewerType;
    this.width = util.EXPLORE_CANVAS_WIDTH;
    this.height = util.EXPLORE_CANVAS_HEIGHT;
    this.iconRadius = util.labelIconRadius(1);
    this.hitMargin = util.labelHitMargin(1);
  }

  /**
   * Re-measures the frame for the pano's current box. Cached, since the values are read per label on every render and
   * mousemove, and each read would otherwise force a style recalculation.
   * @param {number} displayScale - The pano's display scale (util.exploreDisplayScale), capping the icon's screen px.
   */
  refresh(displayScale) {
    const frame = util.exploreCanvasFrame();
    this.width = frame.width;
    this.height = frame.height;
    this.iconRadius = util.labelIconRadius(displayScale);
    this.hitMargin = util.labelHitMargin(displayScale);
  }

  /**
   * The horizontal fov the pano viewer renders at a zoom for this frame, which the projection has to be fed off 3:2
   * because GSV clamps its vertical field on wide viewports (#5083, #5085).
   * @param {number} zoom - The viewer zoom.
   * @returns {number} Degrees.
   */
  renderedHFov(zoom) {
    return util.pano.renderedHFov(zoom, this.width / this.height, this.#viewerType);
  }
}
