/**
 * MissionModel constructor.
  * @constructor
 */
function MissionModel () {
    var self = this;

    this.fetchCompletedMissionsInNeighborhood = function (callback) {
        function _onFetch (missions) {
            for (var i = 0, len = missions.length; i < len; i++) {
                self.createAMission(missions[0]);
            }
        }

        if (callback) {
            $.when($.ajax("/neighborhoodMissions")).done(_onFetch).done(callback);
        } else {
            $.when($.ajax("/neighborhoodMissions")).done(_onFetch);
        }
    };


}
_.extend(MissionModel.prototype, Backbone.Events);

MissionModel.prototype.addAMission = function (mission) {
    this.trigger("MissionContainer:addAMission", mission);
};

MissionModel.prototype.completeMission = function (mission) {
    this.trigger("MissionProgress:complete", { mission: mission });
};

MissionModel.prototype.createAMission = function (parameters) {
    this.trigger("MissionFactory:create", parameters);
};

/**
 * Notify the mission modules with MissionProgress:update
 */
MissionModel.prototype.updateMissionProgress = function (mission, neighborhood) {
    this.trigger("MissionProgress:update", { mission: mission, neighborhood: neighborhood });
};
