/**
 * PointCloud module
 * @param params
 * @constructor
 * @memberof svl
 */
function PointCloud (params) {
    var self = {};
    var _callbacks = {};
    var _pointClouds = {};

    function _init(params) {
        params = params || {};

        // Get initial point clouds
        if ('panoIds' in params && params.panoIds) {
            for (var i = 0; i < params.panoIds.length; i++) {
                createPointCloud(params.panoIds[i]);
            }
        }
    }

    /**
     * This method downloads 3D depth data from Google Street View and creates point cloud data.
     * @param panoId
     */
    function createPointCloud(panoId) {
        if (!(panoId in _pointClouds)) {
            // Download the depth data only if it hasn't been downloaded. First put null in _pointClouds[panoId] so
            // that even while processing the data we don't accidentally download the data again.
            var _pointCloudLoader = new GSVPANO.PanoPointCloudLoader();
            _pointClouds[panoId] = null;
            _pointCloudLoader.onPointCloudLoad = function () {
                _pointClouds[panoId] = this.pointCloud;

                if (panoId in _callbacks) {
                    for (var i = 0; i < _callbacks[panoId].length; i++) {
                        _callbacks[panoId][i]();
                    }
                    _callbacks[panoId] = null;
                }
            };
            _pointCloudLoader.load(panoId);
        }
    }

    /**
     * This method returns point cloud data if it exists. Otherwise it calls createPointCloud to load the data.
     *
     * @param panoId
     * @returns {*}
     */
    function getPointCloud(panoId) {
        if (!(panoId in _pointClouds)) {
            createPointCloud(panoId);
            return null;
        } else {
            return (panoId in _pointClouds) ? _pointClouds[panoId] : null;
        }
    }

    /**
     * Push a callback function into _callbacks
     * @param panoId
     * @param func
     */
    function ready(panoId, func) {
        if (!(panoId in _callbacks)) { _callbacks[panoId] = []; }
        _callbacks[panoId].push(func);
    }

    self.createPointCloud = createPointCloud;
    self.getPointCloud = getPointCloud;
    self.ready = ready;

    _init(params);
    return self;
}