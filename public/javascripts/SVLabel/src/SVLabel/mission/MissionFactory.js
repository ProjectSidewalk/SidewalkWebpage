/**
 * MissionFactory module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionFactory (missionModel) {
    var self = this;
    var _missionModel = missionModel;

    _missionModel.on("MissionFactory:create", function (parameters) {
        var mission = self.create(parameters.regionId, parameters.routeId, parameters.missionId, parameters.label, parameters.level,
            parameters.distance, parameters.distanceFt, parameters.distanceMi, parameters.coverage, parameters.isCompleted);
        _missionModel.addAMission(mission);
    });
}

/**
 * Create an instance of a mission object
 * @param regionId
 * @param missionId
 * @param label The label of the mission
 * @param level The level of the mission
 * @param distance Mission distance in meters
 * @param distanceFt Mission distance in feet
 * @param distanceMi Mission distance in miles
 * @param coverage Mission coverage rate
 * @param isCompleted A flag indicating if this mission is completed
 * @returns {svl.Mission}
 */
MissionFactory.prototype.create = function (regionId, routeId, missionId, label, level, distance, distanceFt, distanceMi, coverage, isCompleted) {
    return new Mission({
        regionId: regionId,
        routeId: routeId,
        missionId: missionId,
        label: label,
        level: level,
        distance: distance,
        distanceFt: distanceFt,
        distanceMi: distanceMi,
        coverage: coverage,
        isCompleted: isCompleted
    });
};

/**
 * Create the onboarding mission
 * @param level The level of the mission
 * @param isCompleted {boolean} A flag indicating if this mission is completed
 * @returns {svl.Mission}
 */
MissionFactory.prototype.createOnboardingMission = function (level, isCompleted) {
    return new Mission({label: "onboarding", level: level, isCompleted: isCompleted});
};