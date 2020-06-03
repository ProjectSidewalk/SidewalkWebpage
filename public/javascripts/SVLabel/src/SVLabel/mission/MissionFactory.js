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
        if (!parameters.hasOwnProperty("skipped") && parameters.hasOwnProperty("skipped"))
            parameters.skipped = parameters.skipped;

        var mission = self.create(parameters.missionId, parameters.missionType, parameters.regionId,
            parameters.isComplete, parameters.pay, parameters.paid, parameters.distance, parameters.distanceProgress,
            parameters.skipped);
        _missionModel.addAMission(mission);
    });
}

/**
 * Create an instance of a mission object
 *
 * @param missionId
 * @param missionType
 * @param regionId
 * @param isComplete
 * @param pay
 * @param paid
 * @param distance
 * @param distanceProgress
 * @param skipped
 * @returns {svl.Mission}
 */
MissionFactory.prototype.create = function (missionId, missionType, regionId, isComplete, pay, paid, distance, distanceProgress, skipped) {
    return new Mission({
        missionId: missionId,
        missionType: missionType,
        regionId: regionId,
        isComplete: isComplete,
        pay: pay,
        paid: paid,
        distance: distance,
        distanceProgress: distanceProgress,
        skipped: skipped
    });
};
