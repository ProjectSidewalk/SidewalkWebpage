function PanoStore () {
    let self = this;
    self.store = {};

    /**
     * This method adds panorama data into the storage.
     * @param panoId
     * @param panoMetadata
     */
    function addPanoMetadata(panoId, panoMetadata) {
        if (!(panoId in self.store)) {
            if (panoId === 'tutorial' || panoId === 'tutorialAfterWalk') {
                panoMetadata.setProperty('submitted', true);
            }
            self.store[panoId] = panoMetadata;
        }
    }

    /**
     * This method returns the existing panorama data.
     * @param panoId
     */
    function getPanoData(panoId) {
        return panoId in self.store ? self.store[panoId] : null;
    }

    /**
     * Get all the panorama instances stored in the storage.
     * @returns {Array}
     */
    function getAllPanoData() {
        return Object.keys(self.store).map(function (panoId) { return self.store[panoId]; });
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
