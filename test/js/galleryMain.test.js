/**
 * Tests for the Gallery's wiring (frontend/js/gallery/Main.js, #5840).
 *
 * Main is the one place the Gallery's modules are built, so what is worth pinning is that each gets the page's own
 * elements and the shared tracker, and that the narrow-layout filter toggle is wired only when the page renders it:
 * review-list mode (#5444) renders no sidebar at all, and the Gallery must still start there.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en' } }));

/** What the faked collaborators were built with, so a test can check the wiring. */
const built = { filter: null, container: null, keyboard: null };
const seedCounts = vi.fn();
const expandedView = { name: 'the expanded view' };

mockModule('frontend/js/common/BadgeAchievements.js', () => ({ BadgeAchievements: { seedCounts } }));
mockModule('frontend/js/gallery/filter/GalleryFilter.js', () => ({
  GalleryFilter: class {
    constructor(...args) { built.filter = { self: this, args }; }
  },
}));
mockModule('frontend/js/gallery/keyboard/KeyboardManager.js', () => ({
  KeyboardManager: class {
    constructor(...args) { built.keyboard = args; }
  },
}));
mockModule('frontend/js/gallery/cards/CardContainer.js', () => ({
  CardContainer: {
    create: async (...args) => {
      built.container = args;
      return { getExpandedView: () => expandedView };
    },
  },
}));

/** The elements gallery.scala.html renders for the filtered grid, the toggle included. */
const FILTERED_PAGE = `
  <div id="page-loading"></div>
  <div id="gallery">
    <div class="sidebar">
      <select id="gallery-sort"></select>
      <div class="gallery-filter-header">
        <button type="button" id="gallery-filter-toggle" aria-expanded="false"></button>
        <button type="button" id="clear-filters" hidden></button>
      </div>
      <div id="card-filter"><div id="gallery-filter-sections"></div></div>
    </div>
    <div id="labels-not-found-text"></div>
    <div id="gallery-content">
      <div id="image-card-container" class="cards"></div>
      <div class="gallery-expanded-view"></div>
    </div>
  </div>
  <div class="page-control">
    <button type="button" id="prev-page"></button>
    <div id="page-number"></div>
    <button type="button" id="next-page"></button>
  </div>`;

/** The same page in review-list mode, which renders no sidebar, sort or toggle. */
const LIST_PAGE = FILTERED_PAGE.replace(/<div class="sidebar">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '');

/**
 * @param {object} [overrides] - Fields to change on what the page was opened with.
 * @returns {object} The params gallery.js hands startGallery.
 */
const pageParams = (overrides = {}) => ({
  dataStoreUrl: '/galleryTask',
  initialFilters: { regionIds: [], aiValidationOptions: [], labelIds: [] },
  regionNames: { 7: 'Herrick Park' },
  viewerType: class FakeViewer {},
  viewerAccessToken: 'token',
  currUsername: 'mikey',
  ...overrides,
});

describe('starting the Gallery', () => {
  let startGallery;

  beforeEach(async () => {
    built.filter = null;
    built.container = null;
    built.keyboard = null;
    seedCounts.mockClear();
    ({ startGallery } = await loadModules('frontend/js/gallery/Main.js'));
  });

  /** @returns {string[]} The actions the shared tracker has buffered, read off the one handed to the filter. */
  const loggedActions = () => built.filter.args[4].getActions().map((a) => a.action);

  it('builds the filter and the card grid on the page\'s own elements, sharing one tracker', async () => {
    document.body.innerHTML = FILTERED_PAGE;
    const params = pageParams();

    await startGallery(params);

    expect(seedCounts).toHaveBeenCalled();
    const [filterRoot, clear, sort, initialFilters, tracker] = built.filter.args;
    expect(filterRoot).toBe(document.getElementById('card-filter'));
    expect(clear).toBe(document.getElementById('clear-filters'));
    expect(sort).toBe(document.getElementById('gallery-sort'));
    expect(initialFilters).toBe(params.initialFilters);

    const [ui, containerParams, cardFilter, containerTracker] = built.container;
    expect(ui.holder).toBe(document.getElementById('image-card-container'));
    expect(ui.pageControl).toBe(document.querySelector('.page-control'));
    expect(ui.expandedView).toBe(document.querySelector('.gallery-expanded-view'));
    expect(containerParams).toEqual({
      initialFilters: params.initialFilters,
      regionNames: { 7: 'Herrick Park' },
      panoViewerType: params.viewerType,
      viewerAccessToken: 'token',
      currUsername: 'mikey',
    });
    expect(cardFilter).toBe(built.filter.self);
    expect(containerTracker).toBe(tracker);
    expect(built.keyboard).toEqual([expandedView, tracker]);
  });

  it('hands the cards an empty name map when the page carries none, so no card shows a region line', async () => {
    document.body.innerHTML = FILTERED_PAGE;

    await startGallery(pageParams({ regionNames: undefined }));

    expect(built.container[1].regionNames).toEqual({});
  });

  it('opens and closes the narrow-layout filters from the toggle, logging each', async () => {
    document.body.innerHTML = FILTERED_PAGE;
    await startGallery(pageParams());
    const toggle = document.getElementById('gallery-filter-toggle');
    const sidebar = document.querySelector('.sidebar');

    toggle.click();
    expect(sidebar.classList.contains('mobile-visible')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(sidebar.classList.contains('mobile-visible')).toBe(false);
    expect(loggedActions()).toEqual(['FilterDisclosureOpen', 'FilterDisclosureClose']);
  });

  it('starts a review list, which has no sidebar and so no toggle', async () => {
    document.body.innerHTML = LIST_PAGE;

    await startGallery(pageParams({ initialFilters: { regionIds: [], aiValidationOptions: [], labelIds: [3] } }));

    // The filter is still built, sidebar-less, because it owns the address bar.
    expect(built.filter.args.slice(0, 3)).toEqual([null, null, null]);
    expect(built.keyboard).not.toBeNull();
    expect(loggedActions()).toEqual([]);
  });
});
