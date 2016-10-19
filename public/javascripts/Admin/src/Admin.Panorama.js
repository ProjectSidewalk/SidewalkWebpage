/**
 *
 *
 * @param panoCanvas: One single DOM element
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanorama(panoCanvas) {
    var self = { className: "Panorama" };

    /**
     * This function initializes the Panorama
     */
    function _init () {
        self.panoCanvas = panoCanvas;
        self.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(self.panoCanvas, {}) : null;
        self.panoId = null;

        if (self.panorama) {
            self.panorama.set('addressControl', false);
            self.panorama.set('clickToGo', false);
            self.panorama.set('disableDefaultUI', true);
            self.panorama.set('linksControl', false);
            self.panorama.set('navigationControl', false);
            self.panorama.set('panControl', false);
            self.panorama.set('zoomControl', false);
            self.panorama.set('keyboardShortcuts', false);
        }
    }

    /**
     * @param newId
     */
    function changePanoId(newId) {
        if(self.panoId != newId) {
            self.panorama.setPano(newId);
            self.panoId = newId;
        }
    }

    /**
     * @param options: The options object should have "heading", "pitch" and "zoom" keys
     */
    function setPov(options) {
        self.panorama.setPov(options);
    }


    //init
    _init();

    self.changePanoId = changePanoId;
    self.setPov = setPov;
    return self;
}