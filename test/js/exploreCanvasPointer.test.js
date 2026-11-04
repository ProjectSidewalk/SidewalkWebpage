/**
 * Tests for the pointer over Explore's pano (frontend/js/explore/canvas/Canvas.js, #5840): a drag pans, a hover
 * shows the label's card and a click opens its menu on the view-control layer, and while a label type is armed the
 * drawing layer turns a click into a label, submitted at once. Pano exits are pinned in explorePanoExitToast.test.js
 * and hit testing in labelIconSizing.test.js.
 */

import { loadModules, mockModule } from './loader.js';
import {
  buildCanvas, canvasCollaborators, canvasPage, makeLabel, mockCanvasCollaborators, pointer,
} from './support/exploreCanvasHarness.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockCanvasCollaborators();

describe('Canvas pointer handling', () => {
  let Canvas;
  let canvas;
  let page;
  let c;
  let labels;
  let layer;

  /** @returns {object} The canvas, rebuilt over the page and collaborators as they now stand. */
  const build = () => {
    canvas = buildCanvas(Canvas, page, c);
    return canvas;
  };

  beforeEach(async () => {
    ({ Canvas } = await loadModules('frontend/js/explore/canvas/Canvas.js'));
    page = canvasPage();
    labels = [makeLabel({ at: { x: 300, y: 200 } })];
    c = canvasCollaborators({ labels });
    build();
    layer = page.streetviewUi.viewControlLayer;
  });

  describe('on the view-control layer', () => {
    test('a drag pans the pano by the pointer\'s travel, scaled down at higher zoom', () => {
      pointer(layer, 'mousemove', 100, 100);
      pointer(layer, 'mousedown', 100, 100);
      expect(layer.style.cursor).toContain('closedhand.cur');
      expect(c.tracker.push).toHaveBeenCalledWith('ViewControl_MouseDown', { x: 100, y: 100 });

      pointer(layer, 'mousemove', 110, 120);

      // Zoom 1 halves the travel: the view moves half as far per pixel as the labeler drags.
      expect(c.panoManager.updatePov).toHaveBeenCalledWith(5, 10);
      pointer(layer, 'mouseup', 110, 120);
      expect(c.tracker.push).toHaveBeenCalledWith('ViewControl_MouseUp', { x: 110, y: 120 });
      expect(layer.style.cursor).toContain('openhand.cur');
    });

    test('a drag takes the hover card down with it', () => {
      pointer(layer, 'mousemove', 300, 200);
      expect(page.ui.hoverCard.style.visibility).toBe('visible');

      pointer(layer, 'mousedown', 300, 200);
      pointer(layer, 'mousemove', 310, 200);

      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
      expect(canvas.getCurrentLabel()).toBeUndefined();
    });

    test('a drag while panning is held moves nothing', () => {
      c.panoManager.panning.isHeld = () => true;
      pointer(layer, 'mousedown', 100, 100);

      pointer(layer, 'mousemove', 120, 100);

      expect(c.panoManager.updatePov).not.toHaveBeenCalled();
    });

    test('a release off every label is a plain mouse-up; two in quick succession log a double click', () => {
      vi.useFakeTimers();
      pointer(layer, 'mouseup', 10, 10);
      vi.advanceTimersByTime(100);
      pointer(layer, 'mouseup', 10, 10);
      expect(c.tracker.push.mock.calls.filter(([name]) => name === 'ViewControl_DoubleClick')).toHaveLength(1);

      vi.advanceTimersByTime(400);
      pointer(layer, 'mouseup', 10, 10);

      expect(c.tracker.push.mock.calls.filter(([name]) => name === 'ViewControl_DoubleClick')).toHaveLength(1);
      expect(c.contextMenu.show).not.toHaveBeenCalled();
    });

    test('a release on a label opens its menu', () => {
      pointer(layer, 'mouseup', 305, 195);

      expect(c.contextMenu.show).toHaveBeenCalledWith(labels[0]);
      expect(canvas.getCurrentLabel()).toBe(labels[0]);
      expect(layer.style.cursor).toBe('pointer');
    });

    test('hovering a label shows its card, and no other\'s, and redraws', () => {
      const other = makeLabel({ at: { x: 50, y: 50 } });
      labels.push(other);

      pointer(layer, 'mousemove', 300, 200);

      expect(layer.style.cursor).toBe('pointer');
      expect(canvas.getCurrentLabel()).toBe(labels[0]);
      expect(c.labelCardView.render).toHaveBeenCalledWith({
        labelType: 'CurbRamp', severity: null, tagNames: [], description: '',
      });
      expect(page.ui.hoverCard.style.visibility).toBe('visible');
      expect(labels[0].getHoverInfoVisibility()).toBe('visible');
      expect(other.getHoverInfoVisibility()).toBe('hidden');
      expect(labels[0].render).toHaveBeenCalled();
    });

    test('the card goes 200ms after the pointer leaves the label, however the pointer wanders meanwhile', () => {
      vi.useFakeTimers();
      pointer(layer, 'mousemove', 300, 200);

      pointer(layer, 'mousemove', 400, 200);
      vi.advanceTimersByTime(150);
      pointer(layer, 'mousemove', 420, 200);
      vi.advanceTimersByTime(49);
      expect(page.ui.hoverCard.style.visibility).toBe('visible');

      vi.advanceTimersByTime(1);
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
      expect(canvas.getCurrentLabel()).toBeUndefined();
    });

    test('coming back onto the label in time keeps the card', () => {
      vi.useFakeTimers();
      pointer(layer, 'mousemove', 300, 200);
      pointer(layer, 'mousemove', 400, 200);
      vi.advanceTimersByTime(100);

      pointer(layer, 'mousemove', 300, 200);
      vi.advanceTimersByTime(500);

      expect(page.ui.hoverCard.style.visibility).toBe('visible');
    });

    test('reaching the card holds it; leaving the card lets it go', () => {
      vi.useFakeTimers();
      pointer(layer, 'mousemove', 300, 200);
      pointer(layer, 'mousemove', 400, 200);
      page.ui.hoverCard.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(500);
      expect(page.ui.hoverCard.style.visibility).toBe('visible');

      page.ui.hoverCard.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(200);
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
    });

    test('the pointer leaving the pano ends a drag and lets the card go', () => {
      vi.useFakeTimers();
      pointer(layer, 'mousemove', 300, 200);
      pointer(layer, 'mousedown', 300, 200);

      pointer(layer, 'mouseleave');
      pointer(layer, 'mousemove', 400, 200);

      expect(c.panoManager.updatePov).not.toHaveBeenCalled();
      expect(layer.style.cursor).toContain('openhand.cur');
      vi.advanceTimersByTime(200);
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
    });

    test('positions are read in the logical frame when the pano shows at twice its size', () => {
      page = canvasPage({ displayWidth: 1440 });
      c = canvasCollaborators({ labels });
      build();

      pointer(page.streetviewUi.viewControlLayer, 'mouseup', 600, 400);

      expect(c.tracker.push).toHaveBeenCalledWith('ViewControl_MouseUp', { x: 300, y: 200 });
      expect(c.contextMenu.show).toHaveBeenCalledWith(labels[0]);
    });
  });

  describe('on the drawing layer', () => {
    let drawing;

    beforeEach(() => {
      c.setMode('Obstacle');
      drawing = page.ui.drawingLayer;
    });

    test('a press is logged where it landed', () => {
      pointer(drawing, 'mousedown', 100, 50);
      expect(c.tracker.push).toHaveBeenCalledWith('LabelingCanvas_MouseDown', { x: 100, y: 50 });
    });

    test('a release places a label of the armed type, opens its menu, and submits it', async () => {
      vi.useFakeTimers();
      const labeled = vi.fn();
      canvas.onLabeled(labeled);

      pointer(drawing, 'mouseup', 360, 240);

      const params = c.labelContainer.createLabel.mock.calls[0][0];
      expect(c.labelContainer.createLabel).toHaveBeenCalledWith(expect.anything(), true);
      expect(params).toMatchObject({
        tutorial: false, missionId: 7, auditTaskId: 9, labelType: 'Obstacle', panoId: 'pano1',
        originalCanvasXY: { x: 360, y: 240 }, originalCanvasFrame: { width: 720, height: 480 },
        originalPov: { heading: 90, pitch: -10, zoom: 1 },
      });
      // Dead centre of the frame is straight ahead, so the label's own view is the current one.
      expect(params.povOfLabelIfCentered.heading).toBeCloseTo(90, 5);
      expect(params.povOfLabelIfCentered.pitch).toBeCloseTo(-10, 5);
      expect(params.currCanvasXY.x).toBeCloseTo(360, 5);
      expect(params.currCanvasXY.y).toBeCloseTo(240, 5);

      const placed = c.labelContainer.createLabel.mock.results[0].value;
      expect(canvas.getCurrentLabel()).toBe(placed);
      expect(c.contextMenu.show).toHaveBeenCalledWith(placed);
      expect(c.tracker.push).toHaveBeenCalledWith('LabelingCanvas_FinishLabeling', {
        labelType: 'Obstacle', canvasX: 360, canvasY: 240, canvasWidth: 720, canvasHeight: 480,
      }, placed);
      expect(c.audioEffect.play).toHaveBeenCalledWith('drip');
      expect(labeled).toHaveBeenCalledWith(placed);
      expect(c.tracker.push).toHaveBeenCalledWith('LabelingCanvas_MouseUp', { x: 360, y: 240 });
      expect(c.form.submitData).toHaveBeenCalledTimes(1);

      expect(c.labelModes.backToWalk).not.toHaveBeenCalled();
      vi.advanceTimersByTime(20);
      expect(c.labelModes.backToWalk).toHaveBeenCalledTimes(1);
    });

    test('a release while labeling is held places nothing but still logs and submits', () => {
      canvas.labeling.hold('popup');

      pointer(drawing, 'mouseup', 360, 240);

      expect(c.labelContainer.createLabel).not.toHaveBeenCalled();
      expect(c.tracker.push).toHaveBeenCalledWith('LabelingCanvas_MouseUp', { x: 360, y: 240 });
      expect(c.form.submitData).toHaveBeenCalledTimes(1);
    });

    test('an unsubscribed onLabeled listener hears no later label', () => {
      const labeled = vi.fn();
      canvas.onLabeled(labeled)();

      pointer(drawing, 'mouseup', 360, 240);

      expect(labeled).not.toHaveBeenCalled();
    });

    test('the cursor is the armed type\'s icon, centred on the pointer', () => {
      pointer(drawing, 'mousemove', 10, 10);
      expect(drawing.style.cursor).toBe('url(cursor-Obstacle) 19 19, auto');

      c.setMode('Walk');
      pointer(drawing, 'mousemove', 10, 10);
      expect(drawing.style.cursor).toBe('url(cursor-Obstacle) 19 19, auto');
    });

    test('leaving the pano disarms the type, except in the tutorial', () => {
      pointer(page.holder, 'mouseleave');
      expect(c.tracker.push).toHaveBeenCalledWith('LabelingCanvas_MouseOut');
      expect(c.labelModes.backToWalk).toHaveBeenCalledTimes(1);

      c.config.isOnboarding = true;
      pointer(page.holder, 'mouseleave');
      expect(c.labelModes.backToWalk).toHaveBeenCalledTimes(1);
    });
  });

  describe('arming a label type', () => {
    test('takes the hover card down, sets the cursor at once and loads the placement sound', () => {
      pointer(layer, 'mousemove', 300, 200);
      expect(page.ui.hoverCard.style.visibility).toBe('visible');
      c.setMode('CurbRamp');

      c.fire('mode', 'CurbRamp');

      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
      expect(page.ui.drawingLayer.style.cursor).toBe('url(cursor-CurbRamp) 19 19, auto');
      expect(c.audioEffect.load).toHaveBeenCalledWith('drip');
    });

    test('going back to Walk changes nothing', () => {
      c.fire('mode', 'Walk');
      expect(c.audioEffect.load).not.toHaveBeenCalled();
    });
  });
});
