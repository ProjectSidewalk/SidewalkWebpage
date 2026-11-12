/**
 * Tests for the filtered Gallery grid (frontend/js/gallery/cards/CardContainer.js and CardBucket.js, #5840).
 *
 * The filtered grid fetches labels a batch at a time and keeps every card it has seen, re-applying the sidebar's
 * filters to that cache on each change. What is worth pinning is what the reader sees and what is asked of the
 * server: the query matches the sidebar, a page is served from the cache until it runs short, a sorted order starts
 * its cache over on any change (#2705), clicks on a card open the right label, and an empty answer says so.
 * Review-list mode, the other half of this container, has its own suite (galleryListMode.test.js).
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoOverlays } from './fakes.js';
import { flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

// The card's own displays draw nothing these tests read; the container only places and re-fits the cards.
mockModule('frontend/js/gallery/displays/SeverityDisplay.js', () => ({ SeverityDisplay: class {} }));
mockModule('frontend/js/gallery/displays/ValidationInfoDisplay.js', () => ({ ValidationInfoDisplay: class {} }));
mockModule('frontend/js/gallery/validation/ValidationMenu.js', () => ({ ValidationMenu: class {} }));
/** How many times tags were fitted to a card, so a re-fit after a resize is visible. */
const tagFits = { count: 0 };
mockModule('frontend/js/gallery/displays/TagDisplay.js', () => ({
  TagDisplay: class {
    constructor() { tagFits.count += 1; }
  },
}));
fakePanoOverlays();

/** The expanded view the container builds, as a set of spies: it is another module's, faked here. */
let view;
mockModule('frontend/js/gallery/expandedview/ExpandedView.js', () => ({
  ExpandedView: { create: async () => view },
}));

/**
 * One entry of POST /label/labels, as GalleryController writes it. No imagery, so a card loads without a request.
 * @param {number} labelId - The label's id.
 * @param {object} [overrides] - Fields to change on the label.
 * @returns {object} The entry.
 */
function entry(labelId, overrides = {}) {
  return {
    label: {
      label_id: labelId, label_type: 'CurbRamp', pano_id: `pano-${labelId}`, region_id: 7, severity: 2,
      canvas_x: 360, canvas_y: 240, canvas_width: 720, canvas_height: 480, correct: null, agree_count: 0,
      disagree_count: 0, unsure_count: 0, user_validation: null, ai_validation: null, tags: [], ai_generated: false,
      comments: [], backup_image_url: null, ...overrides,
    },
    cropUrl: null,
    thumbnailUrl: null,
    cropMarker: null,
    gsvImageUrl: null,
  };
}

/**
 * @param {number} from - The first label id.
 * @param {number} count - How many entries.
 * @param {object} [overrides] - Fields to change on every label.
 * @returns {object[]} Consecutive entries.
 */
const entries = (from, count, overrides) => Array.from({ length: count }, (_, i) => entry(from + i, overrides));

