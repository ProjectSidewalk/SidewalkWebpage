/**
 * Returns an object that holds layers for maps.
 */
function InitializeMapLayerContainer() {
    var mapData = {};
    mapData.correct = true;
    mapData.incorrect = false;
    mapData.unvalidated = true;
    mapData.lowQualityUsers = false;

    // Make arrays to hold labels split by label type and severity (null and 1 through 5).
    mapData.labelLayers = {};
    let labelTypes = ['CurbRamp','NoCurbRamp','Obstacle','SurfaceProblem','Occlusion','NoSidewalk','Crosswalk','Signal','Other']
    for (let i = 0; i < labelTypes.length; i++) {
        let labelType = labelTypes[i];
        mapData.labelLayers[labelType] = [];
        for (let j = 0; j < 6; j++) {
            mapData.labelLayers[labelType][j] = [];
        }
    }
    return mapData;
}
