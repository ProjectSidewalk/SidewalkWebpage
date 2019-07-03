function PanoramaContainer (streetViewService) {
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
        else {
            console.error("Error retrieving Panoramas: " + status);
        }
    }

    /**
     * Request the panorama meta data.
     */
    function fetchPanoramaMetaData(panoramaId) {
        // streetViewService.getPanorama({ pano: panoramaId }, processSVData);
        streetViewService.getPanorama({pano: panoramaId},
            function (data, status) {
                if (status === google.maps.StreetViewStatus.OK) {
                    if ("location" in data && "pano" in data.location) {
                        add(data.location.pano, new Panorama(data))
                    }
                } else if (panoramaId === "tutorial" || panoramaId === "tutorialAfterWalk") {
                    // Shows tutorial panoramas as already submitted to server, no need to add to server
                    add(panoramaId, new Panorama({submitted: true}));
                } else {
                    console.error("Error retrieving Panoramas: " + status);
                    svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoramaId});
                }
            });
    }

    self.getPanorama = getPanorama;
    self.getPanoramas = getPanoramas;
    self.getStagedPanoramas = getStagedPanoramas;
    self.fetchPanoramaMetaData = fetchPanoramaMetaData;
    return self;
}

