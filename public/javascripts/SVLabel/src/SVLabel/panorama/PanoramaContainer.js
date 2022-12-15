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
     * Request the panorama meta data.
     */
    function fetchPanoramaMetaData(panoramaId, callback) {
        if (!(panoramaId in container)) {
            if (panoramaId === "tutorial" || panoramaId === "tutorialAfterWalk") {
                add(panoramaId, new Panorama({ submitted: true }));
            } else {
                streetViewService.getPanorama({ pano: panoramaId }, function (data, status) {
                    if (status === google.maps.StreetViewStatus.OK) {
                        add(data.location.pano, new Panorama(data));
                        if (callback) callback();
                    } else {
                        console.error("Error retrieving Panorama: " + status);
                        svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoramaId});
                    }
                });
            }
        } else {
            if (callback) callback();
        }
    }

    self.getPanorama = getPanorama;
    self.getPanoramas = getPanoramas;
    self.getStagedPanoramas = getStagedPanoramas;
    self.fetchPanoramaMetaData = fetchPanoramaMetaData;
    return self;
}

