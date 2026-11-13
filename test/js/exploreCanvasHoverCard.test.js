/**
 * What Explore's canvas shows beside a hovered label and how it redraws (frontend/js/explore/canvas/Canvas.js,
 * #5840): the hover card's content, its Edit, Delete and Share controls, which labels a redraw shows for the current
 * pano, and the crop saved for a label just placed. exploreCanvasPointer.test.js has the pointer paths that raise it.
 */

import { loadModules, mockModule } from './loader.js';
import {
  buildCanvas, canvasCollaborators, canvasPage, makeLabel, mockCanvasCollaborators, pointer, shareWidgets,
} from './support/exploreCanvasHarness.js';

// One tag text carries the shortcut-letter markup the card's pills must strip.
mockModule('i18next', () => ({ default: {
  t: (key, opts = {}) => (key === 'center-ui.context-menu.tag.narrow' ? '<tag-underline>n</tag-underline>arrow'
    : (opts.labelType ? `${key}:${opts.labelType}` : key)),
} }));
mockCanvasCollaborators();

describe('Canvas hover card and redraws', () => {
  let Canvas;
  let canvas;
  let page;
  let c;
  let labels;
  let layer;

  const build = () => {
    canvas = buildCanvas(Canvas, page, c);
    layer = page.streetviewUi.viewControlLayer;
    return canvas;
  };
  /** Hovers the label at (300, 200), which raises its card. */
  const hoverLabel = () => pointer(layer, 'mousemove', 300, 200);

  beforeEach(async () => {
    ({ Canvas } = await loadModules('frontend/js/explore/canvas/Canvas.js'));
    page = canvasPage();
    labels = [makeLabel({ at: { x: 300, y: 200 }, props: { labelId: 12, tagIds: [1, 2, 99], severity: 2 } })];
    c = canvasCollaborators({ labels });
    build();
  });

  describe('the card', () => {
    test('shows the label\'s rating, description and tag names as plain text', () => {
      hoverLabel();

      expect(c.labelCardView.render).toHaveBeenCalledWith({
        labelType: 'CurbRamp', severity: 2, description: '', tagNames: ['narrow', 'odd'],
      });
    });

    test('shows no tags before the tag list has arrived', () => {
      c.contextMenu.labelTags = undefined;
      hoverLabel();
      expect(c.labelCardView.render).toHaveBeenCalledWith(expect.objectContaining({ tagNames: [] }));
    });

    test('is a static card for an Occlusion label, and loses Delete when the tutorial forbids it', () => {
      labels[0] = makeLabel({ labelType: 'Occlusion', at: { x: 300, y: 200 } });
      c.labelContainer.canDelete = () => false;

      hoverLabel();

      expect(page.ui.hoverCard.classList.contains('label-hover-card--static')).toBe(true);
      expect(page.ui.hoverCard.classList.contains('label-hover-card--no-delete')).toBe(true);
    });

    test('stays down while the menu is open, or before the label has a place on the canvas', () => {
      c.contextMenu.isOpen = () => true;
      hoverLabel();
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');

      c.contextMenu.isOpen = () => false;
      labels[0].getCanvasXY = () => null;
      canvas.showLabelHoverInfo(labels[0]);
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
    });

    test('a click anywhere on it, or on Edit, opens the label\'s menu once', () => {
      hoverLabel();

      page.ui.hoverCard.click();
      expect(c.contextMenu.show).toHaveBeenCalledTimes(1);
      expect(c.contextMenu.show).toHaveBeenCalledWith(labels[0]);
      expect(c.tracker.push).toHaveBeenCalledWith('Click_LabelHoverCard', { labelType: 'CurbRamp', via: 'card' });
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');

      page.ui.hoverCardEdit.click();
      expect(c.contextMenu.show).toHaveBeenCalledTimes(2);
      expect(c.tracker.push).toHaveBeenCalledWith('Click_LabelHoverCard', {
        labelType: 'CurbRamp',
        via: 'edit-button',
      });
    });

    test('an Occlusion label has no menu to open', () => {
      labels[0] = makeLabel({ labelType: 'Occlusion', at: { x: 300, y: 200 } });
      hoverLabel();

      page.ui.hoverCard.click();

      expect(c.contextMenu.show).not.toHaveBeenCalled();
    });

    test('Delete removes the label without also opening its menu', () => {
      hoverLabel();

      page.ui.hoverCardDelete.click();

      expect(c.labelContainer.removeLabel).toHaveBeenCalledWith(labels[0]);
      expect(c.tracker.push).toHaveBeenCalledWith('Click_LabelDelete', { labelType: 'CurbRamp' }, labels[0]);
      expect(c.contextMenu.show).not.toHaveBeenCalled();
    });

    test('Delete does nothing for a label the tutorial keeps', () => {
      c.labelContainer.canDelete = () => false;
      hoverLabel();

      page.ui.hoverCardDelete.click();

      expect(c.labelContainer.removeLabel).not.toHaveBeenCalled();
    });
  });

  describe('the share control', () => {
    test('is built on the card\'s button, fitted to the viewport', () => {
      expect(shareWidgets).toHaveLength(1);
      expect(shareWidgets[0].trigger).toBe(page.ui.hoverCardShare);
      expect(shareWidgets[0].opts.fitToViewport).toBe(true);
    });

    test('points at the hovered label\'s page once, however many frames the card is redrawn for', () => {
      hoverLabel();
      canvas.clear().render();
      canvas.clear().render();

      expect(shareWidgets[0].setTarget).toHaveBeenCalledTimes(1);
      expect(shareWidgets[0].setTarget).toHaveBeenCalledWith({
        url: `${window.location.origin}/label/12`,
        title: 'common:share.text:common:curb-ramp',
        text: 'common:share.text:common:curb-ramp',
      });
    });

    test('has no page to point at until the label is saved, and saves it before opening', async () => {
      labels[0] = makeLabel({ at: { x: 300, y: 200 } });
      hoverLabel();
      expect(shareWidgets[0].setTarget).toHaveBeenLastCalledWith(expect.objectContaining({ url: '' }));
      c.form.ensureLabelSaved.mockImplementation(async (label) => label.setProperty('labelId', 34));

      await shareWidgets[0].opts.beforeOpen();

      expect(c.form.ensureLabelSaved).toHaveBeenCalledWith(labels[0]);
      expect(shareWidgets[0].setTarget).toHaveBeenLastCalledWith(expect.objectContaining({
        url: `${window.location.origin}/label/34`,
      }));
    });

    test('is hidden for a tutorial label, which never gets an id, and for a deleted one', () => {
      c.config.isOnboarding = true;
      hoverLabel();
      expect(page.ui.hoverCard.classList.contains('label-hover-card--no-share')).toBe(true);
      expect(shareWidgets[0].setTarget).not.toHaveBeenCalled();

      c.config.isOnboarding = false;
      labels[0] = makeLabel({ at: { x: 300, y: 200 }, deleted: true });
      canvas.showLabelHoverInfo(labels[0]);
      expect(page.ui.hoverCard.classList.contains('label-hover-card--no-share')).toBe(true);
    });

    test('logs the opening click, not the dismissing one, and keeps the click from opening the menu', () => {
      hoverLabel();

      page.ui.hoverCardShare.click();
      shareWidgets[0].open = true;
      page.ui.hoverCardShare.click();

      expect(c.tracker.push.mock.calls.filter(([name]) => name === 'Click_LabelCardShare'))
        .toEqual([['Click_LabelCardShare', { labelType: 'CurbRamp' }]]);
      expect(c.contextMenu.show).not.toHaveBeenCalled();
    });

    test('holds the card open while its popover is up, and lets it go once that is dismissed', () => {
      vi.useFakeTimers();
      hoverLabel();
      shareWidgets[0].open = true;

      pointer(layer, 'mousemove', 400, 200);
      vi.advanceTimersByTime(500);
      expect(page.ui.hoverCard.style.visibility).toBe('visible');

      shareWidgets[0].open = false;
      shareWidgets[0].opts.onDismiss();
      vi.advanceTimersByTime(200);
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
    });

    test('a share pressed from the keyboard after the card let its label go points nowhere and does not throw', async () => {
      vi.useFakeTimers();
      hoverLabel();
      pointer(layer, 'mousemove', 400, 200);
      vi.advanceTimersByTime(500);
      shareWidgets[0].setTarget.mockClear();

      await shareWidgets[0].opts.beforeOpen();

      expect(c.form.ensureLabelSaved).toHaveBeenCalledWith(undefined);
      expect(shareWidgets[0].setTarget).not.toHaveBeenCalled();
    });

    test('closes with the card when something else takes the card down', () => {
      hoverLabel();
      canvas.showLabelHoverInfo(undefined);
      expect(shareWidgets[0].close).toHaveBeenCalled();
    });

    test('a card without a share button has no widget', () => {
      page = canvasPage({ withShare: false });
      c = canvasCollaborators({ labels });
      build();

      hoverLabel();

      expect(shareWidgets).toHaveLength(0);
      expect(page.ui.hoverCard.style.visibility).toBe('visible');
    });
  });

  describe('redrawing', () => {
    test('draws every label, marking the one whose menu is open', () => {
      const other = makeLabel({ at: { x: 50, y: 50 } });
      labels.push(other);
      c.contextMenu.isOpen = () => true;
      c.contextMenu.getTargetLabel = () => other;

      canvas.render();

      expect(labels[0].render).toHaveBeenCalledWith(page.ctx, { heading: 90, pitch: -10, zoom: 1 }, false);
      expect(other.render).toHaveBeenCalledWith(page.ctx, { heading: 90, pitch: -10, zoom: 1 }, true);
    });

    test('a view change clears and redraws, re-filtering the labels only once the pano changes', () => {
      const elsewhere = makeLabel({ panoId: 'pano2' });
      const deleted = makeLabel({ deleted: true });
      labels.push(elsewhere, deleted);

      c.fire('pov');
      expect(page.ctx.clearRect).toHaveBeenCalledWith(0, 0, 720, 480);
      expect(labels[0].setVisibility).toHaveBeenLastCalledWith('visible');
      expect(elsewhere.setVisibility).toHaveBeenLastCalledWith('hidden');
      expect(deleted.setVisibility).toHaveBeenLastCalledWith('hidden');

      c.fire('pov');
      expect(labels[0].setVisibility).toHaveBeenCalledTimes(1);
    });

    test('the menu changing, and a label going, each redraw', () => {
      hoverLabel();
      labels[0].render.mockClear();

      c.fire('menuChange');
      expect(labels[0].render).toHaveBeenCalledTimes(1);

      // The container has already dropped the label by the time it says so.
      labels.splice(0);
      page.ctx.clearRect.mockClear();
      c.fire('removed');
      expect(page.ctx.clearRect).toHaveBeenCalledTimes(1);
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
      expect(canvas.getCurrentLabel()).toBeUndefined();
    });

    test('a move takes the card down and holds labeling until it finishes', () => {
      hoverLabel();

      c.fire('moveStarted');
      expect(page.ui.hoverCard.style.visibility).toBe('hidden');
      expect(canvas.labeling.isHeld()).toBe(true);

      c.fire('moveFinished');
      expect(canvas.labeling.isHeld()).toBe(false);
    });

    test('resize re-rasterizes the canvas for its new size and redraws', () => {
      page.ctx.setTransform.mockClear();
      canvas.resize();
      expect(page.ctx.setTransform).toHaveBeenCalledTimes(1);
      expect(labels[0].render).toHaveBeenCalledTimes(1);
    });

    test('setVisibility reaches every label', () => {
      canvas.setVisibility('hidden');
      expect(labels[0].setVisibility).toHaveBeenCalledWith('hidden');
    });

    test('a page without the label canvas draws nothing and survives a resize', async () => {
      document.getElementById('label-canvas').remove();
      c = canvasCollaborators({ labels });
      build();

      expect(canvas.render()).toBe(canvas);
      expect(() => canvas.resize()).not.toThrow();
      expect(labels[0].render).not.toHaveBeenCalled();
    });
  });

  describe('the crop saved for a placed label', () => {
    beforeEach(() => vi.useFakeTimers());

    test('is the pano viewer\'s canvas as a JPEG', () => {
      const label = makeLabel();

      c.fire('placed', label);
      vi.runAllTimers();

      expect(label.setProperty).toHaveBeenCalledWith('crop', 'data:720x480');
    });

    test('is scaled down to the widest crop stored, keeping the aspect', () => {
      page = canvasPage({ panoCanvas: { width: 2880, height: 1620 } });
      c = canvasCollaborators({ labels });
      build();
      const label = makeLabel();

      c.fire('placed', label);
      vi.runAllTimers();

      expect(label.setProperty).toHaveBeenCalledWith('crop', 'data:1440x810');
      expect(page.ctx.images).toEqual([{ dx: 0, dy: 0, w: 1440, h: 810 }]);
      expect(page.ctx.imageSmoothingQuality).toBe('high');
    });

    test('is skipped for a tutorial label, and when the city makes no crops', () => {
      c.fire('placed', makeLabel({ props: { tutorial: true } }));
      c.config.makeCrops = false;
      c.fire('placed', makeLabel());
      vi.runAllTimers();

      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    });

    test('a failure is logged rather than thrown into the placement', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      HTMLCanvasElement.prototype.toDataURL.mockImplementation(() => { throw new Error('tainted'); });

      c.fire('placed', makeLabel());
      expect(() => vi.runAllTimers()).not.toThrow();

      expect(log).toHaveBeenCalledWith('Error saving pano screenshot: ', expect.any(Error));
      canvas.saveCanvasScreenshot(null);
      expect(log).toHaveBeenCalledWith('No label found when making a crop.');
    });
  });
});
