/**
 * Tests for the label popup's prev/next arrow state (frontend/js/common/label-detail/LabelPopup.js) when the host's
 * label data changes after the popup has already opened.
 *
 * LabelMap loads labels by viewport (#5002), so a `?labelId=` deep link opens the popup before any label data
 * exists. The arrows are computed from the nearby-label navigator, which is empty at that moment, so the popup
 * subscribes to the navigator and recomputes whenever the loaded set changes — a single `nav.refresh()` from the
 * host has to be enough, in both directions (#5068).
 */

import { loadModules, mockModule } from './loader.js';

// The popup only wraps LabelDetail, so a stand-in whose `create` each test re-scripts is enough.
const labelDetail = { create: null, urlLabelId: () => null, syncUrlLabelId: vi.fn() };
mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({ LabelDetail: labelDetail }));

/** Builds the parts of labelPopup.scala.html / labelDetail.scala.html that LabelPopup queries. */
function renderPopupMarkup() {
  document.body.innerHTML = `
        <dialog id="label-modal" class="label-detail">
          <button type="button" data-action="close-label-detail"></button>
          <button type="button" class="label-detail__paging label-detail__paging--prev"></button>
          <button type="button" class="label-detail__paging label-detail__paging--next"></button>
        </dialog>`;
}

/** Whether an arrow is switched off; the arrows use aria-disabled so they keep focus (#5135). */
const isOff = (btn) => btn.getAttribute('aria-disabled') === 'true';

/** A label feature in the shape addLabelsToMap produces. */
const feature = (id, lng, lat) => ({ properties: { label_id: id }, geometry: { coordinates: [lng, lat] } });

/** Two labels ~111m apart, the shape a viewport fetch lands in. */
const TWO_LABELS = { CurbRamp: [feature(1, 0, 0), feature(2, 0.001, 0)] };

