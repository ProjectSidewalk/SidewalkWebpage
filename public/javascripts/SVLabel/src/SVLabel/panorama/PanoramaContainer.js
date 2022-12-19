function PanoramaContainer () {
    var self = { className: "PanoramaContainer" },
        container = {};

    /**
     * This method adds panorama data into the container
     * @param panoramaId
     * @param panoramaMetadata
     */
    function addPanoMetadata(panoramaId, panoramaMetadata) {
        if (!(panoramaId in container)) {
            if (panoramaId === "tutorial" || panoramaId === "tutorialAfterWalk") {
                container[panoramaId] = new Panorama({ submitted: true, tiles: { worldSize: { width: 13312, height: 6656 } } });
            } else {
                container[panoramaId] = new Panorama(panoramaMetadata);
            }
        }
    }

    /**
     * This method returns the existing panorama data
     * @param panoramaId
     * @returns {null}
     */
    function getPanorama(panoramaId) {
        return panoramaId in container ? container[panoramaId] : null;
    }

    /**
     * Get all the panorama instances stored in the container
     * @returns {Array}
     */
    function getPanoramas() {
        return Object.keys(container).map(function (panoramaId) { return container[panoramaId]; });
    }

    /**
     * Get panorama instances that have not been submitted to the server
     * @returns {Array}
     */
    function getStagedPanoramas() {
        var panoramas = getPanoramas();
        panoramas = panoramas.filter(function (pano) { return !pano.getProperty("submitted"); });
        return panoramas;
    }

    self.addPanoMetadata = addPanoMetadata;
    self.getPanorama = getPanorama;
    self.getPanoramas = getPanoramas;
    self.getStagedPanoramas = getStagedPanoramas;
    return self;
}

