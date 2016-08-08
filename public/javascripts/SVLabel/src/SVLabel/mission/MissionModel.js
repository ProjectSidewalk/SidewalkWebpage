/**
 * MissionModel constructor.
 * Todo. Implement this model to connect other mission components. Read the JSTR book Section 4.2.4
 * @constructor
 */
function MissionModel () {
    var self = this;

}
_.extend(MissionModel.prototype, Backbone.Events);



MissionModel.prototype.fetchMissions = function () {
    // Todo. Fetch data and trigger MissionFactory:create events.
};

MissionModel.prototype.completeMission = function (mission) {
    this.trigger("MissionProgress:complete", mission);
};

/**
 * Notify the mission modules with MissionProgress:update
 */
MissionModel.prototype.updateMissionProgress = function () {
    this.trigger("MissionProgress:update");
};