/** @namespace */
var sg = sg || {};

/**
 * Main module for SidewalkGallery
 * @param param    Object passed from sidewalkGallery.scala.html containing initial values pulled from
 *                  the database on page load.
 * @returns {Main}
 * @constructor
 */
function Main (params) {
    let self = this;

    function _initUI() {
        sg.ui = {};
        sg.ui.cardFilter = {};
        sg.ui.cardFilter.holder = $("#card-filter");
        sg.ui.cardFilter.tags = $("#tags");
        sg.ui.cardFilter.severity = $("#severity");
        sg.ui.ribbonMenu = {};
        sg.ui.ribbonMenu.holder = $("#ribbon-menu-holder");
        sg.ui.ribbonMenu.select = $('#label-select');
        sg.ui.cardSortMenu = {};
        sg.ui.cardSortMenu.holder = $("#card-sort-menu-holder");
        sg.ui.cardSortMenu.sort = $('#card-sort-select');
        sg.ui.cardContainer = {};
        sg.ui.cardContainer.holder = $("#image-card-container");
        sg.ui.cardContainer.prevPage = $("#prev-page");
        sg.ui.cardContainer.pageNumber = $("#page-number")
        sg.ui.cardContainer.nextPage = $("#next-page");
    }

    function _init() {
        console.log("Sidewalk Gallery initialized");
        sg.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

        sg.ribbonMenu = new RibbonMenu(sg.ui.ribbonMenu);
        sg.cardSortMenu = new CardSortMenu(sg.ui.cardSortMenu);
        sg.tagContainer = new CardFilter(sg.ui.cardFilter, sg.ribbonMenu);
        sg.cardContainer = new CardContainer(sg.ui.cardContainer);

        sg.util = {};
        sg.util.properties = {};
        sg.util.properties.panorama = new GalleryPanoUtilities();
    }

    _initUI();
    _init();

    return self;
}
