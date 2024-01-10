/**
 * Returns an object that holds layers for maps.
 */
function InitializeMapLayerContainer() {
    var mapData = {};
    mapData.correct = true;
    mapData.incorrect = false;
    mapData.notsure = true;
    mapData.unvalidated = true;
    mapData.lowQualityUsers = false;

    // Make arrays to hold labels split by label type and severity (null and 1 through 5). And another to hold their names.
    mapData.sortedLabels = {};
    mapData.layerNames = {};
    let labelTypes = ['CurbRamp','NoCurbRamp','Obstacle','SurfaceProblem','Occlusion','NoSidewalk','Crosswalk','Signal','Other']
    for (let i = 0; i < labelTypes.length; i++) {
        let labelType = labelTypes[i];
        mapData.sortedLabels[labelType] = [];
        mapData.layerNames[labelType] = [];
        for (let j = 0; j < 6; j++) {
            mapData.sortedLabels[labelType][j] = [];
            mapData.layerNames[labelType][j] = [];
        }
    }
    return mapData;
}
