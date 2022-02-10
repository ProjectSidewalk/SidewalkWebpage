/**
 * Returns an object that holds layers for maps.
 */
function InitializeMapLayerContainer() {
    var mapData = {};
    mapData.markerLayer = null;
    mapData.curbRampLayers = [];
    mapData.missingCurbRampLayers = [];
    mapData.obstacleLayers = [];
    mapData.surfaceProblemLayers = [];
    mapData.cantSeeSidewalkLayers = [];
    mapData.noSidewalkLayers = [];
    mapData.crosswalkLayers = [];
    mapData.signalLayers = [];
    mapData.otherLayers = [];
    // Make arrays to hold labels split by severity (null and 1 through 5).
    for (var i = 0; i < 6; i++) {
        mapData.curbRampLayers[i] = [];
        mapData.missingCurbRampLayers[i] = [];
        mapData.obstacleLayers[i] = [];
        mapData.surfaceProblemLayers[i] = [];
        mapData.cantSeeSidewalkLayers[i] = [];
        mapData.noSidewalkLayers[i] = [];
        mapData.crosswalkLayers[i] = [];
        mapData.signalLayers[i] = [];
        mapData.otherLayers[i] = [];
    }
    mapData.allLayers = {
        'CurbRamp': mapData.curbRampLayers,
        'NoCurbRamp': mapData.missingCurbRampLayers,
        'Obstacle': mapData.obstacleLayers,
        'SurfaceProblem': mapData.surfaceProblemLayers,
        'Occlusion': mapData.cantSeeSidewalkLayers,
        'NoSidewalk': mapData.noSidewalkLayers,
        'Crosswalk': mapData.crosswalkLayers,
        'Signal': mapData.signalLayers,
        'Other': mapData.otherLayers
    };
    return mapData;
}
