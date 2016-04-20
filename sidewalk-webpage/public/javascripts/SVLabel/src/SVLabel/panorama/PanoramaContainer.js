function PanoramaContainer (google) {
    var self = { className: "PanoramaContainer" },
        container = {};

    /**
     * This method adds panorama data into the container
     * @param panoramaId
     * @param panorama
     */
    function add(panoramaId, panorama) {
        if (!(panoramaId in container)) {
            container[panoramaId] = panorama;
        }
    }

    /**
     * This method returns the existing panorama data
     * @param panoramaId
     * @returns {null}
     */
    function getPanorama (panoramaId) {
        return panoramaId in container ? container[panoramaId] : null;
    }

    /**
     * Get all the panorama instances stored in the container
     * @returns {Array}
     */
    function getPanoramas () {
        return Object.keys(container).map(function (panoramaId) { return container[panoramaId]; });
    }

    /**
     * Get panorama instances that have not been submitted to the server
     * @returns {Array}
     */
    function getStagedPanoramas () {
        var panoramas = getPanoramas();
        panoramas = panoramas.filter(function (pano) { return !pano.getProperty("submitted"); });
        return panoramas;
    }

    /**
     * Street View Service https://developers.google.com/maps/documentation/javascript/streetview#StreetViewServiceResponses
     */
    function processSVData (data, status) {
        if (status === google.maps.StreetViewStatus.OK) {
            if ("location" in data && "pano" in data.location) {
                add(data.location.pano, new Panorama(data))
            }
        }
    }

    /**
     * Request the panorama meta data.
     */
    function requestPanoramaMetaData (panoramaId) {
        if ("streetViewService") {
            svl.streetViewService.getPanorama({ pano: panoramaId }, processSVData);
        } else {
            console.error("Street View Service not loaded")
        }
    }

    self.getPanorama = getPanorama;
    self.getPanoramas = getPanoramas;
    self.getStagedPanoramas = getStagedPanoramas;
    self.requestPanoramaMetaData = requestPanoramaMetaData;
    return self;
}

