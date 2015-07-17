/**
 * Extend L.Polyline (which is basically what GeoJSON LineString turns into when imported using L.getJson()) so that it keeps node ids.
 */
L.Polyline.include({
    _nodeIds: [],
    getNodeIds: function () {
        return this._nodeIds;
    },

    setNodeIds: function (nodeIds) {
        this._nodeIds = nodeIds;
    }
});