/**
 * Tests Gallery's expanded view (frontend/js/gallery/expandedview/ExpandedView.js, #5840): opening it on a grid
 * card, paging through the cards (across a page boundary too), the "k of N" position in a review list, closing it
 * back onto the grid, and reopening a shared `?labelId=` link.
 *
 * LabelDetail is faked, so no imagery viewer (and no billable Google pano) is ever built: the view's job is what it
 * hands the card and what it does to the grid around it. The markup is the inline label detail Gallery renders
 * (gallery.scala.html with `common.labelDetail(withPaging = true)`), cut to the parts this class reads.
 */
import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

/** What the fake LabelDetail was built with and what it was asked to do, per test. */
let labelDetail;
let cardOpts;
let urlLabelId;
const syncUrlLabelId = vi.fn();

mockModule('i18next', () => ({ default: { t: (key, opts) => (opts ? `${key}(${opts.k}/${opts.n})` : key) } }));
mockModule('frontend/js/common/ReasonPopover.js', () => ({ closeReasonPopover: vi.fn() }));
mockModule('frontend/js/common/label-detail/PopupPanoManager.js', () => ({
  PopupPanoManager: { DEEP_LINK_BUILD_WAIT_MS: 1234 },
}));
mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({
  LabelDetail: {
    create: async (_root, opts) => {
      cardOpts = opts;
      return labelDetail;
    },
    urlLabelId: () => urlLabelId,
    syncUrlLabelId,
  },
}));

/**
 * A grid card stand-in, with what the view reads to open on it.
 * @param {number} labelId - The card's label.
 * @returns {object} The card.
 */
function stubCard(labelId) {
  const properties = {
    label_id: labelId, label_type: 'Obstacle', pano_id: `pano-${labelId}`, lat: 47.6, lng: -122.3,
    camera_lat: 47.61, camera_lng: -122.31, image_capture_date: '2024-05', label_timestamp: 1700000000000,
    heading: 90, pitch: -10, zoom: 2, original_canvas_x: 300, original_canvas_y: 200, original_canvas_width: 720,
    original_canvas_height: 480, pano_source: 'gsv', severity: 2, description: 'a pole', street_edge_id: 5,
    region_id: 3, val_counts: { Agree: 4, Disagree: 1, Unsure: 2 }, user_validation: null, ai_validation: 'Agree',
    tags: ['narrow'], ai_generated: false, pano_data: null, from_current_user: false, can_edit: false,
    deleted: false, can_restore: false, expired: false, comments: [],
  };
  return {
    getLabelId: () => labelId,
    getProperties: () => properties,
    getCropUrl: () => `/crops/${labelId}.jpg`,
    getCropMarker: () => null,
    getBackupImageData: () => null,
  };
}

/**
 * The card container the view pages through: `ids` split into pages of `perPage`, on page `page`.
 * @param {object} [opts]
 * @param {number[]} [opts.ids] - The label ids loaded, in order.
 * @param {number} [opts.perPage] - Cards per page.
 * @param {number} [opts.page] - The page showing, from 1.
 * @param {?number} [opts.listSize] - A review list's length, or null outside list mode.
 * @returns {object} The container, whose page can be moved by setting `page`.
 */
function stubContainer({ ids = [1, 2, 3], perPage = 3, page = 1, listSize = null } = {}) {
  const cards = ids.map(stubCard);
  const container = {
    page,
    getCardByIndex: (i) => cards[i],
    findCardByLabelId: (id) => cards.find((c) => c.getLabelId() === id),
    getCurrentPage: () => container.page,
    getCardsPerPage: () => perPage,
    getCurrentCards: () => ({ getSize: () => cards.length }),
    getCurrentPageCards: () => cards.slice((container.page - 1) * perPage, container.page * perPage),
    isLastPage: () => container.page * perPage >= cards.length,
    isListMode: () => listSize !== null,
    getListSize: () => listSize,
    jumpToLabel: vi.fn(() => false),
    nextPage: vi.fn(() => { container.page += 1; }),
    prevPage: vi.fn(() => { container.page -= 1; }),
  };
  return container;
}

