/** @namespace */
window.sg = window.sg || {};

/**
 * Main module for Gallery.
 *
 * Construct instances via the `static async create()` factory, which initializes the gallery before resolving.
 */
class Main {
  /**
   * Creates and initializes the Gallery Main module.
   * @param {object} params Object passed from gallery.scala.html containing initial values pulled from the database
   *              on page load.
   * @returns {Promise<Main>}
   */
  static async create(params) {
    const main = new Main();
    main.#initUI();
    await main.#init(params);
    return main;
  }

  #initUI() {
    sg.ui = {};

    // Initialize card container component.
    sg.ui.cardContainer = {};
    sg.ui.cardContainer.holder = $('#image-card-container');
    sg.ui.cardContainer.prevPage = $('#prev-page');
    sg.ui.cardContainer.pageNumber = $('#page-number');
    sg.ui.cardContainer.nextPage = $('#next-page');

    // Initialize expanded view component.
    sg.ui.expandedView = {};
    sg.ui.expandedView.container = $('.gallery-expanded-view');

    // Keep track of some other elements whose status or dimensions are useful.
    sg.ui.pageControl = $('.page-control');
    sg.pageLoading = $('#page-loading');
    sg.labelsNotFound = $('#labels-not-found-text');
  }

  async #init(params) {
    // Seed the all-time counts so validating a card can celebrate a newly unlocked validation badge.
    BadgeAchievements.seedCounts();

    // Neighborhood names for the cards' location line, keyed by the region id each label carries.
    sg.regionNames = params.regionNames ?? {};

    // Initialize functional components of UI elements.
    sg.cardFilter = new GalleryFilter(
      document.getElementById('card-filter'), document.getElementById('clear-filters'), params.initialFilters,
    );
    sg.cardContainer = await CardContainer.create(
      sg.ui.cardContainer, params.initialFilters, params.viewerType, params.viewerAccessToken, params.currUsername,
    );
    sg.expandedView = () => sg.cardContainer.getExpandedView();

    // Initialize KeyboardManager to activate keyboard shortcuts.
    sg.keyboard = new KeyboardManager(sg.expandedView());

    // Initialize data collection.
    sg.form = new Form(params.dataStoreUrl);
    sg.tracker = new Tracker();

    // Narrow-layout filter disclosure (button in gallery.scala.html; filter.css shows it under the breakpoint).
    const filterToggle = document.getElementById('gallery-filter-toggle');
    filterToggle?.addEventListener('click', () => {
      const open = filterToggle.closest('.sidebar').classList.toggle('mobile-visible');
      filterToggle.setAttribute('aria-expanded', String(open));
      sg.tracker.push(open ? 'FilterDisclosureOpen' : 'FilterDisclosureClose');
    });
  }
}
