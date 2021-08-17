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

        // Initializes filter components in side bar.
        sg.ui.cardFilter = {};
        sg.ui.cardFilter.wrapper = $(".sidebar");
        sg.ui.cardFilter.holder = $("#card-filter");
        sg.ui.cardFilter.tags = $("#tags");
        sg.ui.cardFilter.severity = $("#severity");

        // Initializes label select component in side bar.
        sg.ui.ribbonMenu = {};
        sg.ui.ribbonMenu.holder = $("#ribbon-menu-holder");
        sg.ui.ribbonMenu.select = $('#label-select');

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
        headerSidebarOffset = sg.ui.cardFilter.wrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight());
    }

    function _init() {
        sg.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

        // Initialize functional components of UI elements.
        sg.ribbonMenu = new RibbonMenu(sg.ui.ribbonMenu);
        // sg.cardSortMenu = new CardSortMenu(sg.ui.cardSortMenu);
        sg.tagContainer = new CardFilter(sg.ui.cardFilter, sg.ribbonMenu);
        sg.cardContainer = new CardContainer(sg.ui.cardContainer);

        // Initialize data collection.
        sg.form = new Form(params.dataStoreUrl, params.beaconDataStoreUrl)
        sg.tracker = new Tracker();

        sg.util = {};

        let sidebarWidth = sg.ui.cardFilter.wrapper.css('width');

        // // Set initial sidebar stickiness
        // let initSidebarBottomOffset = sg.ui.cardFilter.wrapper.offset().top +
        //                               sg.ui.cardFilter.wrapper.outerHeight(true);
        // let initCardContainerBottomOffset = sg.ui.cardContainer.holder.offset().top +
        //                                     sg.ui.cardContainer.holder.outerHeight(true) - 10;
        // status.stickySidebar = initCardContainerBottomOffset < initSidebarBottomOffset;

        $(window).scroll(function () {
            // Make sure the page isn't loading.
            if (!sg.pageLoading.is(":visible") && !sg.labelsNotFound.is(':visible')) {
                let sidebarBottomOffset = sg.ui.cardFilter.wrapper.offset().top +
                                          sg.ui.cardFilter.wrapper.outerHeight(true);
                let cardContainerBottomOffset = sg.ui.cardContainer.holder.offset().top +
                                                sg.ui.cardContainer.holder.outerHeight(true) - 5;
                let pageControlTopOffset = sg.ui.pageControl.offset().top;
                let visibleWindowBottomOffset = $(window).scrollTop() + $(window).height();

                // Handle sidebar stickiness.
                if (sg.scrollStatus.stickySidebar) {
                    console.log("we sticky");
                    if (cardContainerBottomOffset < sidebarBottomOffset) {
                        console.log("MAKE NOT STICKY");
                        sidebarHeightBeforeRelative = sg.ui.cardFilter.wrapper.outerHeight(true);

                        // Adjust sidebar positioning.
                        sg.ui.cardFilter.wrapper.css('position', 'relative');

                        // Compute the new location for the top of the sidebar, just above the paging arrows.
                        let navbarHeight = sg.ui.navbar.outerHeight(false);
                        let newTop = cardContainerBottomOffset - sidebarHeightBeforeRelative - navbarHeight;
                        console.log(newTop);
                        sg.ui.cardFilter.wrapper.css('top', newTop);

                        // Adjust card container margin.
                        sg.ui.cardContainer.holder.css('margin-left', '0px');
                        sg.scrollStatus.stickySidebar = false;
                    }
                } else {
                    console.log("we not sticky");
                    currHeaderSidebarOffset = sg.ui.cardFilter.wrapper.offset().top -
                                             (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight(false));
                    if (currHeaderSidebarOffset > headerSidebarOffset) {
                        console.log('MAKE STICKY');
                        // Adjust sidebar positioning.
                        sg.ui.cardFilter.wrapper.css('position', 'fixed');
                        sg.ui.cardFilter.wrapper.css('top', '');

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