describe('the filtered Gallery grid', () => {
  let CardContainer;
  /** @type {object} The elements the container drives, as Main passes them from gallery.scala.html. */
  let ui;
  /** @type {object} The sidebar's state, which each test sets before the change it reports. */
  let filterState;
  /** @type {object} The sidebar as the container sees it. */
  let cardFilter;
  let tracker;
  /** @type {object[]} The bodies POSTed to /label/labels. */
  let requests;
  /** @type {Array<(body: *) => void>} Answers for the requests still in flight, oldest first. */
  let pending;
  /** @type {?Function} What the container asked the ResizeObserver to call. */
  let onResize;

  /**
   * Answers the oldest request in flight.
   * @param {object[]} labels - The entries to answer with.
   */
  async function answer(labels) {
    pending.shift()({ ok: true, json: async () => ({ labelsOfType: labels }) });
    await flush();
  }

  /** @returns {number[]} The label ids of the cards in the grid, in order. */
  const shownIds = () => [...ui.holder.querySelectorAll('.gallery-card')]
    .map((el) => Number(el.id.replace('gallery_card_', '')));

  /** @returns {string[]} The actions the container logged, in order. */
  const logged = () => tracker.push.mock.calls.map(([action]) => action);

  /**
   * Builds the container and answers its opening query.
   * @param {object[]} labels - What the opening query returns.
   * @returns {Promise<CardContainer>} The container, with the first page rendered.
   */
  async function open(labels) {
    const created = CardContainer.create(ui, {
      initialFilters: { regionIds: [3], aiValidationOptions: ['correct'], labelIds: [] },
      regionNames: {},
      panoViewerType: null,
      viewerAccessToken: null,
      currUsername: null,
    }, cardFilter, tracker);
    const container = await created;
    await answer(labels);
    return container;
  }

  beforeAll(async () => {
    window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
    ({ CardContainer } = await loadModules('frontend/js/gallery/cards/CardContainer.js'));
  });

  beforeEach(() => {
    // The ids gallery.scala.html gives these, so a fixture that drifts from the page is visible here.
    document.body.innerHTML = `
      <div id="page-loading"></div>
      <div id="labels-not-found-text"></div>
      <div id="image-card-container" class="cards"></div>
      <div class="gallery-expanded-view"></div>
      <div class="page-control">
        <button type="button" id="prev-page"></button>
        <div id="page-number"></div>
        <button type="button" id="next-page"></button>
      </div>`;
    ui = {
      holder: document.getElementById('image-card-container'),
      prevPage: document.getElementById('prev-page'),
      pageNumber: document.getElementById('page-number'),
      nextPage: document.getElementById('next-page'),
      pageControl: document.querySelector('.page-control'),
      pageLoading: document.getElementById('page-loading'),
      labelsNotFound: document.getElementById('labels-not-found-text'),
      expandedView: document.querySelector('.gallery-expanded-view'),
    };
    filterState = {
      types: ['CurbRamp'], valOptions: ['correct', 'unvalidated'], severities: ['1', '2', '3'], tagsByType: {},
      sort: 'random',
    };
    cardFilter = {
      getStatus: () => ({ currentLabelTypes: filterState.types }),
      getAppliedValidationOptions: () => filterState.valOptions,
      getAppliedSeverities: () => filterState.severities,
      getAppliedTagsByType: () => filterState.tagsByType,
      getAppliedTagNames: () => [],
      getSort: () => filterState.sort,
      onUpdate: (listener) => { cardFilter.update = listener; },
      onSortChange: (listener) => { cardFilter.sortChange = listener; },
      disable: vi.fn(),
      enable: vi.fn(),
    };
    view = {
      onPageCardsRendered: vi.fn(),
      restoreFromUrl: vi.fn(),
      closeExpandedView: vi.fn(),
      updateCardIndex: vi.fn(),
    };
    tracker = fakeTracker();
    requests = [];
    pending = [];
    window.fetch = (url, { body }) => new Promise((resolve) => {
      requests.push(JSON.parse(body));
      pending.push(resolve);
    });
    window.scrollTo = vi.fn(); // jsdom has none; the container scrolls to the top on each new query.
    onResize = null;
    window.ResizeObserver = class {
      constructor(callback) { onResize = callback; }

      observe() {}
    };
    tagFits.count = 0;
  });

  describe('opening the page', () => {
    it('asks for the sidebar\'s selection and the page\'s own region and AI filters', async () => {
      filterState.tagsByType = { CurbRamp: ['narrow'] };
      await open([]);

      expect(requests).toEqual([{
        label_types: ['CurbRamp'], n: 30, validation_options: ['correct', 'unvalidated'], region_ids: [3],
        severities: ['1', '2', '3'], tags_by_label_type: { CurbRamp: ['narrow'] }, ai_validation_options: ['correct'],
        loaded_labels: [],
      }]);
    });

    it('leaves severity out of the query when no selected type is rated', async () => {
      // Otherwise the "N/A" toggle, which every unrated label falls under, would decide whether they show at all.
      filterState.types = ['Signal'];
      await open([]);

      expect(requests[0]).not.toHaveProperty('severities');
    });

    it('shows the first nine cards and lets the reader page on when there are more', async () => {
      await open(entries(1, 12));

      expect(shownIds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(ui.pageNumber.innerText).toBe('1');
      expect(ui.prevPage.disabled).toBe(true);
      expect(ui.nextPage.disabled).toBe(false);
      expect(ui.pageControl.style.display).toBe('');
      expect(ui.pageLoading.style.display).toBe('none');
      expect(cardFilter.enable).toHaveBeenCalled();
      // The page is handed to the expanded view, which opens a ?labelId= deep link from it.
      expect(view.onPageCardsRendered).toHaveBeenCalled();
      expect(view.restoreFromUrl).toHaveBeenCalled();
    });

    it('says nothing matched, and hides the paging, when the query found nothing', async () => {
      await open([]);

      expect(ui.labelsNotFound.style.display).toBe('block');
      expect(ui.pageControl.style.display).toBe('none');
      expect(cardFilter.enable).toHaveBeenCalled();
    });

    it('reports a failed query on the console and shows an empty grid rather than hanging', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const created = CardContainer.create(ui, {
        initialFilters: { regionIds: [], aiValidationOptions: [], labelIds: [] }, regionNames: {},
      }, cardFilter, tracker);
      await created;
      pending.shift()({ ok: false, status: 503 });
      await flush();

      expect(error).toHaveBeenCalledWith(new Error('/label/labels responded 503'));
      expect(ui.labelsNotFound.style.display).toBe('block');
      expect(ui.pageLoading.style.display).toBe('none');
    });
  });

  describe('paging', () => {
    it('turns to a page the cache already holds without asking the server again', async () => {
      const container = await open(entries(1, 30));

      ui.nextPage.click();
      await flush();

      expect(requests).toHaveLength(1);
      expect(shownIds()).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
      expect(container.getCurrentPage()).toBe(2);
      expect(String(ui.pageNumber.innerText)).toBe('2');
      expect(ui.prevPage.disabled).toBe(false);
      expect(container.isLastPage()).toBe(false);
      expect(logged()).toEqual(['NextPage', 'NextPageClick']);
      expect(tracker.push).toHaveBeenCalledWith('NextPage', null, { from: 1, to: 2 });
      // A new page closes the expanded view and returns the reader to the top.
      expect(view.closeExpandedView).toHaveBeenCalled();
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });

    it('fetches more once the cache runs short, excluding the labels it already has', async () => {
      const container = await open(entries(1, 12));

      ui.nextPage.click();
      expect(requests[1]).toMatchObject({ n: 18, loaded_labels: entries(1, 12).map((e) => e.label.label_id) });
      // Until the answer lands the filters are locked and the loading notice is up.
      expect(cardFilter.disable).toHaveBeenCalled();
      expect(ui.pageLoading.style.display).toBe('');
      await answer(entries(13, 2));

      expect(shownIds()).toEqual([10, 11, 12, 13, 14]);
      expect(container.isLastPage()).toBe(true);
      expect(ui.nextPage.disabled).toBe(true);
    });

    it('keeps cards in arrival order, so a fetch of a common type never pushes a rarer type off its page', async () => {
      filterState.types = ['CurbRamp', 'Obstacle'];
      const container = await open([...entries(1, 7), entry(8, { label_type: 'Obstacle' }), ...entries(9, 4)]);
      expect(shownIds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Page 2 needs a fetch, and in a city of mostly curb ramps it brings back only curb ramps.
      ui.nextPage.click();
      await answer(entries(13, 18));
      expect(shownIds()).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);

      // Grouped by type, the obstacle would now sit behind all 29 curb ramps, on page 4.
      container.prevPage();
      await flush();
      expect(shownIds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('pages back, and goes no further back than the first page', async () => {
      const container = await open(entries(1, 30));
      ui.nextPage.click();
      await flush();
      tracker.push.mockClear();

      ui.prevPage.click();
      await flush();
      expect(container.getCurrentPage()).toBe(1);
      expect(shownIds()[0]).toBe(1);
      expect(ui.prevPage.disabled).toBe(true);
      expect(ui.nextPage.disabled).toBe(false);
      expect(logged()).toEqual(['PrevPage', 'PrevPageClick']);

      tracker.push.mockClear();
      container.prevPage(); // What the expanded view calls when stepping back past the first label.
      expect(logged()).toEqual([]);
      expect(container.getCurrentPage()).toBe(1);
    });

    it('serves the cards the page shows to whoever asks by position or by label', async () => {
      filterState.types = ['Obstacle'];
      const container = await open(entries(1, 12, { label_type: 'Obstacle' }));

      expect(container.getCardsPerPage()).toBe(9);
      expect(container.isListMode()).toBe(false);
      expect(container.getListSize()).toBe(0);
      expect(container.getCurrentPageCards().map((c) => c.getLabelId())).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(container.getCardByIndex(10).getLabelId()).toBe(11);
      expect(container.findCardByLabelId(12).getLabelId()).toBe(12);
      expect(container.findCardByLabelId(999)).toBeNull();
      // A ?labelId= deep link in the filtered grid opens by id instead; only a review list jumps by position.
      expect(container.jumpToLabel(3)).toBe(false);
    });
  });

  describe('opening a card', () => {
    /**
     * Clicks an element inside a card and returns the position the expanded view was asked to open.
     * @param {string} selector - What to click, inside the grid.
     * @returns {?number} The index handed to the view, or null if it wasn't asked.
     */
    function clickAndRead(selector) {
      view.updateCardIndex.mockClear();
      ui.holder.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return view.updateCardIndex.mock.calls.at(-1)?.[0] ?? null;
    }

    beforeEach(async () => {
      await open([entry(1), entry(2, { ai_generated: true }), entry(3, { tags: ['a', 'b', 'c'] })]);
    });

    it('opens the label whose image was clicked', () => {
      expect(clickAndRead('#label_id_2')).toBe(1);
    });

    it('opens the label from its AI marker or its no-image placeholder', () => {
      expect(clickAndRead('#gallery_card_2 .ai-icon-marker-card')).toBe(1);
      expect(clickAndRead('#gallery_card_1 .gallery-image-placeholder')).toBe(0);
    });

    it('opens the label from the "+n" pill on its tags', () => {
      // TagDisplay (faked here) folds the tags that don't fit into this pill.
      const pill = document.createElement('span');
      pill.className = 'gallery-tag additional-count';
      ui.holder.querySelector('#gallery_card_3 .card-tags').append(pill);

      expect(clickAndRead('#gallery_card_3 .additional-count')).toBe(2);
    });

    it('opens nothing for a click on the card\'s text', () => {
      expect(clickAndRead('#gallery_card_1 .card-header')).toBeNull();
    });
  });

  describe('a resize', () => {
    it('re-fits the tags once the width settles, and not for a height-only change', async () => {
      await open(entries(1, 3));
      vi.useFakeTimers();
      const fitsBefore = tagFits.count;

      onResize([{ contentRect: { width: 800 } }]);
      onResize([{ contentRect: { width: 600 } }]);
      vi.advanceTimersByTime(150);
      expect(tagFits.count).toBe(fitsBefore + 3); // Once per card, after the last change.

      onResize([{ contentRect: { width: 600 } }]);
      vi.advanceTimersByTime(150);
      expect(tagFits.count).toBe(fitsBefore + 3);
    });
  });

  describe('a filter change', () => {
    it('re-filters the cache by tag, per type, and by severity and validation', async () => {
      filterState.types = ['CurbRamp', 'Occlusion', 'Obstacle'];
      filterState.severities = ['2', 'null'];
      filterState.valOptions = ['correct', 'unvalidated'];
      await open([
        entry(1, { tags: ['narrow'] }),
        entry(2, { tags: ['steep'] }),
        entry(3, { label_type: 'Occlusion', severity: null }),
        entry(4, { label_type: 'Obstacle', tags: ['narrow'], severity: 3 }),
        entry(5, { label_type: 'Obstacle', tags: ['narrow'], severity: null }),
        entry(6, { tags: ['narrow'], correct: false, disagree_count: 2 }),
      ]);

      // Only CurbRamp's tag is narrowed; a curb ramp's "narrow" says nothing about an obstacle.
      filterState.tagsByType = { CurbRamp: ['narrow'], Occlusion: ['ignored'] };
      cardFilter.update();
      await answer([]);

      // 2 lacks the tag, 4 has the wrong severity, 6 is incorrect; Occlusion carries no tags, so 3 stays.
      expect(shownIds()).toEqual([1, 3, 5]);
      expect(requests[1].loaded_labels).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('starts again from page 1, closing the expanded view, when the type changes', async () => {
      const container = await open(entries(1, 30));
      ui.nextPage.click();
      await flush();
      view.closeExpandedView.mockClear();

      filterState.types = ['Obstacle'];
      cardFilter.update();

      expect(container.getCurrentPage()).toBe(1);
      expect(view.closeExpandedView).toHaveBeenCalled();
      expect(requests.at(-1).label_types).toEqual(['Obstacle']);
    });

    it('shows nothing, and asks nothing, with every type deselected', async () => {
      const container = await open(entries(1, 3));

      filterState.types = [];
      cardFilter.update();

      expect(requests).toHaveLength(1);
      expect(shownIds()).toEqual([]);
      expect(container.isLastPage()).toBe(true);
      expect(ui.labelsNotFound.style.display).toBe('block');
    });

    it('serves a filter that only narrows from the cache when the cache still fills the page', async () => {
      await open(entries(1, 30));

      filterState.valOptions = ['unvalidated'];
      cardFilter.update();
      await flush();

      expect(requests).toHaveLength(1);
      expect(shownIds()).toHaveLength(9);
    });

    it('forgets the cache in a sorted order, since it is no longer the top of the new ranking (#2705)', async () => {
      filterState.sort = 'most_severe';
      await open(entries(1, 3));
      expect(requests[0].sort).toBe('most_severe');

      filterState.severities = ['3'];
      cardFilter.update();

      expect(requests[1]).toMatchObject({ sort: 'most_severe', loaded_labels: [] });
    });
  });

  describe('a sort change (#2705)', () => {
    it('starts over from an empty cache and keeps the server\'s order across types', async () => {
      filterState.types = ['CurbRamp', 'Obstacle'];
      const container = await open(entries(1, 30));
      ui.nextPage.click();
      await flush();

      filterState.sort = 'newest';
      cardFilter.sortChange();
      expect(container.getCurrentPage()).toBe(1);
      expect(requests.at(-1)).toMatchObject({ sort: 'newest', loaded_labels: [] });
      await answer([entry(40, { label_type: 'Obstacle' }), entry(41), entry(42, { label_type: 'Obstacle' })]);

      // Grouped by type bucket these would come back 41, 40, 42.
      expect(shownIds()).toEqual([40, 41, 42]);
    });

    it('starts over even going back to random, so a ranking never seeds a random sample', async () => {
      filterState.sort = 'newest';
      await open(entries(1, 3));

      filterState.sort = 'random';
      cardFilter.sortChange();

      expect(requests.at(-1).loaded_labels).toEqual([]);
      expect(requests.at(-1)).not.toHaveProperty('sort');
    });
  });
});
