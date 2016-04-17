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
    function requestPanoramaMetaData () {
        svl.streetViewService.getPanorama({pano: "arQPa5r-8vmDl3LSobOXBg"}, processSVData);
    }

    self.getPanorama = getPanorama;
    self.requestPanoramaMetaData = requestPanoramaMetaData;
    return self;
}

