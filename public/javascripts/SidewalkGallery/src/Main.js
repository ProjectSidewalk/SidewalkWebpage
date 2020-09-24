/** @namespace */
var sg = sg || {};

/**
 * Main module for SidewalkGallery
 * @param param    Object passed from sidewalkGallery.scala.html containing initial values pulled from
 *                  the database on page load.
 * @returns {Main}
 * @constructor
 */
function Main (param) {
    let self = this;

    function _initUI() {
        sg.ui = {};
        sg.ui.cardFilter = {};
        sg.ui.cardFilter.holder = $("#card-filter");
        sg.ui.cardFilter.tags = $("#tags");
        sg.ui.ribbonMenu = {};
        sg.ui.ribbonMenu.holder = $("#ribbon-menu-holder");
        sg.ui.ribbonMenu.buttons = $('button.modeSwitch');
        sg.ui.cardContainer = {};
        sg.ui.cardContainer.holder = $("#image-card-container");

    }

    function _init() {
        console.log("Sidewalk Gallery initialized");

        sg.ribbonMenu = new RibbonMenu(sg.ui.ribbonMenu);
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
