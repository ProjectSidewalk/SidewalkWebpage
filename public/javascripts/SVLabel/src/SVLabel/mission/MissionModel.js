/**
 * MissionModel constructor.
 * Todo. Implement this model to connect other mission components. Read the JSTR book Section 4.2.4
 * @constructor
 */
function MissionModel () {
    var self = this;

    this.submitMissions = function (missions) {
        var data = [];
        for (var i = 0, len = missions.length; i < len; i++) {
            if ('toSubmissionFormat' in missions[i]) {
                data.push(missions[i].toSubmissionFormat());
            }
        }

        var url = "/mission",
            async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {},
            error: function (result) {
                console.error(result);
            }
        });
    }
}
_.extend(MissionModel.prototype, Backbone.Events);


MissionModel.prototype.addAMission = function (mission) {
    this.trigger("MissionContaier:addAMission", mission);
};

MissionModel.prototype.completeMission = function (mission) {
    this.trigger("MissionProgress:complete", mission);
};

MissionModel.prototype.createAMission = function (parameters) {
    this.trigger("MissionFactory:create", parameters);
};

MissionModel.prototype.submitMissions = function (missions) {
    var data = [];
    for (var i = 0, len = missions.length; i < len; i++) {
        if ('toSubmissionFormat' in missions[i]) {
            data.push(missions[i].toSubmissionFormat());
        }
    }

    var url = "/mission",
        async = true;
    $.ajax({
        async: async,
        contentType: 'application/json; charset=utf-8',
        url: url,
        type: 'post',
        data: JSON.stringify(data),
        dataType: 'json',
        success: function (result) {},
        error: function (result) {
            console.error(result);
        }
    });
};

/**
 * Notify the mission modules with MissionProgress:update
 */
MissionModel.prototype.updateMissionProgress = function (mission, neighborhood) {
    this.trigger("MissionProgress:update", { mission: mission, neighborhood: neighborhood });
};

MissionModel.prototype.fetchMissions = function () {
    
};