/**
 * MissionFactory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 * @param missionModel
 */
function MissionFactory (missionModel) {
    var self = this;
    var _missionModel = missionModel;

    _missionModel.on("MissionFactory:create", function (parameters) {
        // Makes any necessary changes from snake_case to camelCase since we get the values from JSON.
        if (!parameters.hasOwnProperty("missionId") && parameters.hasOwnProperty("mission_id"))
            parameters.missionId = parameters.mission_id;
        if (!parameters.hasOwnProperty("missionType") && parameters.hasOwnProperty("mission_type"))
            parameters.missionType = parameters.mission_type;
        if (!parameters.hasOwnProperty("regionId") && parameters.hasOwnProperty("region_id"))
            parameters.regionId = parameters.region_id;
        if (!parameters.hasOwnProperty("isCompleted") && parameters.hasOwnProperty("completed"))
            parameters.isCompleted = parameters.completed;
        if (!parameters.hasOwnProperty("isCompleted") && parameters.hasOwnProperty("is_completed"))
            parameters.isCompleted = parameters.is_completed;
        if (!parameters.hasOwnProperty("distance") && parameters.hasOwnProperty("distanceMeters"))
            parameters.distance = parameters.distanceMeters;
        if (!parameters.hasOwnProperty("distance") && parameters.hasOwnProperty("distance_meters"))
            parameters.distance = parameters.distance_meters;
        if (!parameters.hasOwnProperty("distanceProgress") && parameters.hasOwnProperty("distance_progress"))
            parameters.distanceProgress = parameters.distance_progress;

        // TODO these next couple checks should be removed once we get rid of the need for them!!
        if (!parameters.hasOwnProperty("distanceFt") && parameters.hasOwnProperty("distance"))
            parameters.distanceFt = parameters.distance * 3.28084;
        if (!parameters.hasOwnProperty("distanceMi") && parameters.hasOwnProperty("distance"))
            parameters.distanceMi = parameters.distance / 1609.34;

        var mission = self.create(parameters.missionId, parameters.missionType, parameters.regionId,
            parameters.isCompleted, parameters.pay, parameters.distance, parameters.distanceProgress,
            parameters.distanceFt, parameters.distanceMi);
        _missionModel.addAMission(mission);
    });
}

/**
 * Create an instance of a mission object
 *
 * @param missionId
 * @param missionType
 * @param regionId
 * @param isCompleted
 * @param pay
 * @param distance
 * @param distanceProgress
 * @param distanceFt
 * @param distanceMi
 * @returns {svl.Mission}
 */
MissionFactory.prototype.create = function (missionId, missionType, regionId, isCompleted, pay, distance, distanceProgress, distanceFt, distanceMi) {
    return new Mission({
        missionId: missionId,
        missionType: missionType,
        regionId: regionId,
        isCompleted: isCompleted,
        pay: pay,
        distance: distance,
        distanceProgress: distanceProgress,
        distanceFt: distanceFt,
        distanceMi: distanceMi
    });
};