describe('LabelPopup paging state', () => {
  let popup;
  let mapData;
  let nav;
  let hiddenByFilters;
  let prevBtn;
  let nextBtn;
  let buildPopup;

  beforeEach(async () => {
    renderPopupMarkup();
    // jsdom has no modal dialog implementation, and LabelPopup's init sequence opens and closes the dialog.
    window.HTMLDialogElement.prototype.showModal = vi.fn();
    window.HTMLDialogElement.prototype.close = vi.fn();
    window.requestAnimationFrame = (cb) => cb();
    window.logWebpageActivity = vi.fn();
    labelDetail.create = async () => ({ showLabel: async () => ({}), saveOpenEdits: vi.fn() });

    const { createNearbyLabelNavigator, LabelPopup } = await loadModules(
      'frontend/js/ps-map/nearbyLabelNavigator.js', 'frontend/js/common/label-detail/LabelPopup.js');

    // The navigator is created over the map's label set, which is still empty while the viewport data loads.
    // The predicate stands in for LabelMap's sidebar filters (#5124).
    mapData = { sortedLabels: {} };
    hiddenByFilters = new Set();
    nav = createNearbyLabelNavigator(mapData, {
      isCandidate: (labelType, feature) => !hiddenByFilters.has(feature.properties.label_id),
    });
    popup = await LabelPopup(false, null, null, null, {});
    popup.setNearbyNavigator(nav);
    buildPopup = LabelPopup;
    prevBtn = document.querySelector('.label-detail__paging--prev');
    nextBtn = document.querySelector('.label-detail__paging--next');
  });

  /** Lands a viewport fetch's worth of labels the way labelMap's labelLoader.onData handler does. */
  function landViewportData(sortedLabels) {
    mapData.sortedLabels = sortedLabels;
    nav.refresh();
  }

  test('Next enables on the host\'s nav.refresh() alone, with no second call to the popup', async () => {
    await popup.showLabel(1, 'LabelMap');
    expect(isOff(nextBtn)).toBe(true); // Nowhere to go while the navigator has never heard of label 1.

    landViewportData(TWO_LABELS);

    expect(isOff(nextBtn)).toBe(false);
  });

  test('Next disables again when a refetch drops every label but the shown one', async () => {
    await popup.showLabel(1, 'LabelMap');
    landViewportData(TWO_LABELS);
    expect(isOff(nextBtn)).toBe(false);

    // The map moved on, so the neighbor is outside the new bbox and the popup can no longer page to it.
    landViewportData({ CurbRamp: [feature(1, 0, 0)] });

    expect(isOff(nextBtn)).toBe(true);
  });

  test('Prev is disabled on the first label and enables once the tour moves on', async () => {
    await popup.showLabel(1, 'LabelMap');
    landViewportData(TWO_LABELS);
    expect(isOff(prevBtn)).toBe(true); // Trail-based: nothing has been visited yet.

    nextBtn.click();
    await Promise.resolve(); // The click's showLabel() is async; let it settle.

    expect(isOff(prevBtn)).toBe(false);
  });

  test('a refetch that drops the trail\'s labels leaves Prev live', async () => {
    await popup.showLabel(1, 'LabelMap');
    landViewportData(TWO_LABELS);
    nextBtn.click();
    await Promise.resolve();

    // Label 1 is gone from the loaded set, but it is still where Prev goes back to.
    landViewportData({ CurbRamp: [feature(2, 0.001, 0)] });

    expect(isOff(prevBtn)).toBe(false);
  });

  test('Next disables on the host\'s nav.filtersChanged() after a filter hides the only neighbor', async () => {
    await popup.showLabel(1, 'LabelMap');
    landViewportData(TWO_LABELS);
    expect(isOff(nextBtn)).toBe(false);

    // The user unchecks the neighbor's label type; LabelMap's sidebar onChange handler reports it.
    hiddenByFilters.add(2);
    nav.filtersChanged();

    expect(isOff(nextBtn)).toBe(true);
  });

  test('the arrows reflect the newly shown label before its metadata fetch resolves', async () => {
    await popup.showLabel(1, 'LabelMap');
    landViewportData(TWO_LABELS);
    expect(isOff(nextBtn)).toBe(false);

    // Rebuild the popup over a label fetch that never settles, so the pre-await state is observable.
    labelDetail.create = async () => ({ showLabel: () => new Promise(() => {}), saveOpenEdits: vi.fn() });
    const pending = await buildPopup(false, null, null, null, {});
    pending.setNearbyNavigator(nav);
    hiddenByFilters.add(1); // From label 2, the only other label (1) is filtered out: nowhere to go.
    pending.showLabel(2, 'LabelMap');

    expect(isOff(nextBtn)).toBe(true);
  });

  describe('switching an arrow off while it has focus (#5135)', () => {
    // jsdom won't focus inside a closed <dialog>, and showModal() is stubbed out above, so open it by hand. jsdom
    // also runs no focus fixup, so the tests pin the cause a browser acts on: the arrow is never natively disabled.
    beforeEach(() => document.getElementById('label-modal').setAttribute('open', ''));

    test('Next keeps focus when the label it pages to is the last reachable one', async () => {
      await popup.showLabel(1, 'LabelMap');
      landViewportData(TWO_LABELS);
      nextBtn.focus();

      nextBtn.click();
      await Promise.resolve();

      // On label 2 the only other label is the one just visited, so Next switches off under the reader's focus.
      expect(isOff(nextBtn)).toBe(true);
      expect(nextBtn.disabled).toBe(false); // Never native `disabled`: a browser drops focus off that.
      expect(document.activeElement).toBe(nextBtn);
    });

    test('a refetch that switches off the focused arrow leaves focus on it, and a refetch back switches it on', async () => {
      await popup.showLabel(1, 'LabelMap');
      landViewportData(TWO_LABELS);
      nextBtn.focus();

      hiddenByFilters.add(2);
      nav.filtersChanged();
      expect(isOff(nextBtn)).toBe(true);
      expect(nextBtn.disabled).toBe(false);
      expect(document.activeElement).toBe(nextBtn);

      hiddenByFilters.delete(2);
      nav.filtersChanged();
      expect(nextBtn.hasAttribute('aria-disabled')).toBe(false);
    });

    test('a switched-off arrow ignores clicks and Enter: no paging, no log line', async () => {
      await popup.showLabel(1, 'LabelMap');
      landViewportData(TWO_LABELS);
      hiddenByFilters.add(2);
      nav.filtersChanged();
      const showSpy = vi.spyOn(nav, 'next');
      window.logWebpageActivity.mockClear();

      nextBtn.click();
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); // Enter on the focused arrow.
      prevBtn.click(); // Nothing visited yet, so Prev is off too.
      await Promise.resolve();

      expect(showSpy).not.toHaveBeenCalled();
      expect(window.logWebpageActivity).not.toHaveBeenCalled();
    });
  });
});
