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

    let status = {
        sticky: true
    };

    function _initUI() {
        sg.ui = {};

        // Initializes filter components in side bar.
        sg.ui.cardFilter = {};
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

        // Keep track of the next/prev arrow container.
        sg.ui.pageControl = $(".page-control");

        $('.gallery-modal').hide();
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

        $(window).scroll(function () {
            if (!$("#page-loading").is(":visible")) {
                // Make sure the page isn't loading.
                //let pageControlTopOffset = sg.ui.pageControl.offset().top;
                let cardContainerBottomOffset = sg.ui.cardContainer.holder.offset().top + sg.ui.cardContainer.holder.outerHeight(true) - 10;
                let visibleWindowBottomOffset = $(window).scrollTop() + $(window).height(); 
                if (cardContainerBottomOffset < visibleWindowBottomOffset) {
                    if (status.sticky) {
                        console.log("footer scrolled to visible");
                        // Adjust sidebar positioning.
                        $('.sidebar').css('position', 'relative');
                        $('.sidebar').css('top', $(window).scrollTop());

                        $('.gallery-modal').css('top', cardContainerBottomOffset - $(window).height());

                        // Adjust card container margin.
                        $('.cards').css('margin-left', '0px');
                        status.sticky = false;
                    }
                } else {
                    if (!status.sticky) {
                        console.log("footer scrolled to not visible");
                        // Adjust sidebar positioning.
                        $('.sidebar').css('position', 'fixed');
                        $('.sidebar').css('top', '');

                        // Adjust card container margin.
                        $('.cards').css('margin-left', '235px');
                        status.sticky = true;
                    }
                    
                    // Emulate the modal being "fixed".
                    $('.gallery-modal').css('top', $(window).scrollTop());
                }
                // console.log("window scroll top: " + $(window).scrollTop());
                // console.log("window scroll bottom (offset from top): " + visibleWindowBottom);
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
