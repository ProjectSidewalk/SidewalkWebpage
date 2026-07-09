/** @namespace */
window.sg = window.sg || {};

/**
 * Main module for Gallery.
 *
 * Construct instances via the `static async create()` factory, which initializes the gallery before resolving.
 */
class Main {
  #headerSidebarOffset = undefined;

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
    sg.scrollStatus = {
      stickySidebar: true,
      stickyExpandedView: true,
    };

    sg.ui = {};

    // Initializes filter components in sidebar.
    sg.ui.cardFilter = {};
    sg.ui.cardFilter.wrapper = $('.sidebar');
    sg.ui.cardFilter.holder = $('#card-filter');
    sg.ui.cardFilter.severity = $('#severity-select');
    sg.ui.cardFilter.tags = $('#tags');
    sg.ui.cardFilter.validationOptions = $('#validation-options');
    sg.ui.cardFilter.clearFilters = $('#clear-filters');

    // Initializes city select component in sidebar.
    sg.ui.cityMenu = {};
    sg.ui.cityMenu.holder = $('#city-filter-holder');
    sg.ui.cityMenu.select = $('#city-select');

    // Initializes label select component in sidebar.
    sg.ui.labelTypeMenu = {};
    sg.ui.labelTypeMenu.holder = $('#label-type-filter-holder');
    sg.ui.labelTypeMenu.select = $('#label-select');

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
    sg.ui.navbar = $('#header');
    sg.pageLoading = $('#page-loading');
    sg.labelsNotFound = $('#labels-not-found');

    sg.ui.expandedView.container.css('position', 'absolute');
    sg.ui.expandedView.container.css('visibility', 'hidden');

    // Calculate offset between bottom of navbar and sidebar.
    this.#headerSidebarOffset
            = sg.ui.cardFilter.wrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight());
  }

  async #init(params) {
    // Seed the all-time counts so validating a card can celebrate a newly unlocked validation badge.
    BadgeAchievements.seedCounts();

    // Initialize functional components of UI elements.
    sg.cityMenu = new CityMenu(sg.ui.cityMenu);
    sg.labelTypeMenu = new LabelTypeMenu(sg.ui.labelTypeMenu, params.initialFilters.labelType);

    sg.cardFilter = new CardFilter(sg.ui.cardFilter, sg.labelTypeMenu, sg.cityMenu, params.initialFilters);
    sg.cardContainer = await CardContainer.create(
      sg.ui.cardContainer, params.initialFilters, params.viewerType, params.viewerAccessToken,
    );
    sg.expandedView = () => sg.cardContainer.getExpandedView();

    // Initialize KeyboardManager to activate keyboard shortcuts.
    sg.keyboard = new KeyboardManager(sg.expandedView());

    // Initialize data collection.
    sg.form = new Form(params.dataStoreUrl);
    sg.tracker = new Tracker();

    const sidebarWrapper = sg.ui.cardFilter.wrapper;
    const sidebarWidth = sidebarWrapper.css('width');

    sg.ui.labelTypeMenu.select.change();

    // Handle sidebar and expanded view stickiness while scrolling.
    $(window).scroll(() => {
      // Make sure the page isn't loading.
      if (!sg.pageLoading.is(':visible') && !sg.labelsNotFound.is(':visible')) {
        const sidebarBottomOffset = sidebarWrapper.offset().top + sidebarWrapper.outerHeight(true);
        const cardContainerBottomOffset = sg.ui.cardContainer.holder.offset().top
          + sg.ui.cardContainer.holder.outerHeight(true) - 5;
        const visibleWindowBottomOffset = $(window).scrollTop() + $(window).height();

        // Handle sidebar stickiness.
        if (sg.scrollStatus.stickySidebar) {
          if (cardContainerBottomOffset < sidebarBottomOffset) {
            const sidebarHeightBeforeRelative = sidebarWrapper.outerHeight(true);

            // Adjust sidebar positioning.
            sidebarWrapper.css('position', 'relative');

            // Compute the new location for the top of the sidebar, just above the paging arrows.
            const navbarHeight = sg.ui.navbar.outerHeight(false);
            const newTop = cardContainerBottomOffset - sidebarHeightBeforeRelative - navbarHeight;
            sidebarWrapper.css('top', newTop);

            // Adjust card container margin.
            sg.ui.cardContainer.holder.css('margin-left', '0px');
            sg.scrollStatus.stickySidebar = false;
          }
        } else {
          const currHeaderSidebarOffset
                        = sidebarWrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight(false));
          if (currHeaderSidebarOffset > this.#headerSidebarOffset) {
            // Adjust sidebar positioning.
            sidebarWrapper.css('position', 'fixed');
            sidebarWrapper.css('top', '');

            // Adjust card container margin.
            sg.ui.cardContainer.holder.css('margin-left', sidebarWidth);
            sg.scrollStatus.stickySidebar = true;
          }
        }

        // Handle expanded view stickiness.
        if (cardContainerBottomOffset < visibleWindowBottomOffset) {
          if (sg.scrollStatus.stickyExpandedView) {
            // Prevent expanded view from going too low (i.e., when a user scrolls down fast).
            sg.ui.expandedView.container.css('top', cardContainerBottomOffset - $(window).height());
            sg.scrollStatus.stickyExpandedView = false;
          }
        } else {
          if (!sg.scrollStatus.stickyExpandedView) sg.scrollStatus.stickyExpandedView = true;

          // Emulate the expanded view being "fixed".
          sg.ui.expandedView.container.css('top', `calc(${$(window).scrollTop()}px + 1vh`);
        }
      }
    });
  }
}
