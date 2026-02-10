/**
 * MissionFactory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 * @param missionModel
 */
function MissionFactory (missionModel) {
    const _missionModel = missionModel;

    _missionModel.on("MissionFactory:create", function (parameters) {
        // Makes any necessary changes from snake_case to camelCase since we get the values from JSON.
        if (!parameters.hasOwnProperty("missionId") && parameters.hasOwnProperty("mission_id"))
            parameters.missionId = parameters.mission_id;
        if (!parameters.hasOwnProperty("missionType") && parameters.hasOwnProperty("mission_type"))
            parameters.missionType = parameters.mission_type;
        if (!parameters.hasOwnProperty("regionId") && parameters.hasOwnProperty("region_id"))
            parameters.regionId = parameters.region_id;
        if (!parameters.hasOwnProperty("isComplete") && parameters.hasOwnProperty("completed"))
            parameters.isComplete = parameters.completed;
        if (!parameters.hasOwnProperty("isComplete") && parameters.hasOwnProperty("is_complete"))
            parameters.isComplete = parameters.is_complete;
        if (!parameters.hasOwnProperty("distance") && parameters.hasOwnProperty("distanceMeters"))
            parameters.distance = parameters.distanceMeters;
        if (!parameters.hasOwnProperty("distance") && parameters.hasOwnProperty("distance_meters"))
            parameters.distance = parameters.distance_meters;
        if (!parameters.hasOwnProperty("distanceProgress") && parameters.hasOwnProperty("distance_progress"))
            parameters.distanceProgress = parameters.distance_progress;

        const mission = new Mission({
            missionId: parameters.missionId,
            missionType: parameters.missionType,
            regionId: parameters.regionId,
            isComplete: parameters.isComplete,
            distance: parameters.distance,
            distanceProgress: parameters.distanceProgress,
            skipped: parameters.skipped
        });
        _missionModel.addAMission(mission);
    });
}
