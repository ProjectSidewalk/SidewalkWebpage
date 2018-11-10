/**
 * MissionModel constructor.
  * @constructor
 */
function MissionModel () {
    var self = this;

    this.fetchCompletedMissionsInNeighborhood = function (callback) {
        function _onFetch (missions) {
            console.log("_onFetch, missions.length = " + missions.length);
            for (var i = 0, len = missions.length; i < len; i++) {
                self.createAMission(missions[0]);
            }
        }

        if (callback) {
            console.log("callBack triggered");
            $.when($.ajax("/neighborhoodMissions")).done(_onFetch).done(callback);
        } else {
            console.log("callBack not triggered");
            $.when($.ajax("/neighborhoodMissions")).done(_onFetch);
        }
    };


}
_.extend(MissionModel.prototype, Backbone.Events);
console.log(Backbone.Events);

MissionModel.prototype.addAMission = function (mission) {
    console.log("addAMission");
    this.trigger("MissionContainer:addAMission", mission);
};

MissionModel.prototype.completeMission = function (mission) {
    console.log("completeMission");
    this.trigger("MissionProgress:complete", { mission: mission });
};

MissionModel.prototype.createAMission = function (parameters) {
    console.log("createAMission");
    console.log("createAMission parameters");
    console.log(parameters);
    this.trigger("MissionFactory:create", parameters);
};

/**
 * Notify the mission modules with MissionProgress:update
 */
MissionModel.prototype.updateMissionProgress = function (mission, neighborhood) {
    console.log("updateMissionProgress");
    this.trigger("MissionProgress:update", { mission: mission, neighborhood: neighborhood });
};
