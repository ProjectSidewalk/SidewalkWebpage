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
            return _pointClouds[panoId];
        }
    }

    /**
     * Push a callback function into _callbacks
     * @param func
     */
    function ready(panoId, func) {
        if (!(panoId in _callbacks)) { _callbacks[panoId] = []; }
        _callbacks[panoId].push(func);
    }

    /**
     * Given the coordinate x, y (and z), return index of the point cloud data.
     * To further calculate the x- and y-coordinates, do as follows:
     *
     * ix = idx / 3 % w
     * iy = (idx / 3 - ix) / w
     *
     * @panoId
     * @param x
     * @param y
     * @param param An object that could contain z-coordinate and a distance tolerance (r).
     * @return idx
     */
    function search(panoId, param) {
        if (panoId in _pointClouds && getPointCloud(panoId)){
            var pc = getPointCloud(panoId);

            // kd-tree. It's slooooooow. I'll try Three.js later.
            // https://github.com/ubilabs/kd-tree-javascript
            //var point = pc.tree.nearest({x: param.x, y: param.y, z: param.z}, 1, 100);
            var point = pc.tree.nearest({x: param.x, y: param.y, z: param.z}, 1, 40);
            if (point && point[0]) {
                var idx = point[0][0].id;
                return idx;
                //var ix = idx / 3 % w;
                //var iy = (idx / 3 - ix) / w;
                //return {ix: ix, iy: iy};
            }
        }
        return null;
    }

    self.createPointCloud = createPointCloud;
    self.getPointCloud = getPointCloud;
    self.ready = ready;
    self.search = search;

    _init(params);
    return self;
}