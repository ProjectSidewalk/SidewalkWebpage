/**
 * Tests for the label popup's prev/next arrow state (public/js/common/label-detail/LabelPopup.js) when the host's
 * label data changes after the popup has already opened.
 *
 * LabelMap loads labels by viewport (#5002), so a `?labelId=` deep link opens the popup before any label data
 * exists. The arrows are computed from the nearby-label navigator, which is empty at that moment, so the popup
 * subscribes to the navigator and recomputes whenever the loaded set changes — a single `nav.refresh()` from the
 * host has to be enough, in both directions (#5068).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NAV_PATH = path.join(REPO_ROOT, 'public/js/ps-map/nearbyLabelNavigator.js');
const POPUP_PATH = path.join(REPO_ROOT, 'public/js/common/label-detail/LabelPopup.js');

/** Builds the parts of labelPopup.scala.html / labelDetail.scala.html that LabelPopup queries. */
function renderPopupMarkup() {
    document.body.innerHTML = `
        <dialog id="label-modal" class="label-detail">
          <button type="button" data-action="close-label-detail"></button>
          <button type="button" class="label-detail__paging label-detail__paging--prev"></button>
          <button type="button" class="label-detail__paging label-detail__paging--next"></button>
        </dialog>`;
}

/** A label feature in the shape addLabelsToMap produces. */
const feature = (id, lng, lat) => ({ properties: { label_id: id }, geometry: { coordinates: [lng, lat] } });

/** Two labels ~111m apart, the shape a viewport fetch lands in. */
const TWO_LABELS = { CurbRamp: [feature(1, 0, 0), feature(2, 0.001, 0)] };

describe('LabelPopup paging state', () => {
    let popup;
    let mapData;
    let nav;
    let prevBtn;
    let nextBtn;

    beforeEach(async () => {
        renderPopupMarkup();
        // jsdom has no modal dialog implementation, and LabelPopup's init sequence opens and closes the dialog.
        window.HTMLDialogElement.prototype.showModal = jest.fn();
        window.HTMLDialogElement.prototype.close = jest.fn();
        window.requestAnimationFrame = (cb) => cb();
        window.logWebpageActivity = jest.fn();
        // LabelDetail does the rendering/fetching; the popup only wraps it, so a stub is enough here.
        global.LabelDetail = {
            create: async () => ({ showLabel: async () => ({}) }),
            urlLabelId: () => null,
            syncUrlLabelId: jest.fn(),
        };

        (0, eval)(fs.readFileSync(NAV_PATH, 'utf8')); // Declares createNearbyLabelNavigator globally.
        (0, eval)(fs.readFileSync(POPUP_PATH, 'utf8')); // Declares LabelPopup globally.

        // The navigator is created over the map's label set, which is still empty while the viewport data loads.
        mapData = { sortedLabels: {} };
        nav = global.createNearbyLabelNavigator(mapData);
        popup = await global.LabelPopup(false, null, null, null, {});
        popup.setNearbyNavigator(nav);
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
        expect(nextBtn.disabled).toBe(true); // Nowhere to go while the navigator has never heard of label 1.

        landViewportData(TWO_LABELS);

        expect(nextBtn.disabled).toBe(false);
    });

    test('Next disables again when a refetch drops every label but the shown one', async () => {
        await popup.showLabel(1, 'LabelMap');
        landViewportData(TWO_LABELS);
        expect(nextBtn.disabled).toBe(false);

        // The map moved on, so the neighbor is outside the new bbox and the popup can no longer page to it.
        landViewportData({ CurbRamp: [feature(1, 0, 0)] });

        expect(nextBtn.disabled).toBe(true);
    });

    test('Prev is disabled on the first label and enables once the tour moves on', async () => {
        await popup.showLabel(1, 'LabelMap');
        landViewportData(TWO_LABELS);
        expect(prevBtn.disabled).toBe(true); // Trail-based: nothing has been visited yet.

        nextBtn.click();
        await Promise.resolve(); // The click's showLabel() is async; let it settle.

        expect(prevBtn.disabled).toBe(false);
    });

    test('a refetch that drops the trail\'s labels leaves Prev live', async () => {
        await popup.showLabel(1, 'LabelMap');
        landViewportData(TWO_LABELS);
        nextBtn.click();
        await Promise.resolve();

        // Label 1 is gone from the loaded set, but it is still where Prev goes back to.
        landViewportData({ CurbRamp: [feature(2, 0.001, 0)] });

        expect(prevBtn.disabled).toBe(false);
    });
});
