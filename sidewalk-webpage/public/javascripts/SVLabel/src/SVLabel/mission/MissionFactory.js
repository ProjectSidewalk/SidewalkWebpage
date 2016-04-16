/**
 * MissionFactory module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionFactory () {
    var self = { className: "MissionFactory" };

    /**
     * Create an instance of a mission object
     * @param regionId
     * @param missionId
     * @param label The label of the mission
     * @param level The level of the mission
     * @param distance
     * @param coverage
     * @param isCompleted A flag indicating if this mission is completed
     * @returns {svl.Mission}
     */
    function create (regionId, missionId, label, level, distance, coverage, isCompleted) {
        return new Mission({ regionId: regionId, missionId: missionId, label: label, level: level, distance: distance,
            coverage: coverage, isCompleted: isCompleted });
    }

    /**
     * Create the onboarding mission
     * @param level The level of the mission
     * @param isCompleted {boolean} A flag indicating if this mission is completed
     * @returns {svl.Mission}
     */
    function createOnboardingMission(level, isCompleted) {
        return new Mission({label: "onboarding", level: level, isCompleted: isCompleted});
    }

    self.create = create;
    self.createOnboardingMission = createOnboardingMission;
    return self;
}