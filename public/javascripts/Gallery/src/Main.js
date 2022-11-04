/** @namespace */
var sg = sg || {};

/**
 * Main module for Gallery.
 * @param params Object passed from gallery.scala.html containing initial values pulled from the database on page
 *              load.
 * @returns {Main}
 * @constructor
 */
function Main (params) {
    let self = this;

    sg.scrollStatus = {
        stickySidebar: true,
        stickyModal: true
    };

    let headerSidebarOffset = undefined;

    function _initUI() {
        sg.ui = {};

        // Initializes filter components in sidebar.
        sg.ui.cardFilter = {};
        sg.ui.cardFilter.wrapper = $(".sidebar");
        sg.ui.cardFilter.holder = $("#card-filter");
        sg.ui.cardFilter.tags = $("#tags");
        sg.ui.cardFilter.severity = $("#severity-select");

        // Initializes city select component in sidebar.
        sg.ui.cityMenu = {};
        sg.ui.cityMenu.holder = $("#city-filter-holder");
        sg.ui.cityMenu.select = $('#city-select');

        // Initializes label select component in sidebar.
        sg.ui.labelTypeMenu = {};
        sg.ui.labelTypeMenu.holder = $("#label-type-filter-holder");
        sg.ui.labelTypeMenu.select = $('#label-select');

        // TODO: potentially remove if we decide sorting is not desired for later versions.
        sg.ui.cardSortMenu = {};
        sg.ui.cardSortMenu.holder = $("#card-sort-menu-holder");
        sg.ui.cardSortMenu.sort = $('#card-sort-select');

        // Initialize card container component.
        sg.ui.cardContainer = {};
        sg.ui.cardContainer.holder = $("#image-card-container");
        sg.ui.cardContainer.prevPage = $("#prev-page");
        sg.ui.cardContainer.pageNumber = $("#page-number")
        sg.ui.cardContainer.nextPage = $("#next-page");

        // Keep track of some other elements whose status or dimensions are useful.
        sg.ui.pageControl = $(".page-control");
        sg.ui.navbar = $("#header");
        sg.pageLoading = $('#page-loading');
        sg.labelsNotFound = $('#labels-not-found');

        $('.gallery-modal').hide();

        // Calculate offset between bottom of navbar and sidebar.
        headerSidebarOffset =
            sg.ui.cardFilter.wrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight());
    }

    function _init() {

        sg.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

        // Initialize functional components of UI elements.
        sg.cityMenu = new CityMenu(sg.ui.cityMenu);
        sg.labelTypeMenu = new LabelTypeMenu(sg.ui.labelTypeMenu);

        // sg.cardSortMenu = new CardSortMenu(sg.ui.cardSortMenu);
        sg.tagContainer = new CardFilter(sg.ui.cardFilter, sg.labelTypeMenu, sg.cityMenu);
        sg.cardContainer = new CardContainer(sg.ui.cardContainer);
        sg.modal = sg.cardContainer.getModal;
        // Initialize data collection.
        sg.form = new Form(params.dataStoreUrl, params.beaconDataStoreUrl);
        sg.tracker = new Tracker();

        let sidebarWrapper = sg.ui.cardFilter.wrapper;
        let sidebarWidth = sidebarWrapper.css('width');

        sg.ui.labelTypeMenu.select.change();

        // Handle sidebar and expanded view stickiness while scrolling.
        $(window).scroll(function () {
            // Make sure the page isn't loading.
            if (!sg.pageLoading.is(":visible") && !sg.labelsNotFound.is(':visible')) {
                let sidebarBottomOffset = sidebarWrapper.offset().top + sidebarWrapper.outerHeight(true);
                let cardContainerBottomOffset = sg.ui.cardContainer.holder.offset().top +
                                                sg.ui.cardContainer.holder.outerHeight(true) - 5;
                let visibleWindowBottomOffset = $(window).scrollTop() + $(window).height();

                // Handle sidebar stickiness.
                if (sg.scrollStatus.stickySidebar) {
                    if (cardContainerBottomOffset < sidebarBottomOffset) {
                        let sidebarHeightBeforeRelative = sidebarWrapper.outerHeight(true);

                        // Adjust sidebar positioning.
                        sidebarWrapper.css('position', 'relative');

                        // Compute the new location for the top of the sidebar, just above the paging arrows.
                        let navbarHeight = sg.ui.navbar.outerHeight(false);
                        let newTop = cardContainerBottomOffset - sidebarHeightBeforeRelative - navbarHeight;
                        sidebarWrapper.css('top', newTop);

                        // Adjust card container margin.
                        sg.ui.cardContainer.holder.css('margin-left', '0px');
                        sg.scrollStatus.stickySidebar = false;
                    }
                } else {
                    let currHeaderSidebarOffset =
                        sidebarWrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight(false));
                    if (currHeaderSidebarOffset > headerSidebarOffset) {
                        // Adjust sidebar positioning.
                        sidebarWrapper.css('position', 'fixed');
                        sidebarWrapper.css('top', '');

                        // Adjust card container margin.
                        sg.ui.cardContainer.holder.css('margin-left', sidebarWidth);
                        sg.scrollStatus.stickySidebar = true;
                    }
                }

                // Handle modal stickiness.
                if (cardContainerBottomOffset < visibleWindowBottomOffset) {
                    if (sg.scrollStatus.stickyModal) {
                        // Prevent modal from going too low (i.e., when a user scrolls down fast).
                        $('.gallery-modal').css('top', cardContainerBottomOffset - $(window).height());
                        sg.scrollStatus.stickyModal = false;
                    }
                } else {
                    if (!sg.scrollStatus.stickyModal) sg.scrollStatus.stickyModal = true;

                    // Emulate the modal being "fixed".
                    $('.gallery-modal').css('top', $(window).scrollTop());
                }
            }
        });
    }

    // Gets all the text on the gallery page for the correct language.
    i18next.use(i18nextXHRBackend);
    i18next.init({
        backend: { loadPath: '/assets/locales/{{lng}}/{{ns}}.json' },
        fallbackLng: 'en',
        ns: ['common', 'gallery'],
        defaultNS: 'common',
        lng: params.language,
        debug: false
    }, function(err, t) {
        if (err) return console.log('something went wrong loading', err);

        _initUI();
        _init();
    });
    return self;
}
