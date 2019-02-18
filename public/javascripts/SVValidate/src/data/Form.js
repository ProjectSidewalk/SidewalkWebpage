function Form(url) {
    var properties = {
        dataStoreUrl : url
    };

    function compileSubmissionData() {
        var data = {};
        var mission = svv.missionContainer.getCurrentMission();

        data.interactions = svv.tracker.getActions();
        data.labels = svv.labelContainer.getCurrentLabels();

        // Add the current mission
        data.missionProgress = {
            mission_id: mission.getProperty("missionId"),
            labels_progress: mission.getProperty("labelsProgress"),
            completed: mission.getProperty("completed"),
            skipped: mission.getProperty("skipped")
        };

        svv.tracker.refresh();
        svv.labelContainer.refresh();
        return data;
    }

    /**
     * Submits all front-end data to the backend.
     * @param data  Data object (containing Interactions, Missions, etc...)
     * @param async
     * @returns {*}
     */
    function submit(data, async) {
        if (typeof async === "undefined") {
            async = false;
        }

        if (data.constructor !== Array) {
            data = [data];
        }

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) {
                    // If a mission was returned after posting data, create a new mission.
                    if (result.mission) {
                        svv.missionContainer.createAMission(result.mission);
                        svv.panoramaContainer.reset();
                        svv.panoramaContainer.setLabelList(result.labels);
                        svv.panoramaContainer.loadNewLabelOntoPanorama();
                    }
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
        return data;
    }

    $(window).on('beforeunload', function () {
        svv.tracker.push("Unload");
        var data = compileSubmissionData();
        self.submit(data, false);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}
