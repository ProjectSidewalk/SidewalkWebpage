/**
 * Tests for the label popup's dialog (frontend/js/common/label-detail/LabelPopup.js): how it closes, what a close
 * tells the card and the host, the `?labelId=` deep link, the host's open callbacks, and the paging arrows' clicks.
 * The card inside is a stand-in, since the popup only wraps it (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { flush } from './support/routeFetch.js';

/** The card stand-in's statics; `urlLabelId` reads the URL the way the real one does. */
const labelDetail = {
  create: null,
  urlLabelId: () => Number.parseInt(new URLSearchParams(window.location.search).get('labelId'), 10) || null,
  syncUrlLabelId: vi.fn(),
};
mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({ LabelDetail: labelDetail }));
mockModule('frontend/js/common/label-detail/PopupPanoManager.js', () => ({
  PopupPanoManager: { DEEP_LINK_BUILD_WAIT_MS: 3000 },
}));

/**
 * The parts of labelPopup.scala.html / labelDetail.scala.html the popup queries.
 * @param {boolean} withPaging - Whether the host asked for the prev/next arrows.
 */
function renderPopupMarkup(withPaging) {
  document.body.innerHTML = `
    <dialog id="label-modal" class="label-detail">
      <header><button type="button" class="label-detail__close" data-action="close-label-detail"></button></header>
      <div class="label-detail__pano-wrap">
        ${withPaging ? '<button type="button" class="label-detail__paging label-detail__paging--prev"></button>' : ''}
        <div class="label-detail__pano"></div>
        ${withPaging ? '<button type="button" class="label-detail__paging label-detail__paging--next"></button>' : ''}
      </div>
    </dialog>`;
}

