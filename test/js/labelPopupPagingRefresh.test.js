/**
 * Tests for the label popup's prev/next arrow state (public/js/common/label-detail/LabelPopup.js) when the host's
 * label data arrives after the popup has already opened.
 *
 * LabelMap loads labels by viewport (#5002), so a `?labelId=` deep link opens the popup before any label data
 * exists. The arrows are computed from the nearby-label navigator, which is empty at that moment, so the host has
 * to ask the popup to recompute once the data lands — otherwise Next stays disabled forever (#5068).
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

describe('LabelPopup paging state', () => {
    let popup;
    let mapData;
    let nav;

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
    });

    test('Next is enabled once the host refreshes the navigator and the paging state', async () => {
        const nextBtn = document.querySelector('.label-detail__paging--next');
        await popup.showLabel(1, 'LabelMap');
        expect(nextBtn.disabled).toBe(true);

        // The viewport's labels land, as labelMap's labelLoader.onData handler sees it.
        mapData.sortedLabels = { CurbRamp: [feature(1, 0, 0), feature(2, 0.001, 0)] };
        nav.refresh();
        popup.refreshPagingState();

        expect(nextBtn.disabled).toBe(false);
    });

    test('Prev stays disabled on the first label, since nothing has been visited yet', async () => {
        const prevBtn = document.querySelector('.label-detail__paging--prev');
        await popup.showLabel(1, 'LabelMap');
        mapData.sortedLabels = { CurbRamp: [feature(1, 0, 0), feature(2, 0.001, 0)] };
        nav.refresh();
        popup.refreshPagingState();

        expect(prevBtn.disabled).toBe(true);
    });
});