/**
 * Renders the page and the grid cards for the container's current page, and builds the view.
 * @param {object} container - From stubContainer.
 * @returns {Promise<object>} The view.
 */
async function build(container) {
  document.body.innerHTML = `
    <nav id="header"></nav>
    <div id="image-card-container" class="cards"></div>
    <div class="gallery-expanded-view label-detail label-detail--inline">
      <header class="label-detail__header">
        <button type="button" class="label-detail__close" data-action="close-label-detail"></button>
      </header>
      <div class="label-detail__pano-wrap">
        <button type="button" class="label-detail__paging label-detail__paging--prev"></button>
        <span class="label-detail__position" hidden></span>
        <div class="label-detail__pano"></div>
        <button type="button" class="label-detail__paging label-detail__paging--next"></button>
      </div>
    </div>`;
  renderGrid(container);
  const { ExpandedView } = await loadModules('frontend/js/gallery/expandedview/ExpandedView.js');
  return ExpandedView.create(document.querySelector('.gallery-expanded-view'), {
    panoViewerType: 'viewer-class', viewerAccessToken: 'token', currUsername: 'tester',
  }, container, tracker);
}

/**
 * Draws the container's current page of grid cards, as CardContainer does on a page change.
 * @param {object} container - From stubContainer.
 */
function renderGrid(container) {
  const grid = document.getElementById('image-card-container');
  grid.innerHTML = container.getCurrentPageCards()
    .map((c) => `<div id="gallery_card_${c.getLabelId()}" class="gallery-card"></div>`).join('');
  for (const el of grid.children) el.scrollIntoView = vi.fn();
}

const root = () => document.querySelector('.gallery-expanded-view');
const prev = () => document.querySelector('.label-detail__paging--prev');
const next = () => document.querySelector('.label-detail__paging--next');
/** Whether an arrow is switched off; the arrows use aria-disabled so they keep focus (#5135). */
const isOff = (btn) => btn.getAttribute('aria-disabled') === 'true';
const position = () => document.querySelector('.label-detail__position');
const pano = () => document.querySelector('.label-detail__pano');
const gridCard = (id) => document.getElementById(`gallery_card_${id}`);
const dimmed = () => [...document.querySelectorAll('.expanded-view-background-card')].map((el) => el.id);
/** @returns {?number} The label id of the card last handed to LabelDetail. */
const shownId = () => labelDetail.showLabel.mock.lastCall?.[0]?.label_id ?? null;
const click = (el, detail = 1) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));

let tracker;

beforeEach(() => {
  urlLabelId = null;
  tracker = fakeTracker();
  labelDetail = {
    panoManager: { warmUp: vi.fn(async () => {}) },
    showLabel: vi.fn(async () => {}),
    saveOpenEdits: vi.fn(),
  };
  vi.stubGlobal('requestAnimationFrame', (callback) => callback());
  window.scrollTo = vi.fn();
});

