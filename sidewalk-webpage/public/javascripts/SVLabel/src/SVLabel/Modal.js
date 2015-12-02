var svl = svl || {};

/**
 * A Modal module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Modal ($) {
    var self = { className : 'Modal' };

    function _init () {
    }

    /**
     * Hide the background of the modal menu
     */
    function hidePageOverlay () {
        svl.ui.modal.overlay.css('visibility', 'hidden');
    }

    /**
     * Show the background of the modal menu
     */
    function showPageOverlay () {
        svl.ui.modal.overlay.css('visibility', 'visible');
    }


    _init();

    self.hidePageOverlay = hidePageOverlay;
    self.showPageOverlay = showPageOverlay;
    return self;
}

// test