describe('LabelPopup dialog', () => {
  /** @type {Record<string, any>} The card the popup wraps. */
  let card;
  /** The card's own showLabel(), which the popup replaces on the card with its wrapper. */
  let innerShow;
  let LabelPopup;
  /** Settles each pending card showLabel(), by label id. */
  let pendingShows;

  beforeEach(async () => {
    // jsdom has no modal dialog, so open and close are the attribute plus the close event a real one fires.
    window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    window.logWebpageActivity = vi.fn();
    window.history.replaceState({}, '', '/labelMap');
    pendingShows = new Map();
    innerShow = vi.fn(async (id) => ({ label_id: id }));
    card = {
      showLabel: innerShow,
      saveOpenEdits: vi.fn(),
      panoManager: { warmUp: vi.fn(async () => {}) },
    };
    labelDetail.create = async () => card;
    ({ LabelPopup } = await loadModules('frontend/js/common/label-detail/LabelPopup.js'));
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  /**
   * Builds the popup the way a host page does.
   * @param {object} [opts] - LabelPopup's options.
   * @param {boolean} [withPaging=true] - Whether the host rendered the arrows.
   * @returns {Promise<object>}
   */
  async function buildPopup(opts = {}, withPaging = true) {
    renderPopupMarkup(withPaging);
    return LabelPopup(false, null, null, 'tester', opts);
  }

  /** Makes the card's showLabel() wait until the test settles it with `pendingShows.get(id)(meta)`. */
  function holdShows() {
    innerShow.mockImplementation((id) => new Promise((resolve) => { pendingShows.set(id, resolve); }));
  }

  const dialog = () => document.getElementById('label-modal');
  const panoEl = () => document.querySelector('.label-detail__pano');
  const logged = () => window.logWebpageActivity.mock.calls.map(([event]) => event);

  describe('closing', () => {
    /**
     * Clicks the dialog element itself at a point, the way a click on its backdrop or its own padding arrives.
     * @param {number} x
     * @param {number} y
     */
    function clickDialogAt(x, y) {
      dialog().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    }

    test('a click on the backdrop on any side closes the card; one on its padding or contents does not', async () => {
      const popup = await buildPopup();
      dialog().getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 100, right: 700 });

      for (const [x, y] of [[300, 50], [300, 550], [50, 300], [750, 300]]) {
        await popup.showLabel(1, 'LabelMap');
        clickDialogAt(x, y);
        expect(dialog().open, `a click at ${x},${y}`).toBe(false);
      }

      await popup.showLabel(1, 'LabelMap');
      clickDialogAt(300, 300);
      panoEl().click();
      expect(dialog().open).toBe(true);

      document.querySelector('[data-action="close-label-detail"]').click();
      expect(dialog().open).toBe(false);
    });

    test('a close saves an open tag pick, stops a load in flight from showing, and names the label to the host',
      async () => {
        const onClose = vi.fn();
        const popup = await buildPopup({ onClose });
        await popup.showLabel(5, 'LabelMap');
        panoEl().style.visibility = 'visible';

        dialog().close();
        expect(card.saveOpenEdits).toHaveBeenCalledTimes(1);
        expect(panoEl().style.visibility).toBe('');
        expect(panoEl().dataset.closedDuringLoad).toBe('true');
        expect(onClose).toHaveBeenCalledWith(5);

        // The next open lets its own load show itself again.
        await popup.showLabel(6, 'LabelMap');
        expect(panoEl().dataset.closedDuringLoad).toBeUndefined();
      });

    test('a close before any label was shown has nothing to tell the host', async () => {
      const onClose = vi.fn();
      await buildPopup({ onClose });
      dialog().close();
      expect(onClose).not.toHaveBeenCalled();

      // A host that didn't ask to hear of closes still closes cleanly.
      const popup = await buildPopup();
      await popup.showLabel(5, 'LabelMap');
      expect(() => dialog().close()).not.toThrow();
    });
  });

  describe('the URL', () => {
    test('with URL sync on, the open label rides in the URL and leaves it on close', async () => {
      const popup = await buildPopup({ syncUrlSource: 'LabelMap' });
      await popup.showLabel(7, 'LabelMap');
      expect(labelDetail.syncUrlLabelId).toHaveBeenLastCalledWith(7);

      dialog().close();
      expect(labelDetail.syncUrlLabelId).toHaveBeenLastCalledWith(null);
    });

    test('without URL sync, the URL is never touched', async () => {
      const popup = await buildPopup();
      await popup.showLabel(7, 'LabelMap');
      dialog().close();
      expect(labelDetail.syncUrlLabelId).not.toHaveBeenCalled();
    });

    test('a deep-linked label opens under the host\'s source, and the host waits on the viewer build', async () => {
      window.history.replaceState({}, '', '/labelMap?labelId=9');
      await buildPopup({ syncUrlSource: 'LabelMap' });

      expect(innerShow).toHaveBeenCalledWith(9, 'LabelMap');
      expect(dialog().open).toBe(true);
      expect(card.panoManager.warmUp).toHaveBeenCalledWith(3000);
    });

    test('a deep link to a label that will not load drops it from the URL', async () => {
      window.history.replaceState({}, '', '/labelMap?labelId=9');
      innerShow.mockRejectedValue(new Error('HTTP error 404'));
      await buildPopup({ syncUrlSource: 'LabelMap' });
      await flush();

      expect(labelDetail.syncUrlLabelId).toHaveBeenLastCalledWith(null);
    });

    test('with no label in the URL, nothing opens and the viewer is not built', async () => {
      await buildPopup({ syncUrlSource: 'LabelMap' });

      expect(innerShow).not.toHaveBeenCalled();
      expect(card.panoManager.warmUp).not.toHaveBeenCalled();
    });
  });

  test('the host hears of each open at once, and of its data only while that label is still up', async () => {
    const onShow = vi.fn();
    const onMetadata = vi.fn();
    const popup = await buildPopup({ onShow, onMetadata });
    holdShows();

    const first = popup.showLabel(1, 'LabelMap');
    const second = popup.showLabel(2, 'LabelMap');
    expect(onShow.mock.calls).toEqual([[1], [2]]);

    pendingShows.get(1)({ label_id: 1 });
    await first;
    expect(onMetadata).not.toHaveBeenCalled();

    pendingShows.get(2)({ label_id: 2 });
    await second;
    expect(onMetadata).toHaveBeenCalledWith(2, { label_id: 2 });
  });

  describe('the paging arrows', () => {
    const prev = () => document.querySelector('.label-detail__paging--prev');
    const next = () => document.querySelector('.label-detail__paging--next');

    /**
     * A navigator over labels 1-3 in order.
     * @returns {object}
     */
    const lineNav = () => ({
      next: (id) => (id < 3 ? id + 1 : null),
      prev: (id) => (id > 1 ? id - 1 : null),
      hasPrev: (id) => id > 1,
      hasNext: (id) => id < 3,
      onRefresh: vi.fn(),
    });

    test('stay hidden and do nothing until the host hands over a navigator', async () => {
      const popup = await buildPopup();
      await popup.showLabel(2, 'LabelMap');
      expect(prev().hidden).toBe(true);
      expect(next().hidden).toBe(true);

      next().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      prev().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(logged()).toEqual([]);
      expect(innerShow).toHaveBeenCalledTimes(1);
    });

    test('log a pointer click apart from the keyboard, and ignore an arrow with nowhere to go', async () => {
      const popup = await buildPopup();
      popup.setNearbyNavigator(lineNav());
      await popup.showLabel(3, 'LabelMap');

      expect(next().getAttribute('aria-disabled')).toBe('true');
      next().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(logged()).toEqual([]);
      expect(innerShow).toHaveBeenCalledTimes(1);

      await popup.showLabel(2, 'LabelMap');
      next().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(logged()).toEqual(['Click_module=LabelPopup_action=NextLabel_labelId=2']);
      expect(innerShow).toHaveBeenLastCalledWith(3, 'LabelMap');

      await popup.showLabel(2, 'LabelMap');
      prev().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); // The card's arrow-key shortcut.
      expect(logged()).toContain('KeyboardShortcut_module=LabelPopup_action=PrevLabel_labelId=2');
      expect(innerShow).toHaveBeenLastCalledWith(1, 'LabelMap');
    });

    test('a navigator handed over twice is listened to once', async () => {
      const popup = await buildPopup();
      const nav = lineNav();
      popup.setNearbyNavigator(nav);
      popup.setNearbyNavigator(nav);
      expect(nav.onRefresh).toHaveBeenCalledTimes(1);
    });

    test('a host without arrows still opens and closes labels', async () => {
      const popup = await buildPopup({}, false);
      await popup.showLabel(1, 'Dashboard');
      expect(dialog().open).toBe(true);
      dialog().close();
      expect(dialog().open).toBe(false);
    });
  });
});
