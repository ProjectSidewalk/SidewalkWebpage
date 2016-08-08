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
    };

    this.fetchMissions = function (callback) {
        function success (result1) {
            var missionParameters, missions = result1;

            function cmp (a, b) {
                var distanceA = a.distance ? a.distance : 0;
                var distanceB = b.distance ? b.distance : 0;
                return distanceA - distanceB;
            }

            missions.sort(cmp);
            for (var i = 0, len = missions.length; i < len; i++) {
                missionParameters = {
                    regionId: missions[i].region_id,
                    missionId: missions[i].mission_id,
                    label: missions[i].label,
                    level: missions[i].level,
                    distance: missions[i].distance,
                    distanceFt: missions[i].distance_ft,
                    distanceMi: missions[i].distance_mi,
                    coverage: missions[i].coverage,
                    isCompleted: missions[i].is_completed
                };
                self.trigger("MissionFactory:create", missionParameters);
            }
        }

        if (callback) {
            $.when($.ajax("/mission")).done(success).done(callback);
        } else {
            $.when($.ajax("/mission")).done(success);
        }
    };
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
