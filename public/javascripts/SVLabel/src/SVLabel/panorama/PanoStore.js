function PanoStore () {
    let self = this;
    self.store = {};

    /**
     * This method adds panorama data into the storage.
     * @param panoramaId
     * @param panoramaMetadata
     */
    function addPanoMetadata(panoramaId, panoramaMetadata) {
        if (!(panoramaId in self.store)) {
            if (panoramaId === 'tutorial' || panoramaId === 'tutorialAfterWalk') {
                panoramaMetadata.setProperty('submitted', true);
            }
            self.store[panoramaId] = panoramaMetadata;
        }
    }

    /**
     * This method returns the existing panorama data.
     * @param panoramaId
     */
    function getPanoData(panoramaId) {
        return panoramaId in self.store ? self.store[panoramaId] : null;
    }

    /**
     * Get all the panorama instances stored in the storage.
     * @returns {Array}
     */
    function getAllPanoData() {
        return Object.keys(self.store).map(function (panoramaId) { return self.store[panoramaId]; });
    }

    /**
     * Get panorama instances that have not been submitted to the server.
     * @returns {Array}
     */
    function getStagedPanoData() {
        let panoramas = getAllPanoData();
        panoramas = panoramas.filter(function (pano) { return !pano.getProperty('submitted'); });
        return panoramas;
    }

    self.addPanoMetadata = addPanoMetadata;
    self.getPanoData = getPanoData;
    self.getAllPanoData = getAllPanoData;
    self.getStagedPanoData = getStagedPanoData;

    return this;
}