describe('the Gallery expanded view', () => {
  test('builds the label card for Gallery, telling it whether the view is on screen', async () => {
    const view = await build(stubContainer());

    expect(cardOpts).toMatchObject({
      admin: false, viewerType: 'viewer-class', viewerAccessToken: 'token', currUsername: 'tester',
      panoOverlaySource: 'GalleryExpandedImage', voteColumnSource: 'GalleryExpandedThumbs',
    });
    expect(view.panoManager).toBe(labelDetail.panoManager);
    expect(cardOpts.isOpen()).toBe(false);
    view.updateCardIndex(0);
    expect(cardOpts.isOpen()).toBe(true);
    expect(labelDetail.panoManager.warmUp).not.toHaveBeenCalled();
  });

  test('opening on a card hands it the card\'s label and dims the rest of the page', async () => {
    const view = await build(stubContainer());

    view.updateCardIndex(1);

    expect(labelDetail.showLabel).toHaveBeenCalledWith(expect.objectContaining({
      label_id: 2, label_type: 'Obstacle', pano_id: 'pano-2', timestamp: 1700000000000, canvas_x: 300,
      canvas_y: 200, canvas_width: 720, canvas_height: 480, num_agree: 4, num_disagree: 1, num_unsure: 2,
      crop_url: '/crops/2.jpg', ai_validation: 'Agree', tags: ['narrow'],
    }), 'GalleryExpanded');
    expect(view.getReferenceCard().getLabelId()).toBe(2);
    expect(root().style.visibility).toBe('visible');
    expect(syncUrlLabelId).toHaveBeenLastCalledWith(2);
    expect(dimmed()).toEqual(['gallery_card_1', 'gallery_card_3']);
    expect(gridCard(2).scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  test('the arrows page through the cards, logged as a click or, with no pointer, a keyboard shortcut', async () => {
    const view = await build(stubContainer());
    view.updateCardIndex(0);
    expect(isOff(prev())).toBe(true);
    expect(isOff(next())).toBe(false);

    click(next());
    expect(shownId()).toBe(2);
    expect(isOff(prev())).toBe(false);
    expect(dimmed()).toEqual(['gallery_card_1', 'gallery_card_3']);

    click(next(), 0);
    expect(shownId()).toBe(3);
    // The last card of the last page has nothing after it, and sits at the bottom of the grid.
    expect(isOff(next())).toBe(true);
    expect(gridCard(3).scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });

    click(prev(), 0);
    expect(shownId()).toBe(2);
    click(prev());
    expect(shownId()).toBe(1);

    expect(tracker.push.mock.calls.map(([name]) => name)).toEqual([
      'NextLabelClick', 'NextLabelKeyboardShortcut', 'PrevLabelKeyboardShortcut', 'PrevLabelClick',
    ]);
  });

  test('the last card\'s Next switches off with focus kept on it, and then ignores presses (#5135)', async () => {
    const view = await build(stubContainer());
    view.updateCardIndex(1);
    next().focus();

    click(next(), 0);

    expect(shownId()).toBe(3);
    expect(isOff(next())).toBe(true);
    expect(next().disabled).toBe(false); // Never native `disabled`: a browser drops focus off that.
    expect(document.activeElement).toBe(next());

    tracker.push.mockClear();
    const shownBefore = labelDetail.showLabel.mock.calls.length;
    click(next(), 0);
    click(next());
    expect(labelDetail.showLabel.mock.calls.length).toBe(shownBefore);
    expect(tracker.push).not.toHaveBeenCalled();

    click(prev());
    expect(isOff(next())).toBe(false);
  });

  test('paging past the last card on a page loads the next page and opens its first card there', async () => {
    const container = stubContainer({ ids: [1, 2, 3, 4], perPage: 2 });
    const view = await build(container);
    view.updateCardIndex(1);
    const shownBefore = labelDetail.showLabel.mock.calls.length;

    view.nextLabel(false);

    expect(container.nextPage).toHaveBeenCalledTimes(1);
    expect(labelDetail.showLabel.mock.calls.length).toBe(shownBefore);
    renderGrid(container);
    view.onPageCardsRendered();
    expect(shownId()).toBe(3);
    expect(isOff(prev())).toBe(false);

    // A render with no page change pending (a filter refetch, say) leaves the view on its card.
    view.onPageCardsRendered();
    expect(labelDetail.showLabel.mock.calls.length).toBe(shownBefore + 1);
  });

  test('paging back from the first card on a later page loads the page before and opens its last card', async () => {
    const container = stubContainer({ ids: [1, 2, 3, 4], perPage: 2, page: 2 });
    const view = await build(container);
    view.updateCardIndex(2);

    view.previousLabel(true);
    expect(container.prevPage).toHaveBeenCalledTimes(1);
    renderGrid(container);
    view.onPageCardsRendered();

    expect(shownId()).toBe(2);
    expect(tracker.push).toHaveBeenCalledWith('PrevLabelKeyboardShortcut');
  });

  test('an index with no card behind it closes the view rather than showing nothing', async () => {
    const view = await build(stubContainer());
    view.updateCardIndex(0);

    view.updateCardIndex(7);

    expect(view.open).toBe(false);
    expect(root().style.visibility).toBe('hidden');
    expect(dimmed()).toEqual([]);
  });

  test('shows "k of N" in a review list, and nothing outside one', async () => {
    const listView = await build(stubContainer({ listSize: 3 }));
    listView.updateCardIndex(1);
    expect(position().hidden).toBe(false);
    expect(position().textContent).toBe('gallery:list-position(2/3)');

    const gridView = await build(stubContainer());
    gridView.updateCardIndex(1);
    expect(position().hidden).toBe(true);
    expect(position().textContent).toBe('');
  });

  test('the close button hides the view, undims the grid and scrolls the card back under the navbar', async () => {
    const view = await build(stubContainer());
    view.updateCardIndex(1);
    Object.defineProperty(document.getElementById('header'), 'offsetHeight', { value: 60 });
    document.getElementById('image-card-container').style.rowGap = '16px';
    gridCard(2).getBoundingClientRect = () => ({ top: 500 });

    document.querySelector('[data-action="close-label-detail"]').click();

    expect(view.open).toBe(false);
    expect(labelDetail.saveOpenEdits).toHaveBeenCalled();
    expect(root().style.visibility).toBe('hidden');
    expect(syncUrlLabelId).toHaveBeenLastCalledWith(null);
    // A pano still loading must not reveal itself into a closed view.
    expect(pano().dataset.closedDuringLoad).toBe('true');
    expect(dimmed()).toEqual([]);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 500 - 60 - 16, behavior: 'smooth' });

    view.updateCardIndex(0);
    expect(pano().dataset.closedDuringLoad).toBeUndefined();
  });

  test('closing scrolls to the card with no navbar or row gap to allow for, and not at all once it is gone',
    async () => {
      const view = await build(stubContainer());
      view.updateCardIndex(0);
      document.getElementById('header').remove();
      gridCard(1).getBoundingClientRect = () => ({ top: 240 });

      view.closeExpandedViewAndRemoveCardTransparency();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'smooth' });

      view.updateCardIndex(0);
      gridCard(1).remove();
      window.scrollTo.mockClear();
      view.closeExpandedViewAndRemoveCardTransparency();
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

  test('closing before any card was opened just hides the view', async () => {
    const view = await build(stubContainer());

    view.closeExpandedViewAndRemoveCardTransparency();

    expect(view.open).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe('a ?labelId= deep link', () => {
  test('starts the viewer while the cards load, then opens the label by id once they have', async () => {
    urlLabelId = 42;
    const view = await build(stubContainer());
    expect(labelDetail.panoManager.warmUp).toHaveBeenCalledWith(1234);

    view.restoreFromUrl();

    expect(syncUrlLabelId).toHaveBeenCalledWith(42);
    expect(labelDetail.showLabel).toHaveBeenCalledWith(42, 'GalleryExpanded');
    expect(view.open).toBe(true);
    expect(root().style.visibility).toBe('visible');
    // No grid card behind it, so there is nothing to page back to.
    expect(isOff(prev())).toBe(true);

    // One shot: a later render (paging, a filter change) must not reopen it.
    view.restoreFromUrl();
    expect(labelDetail.showLabel).toHaveBeenCalledTimes(1);
  });

  test('from a review list that holds the label, opens it at its place in the list', async () => {
    urlLabelId = 2;
    const container = stubContainer({ listSize: 3 });
    container.jumpToLabel.mockReturnValue(true);
    const view = await build(container);

    view.restoreFromUrl();

    expect(container.jumpToLabel).toHaveBeenCalledWith(2);
    expect(labelDetail.showLabel).not.toHaveBeenCalled();
  });

  test('closes the view again when the label can\'t be shown', async () => {
    urlLabelId = 42;
    labelDetail.showLabel.mockRejectedValueOnce(new Error('no such label'));
    const view = await build(stubContainer());

    view.restoreFromUrl();
    await Promise.resolve();
    await Promise.resolve();

    expect(view.open).toBe(false);
    expect(root().style.visibility).toBe('hidden');
  });

  test('does nothing on a visit with no deep link', async () => {
    const view = await build(stubContainer());

    view.restoreFromUrl();

    expect(labelDetail.showLabel).not.toHaveBeenCalled();
    expect(syncUrlLabelId).not.toHaveBeenCalled();
  });
});
