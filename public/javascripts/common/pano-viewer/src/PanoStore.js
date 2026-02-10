/**
 * A way to store and retrieve PanoData objects.
 */
class PanoStore {
    constructor() {
        this.store = {};
    }

    /**
     * This method adds panorama data into the storage.
     * @param {string} panoId
     * @param {PanoData} panoMetadata
     */
    addPanoMetadata(panoId, panoMetadata) {
        if (!(panoId in this.store)) {
            if (panoId === 'tutorial' || panoId === 'tutorialAfterWalk') {
                panoMetadata.setProperty('submitted', true);
            }
            this.store[panoId] = panoMetadata;
        }
    }

    /**
     * This method returns the existing panorama data.
     * @param {string} panoId
     */
    getPanoData(panoId) {
        return panoId in this.store ? this.store[panoId] : null;
    }

    /**
     * Get all the panorama instances stored in the storage.
     * @returns {Array<PanoData>}
     */
    getAllPanoData() {
        return Object.keys(this.store).map((panoId) => this.store[panoId]);
    }

    /**
     * Get panorama instances that have not been submitted to the server.
     * @returns {Array<PanoData>}
     */
    getStagedPanoData() {
        let panoramas = this.getAllPanoData();
        panoramas = panoramas.filter((pano) => !pano.getProperty('submitted'));
        return panoramas;
    }
}
