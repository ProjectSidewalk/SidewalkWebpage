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
        console.log("[Form.js] compileSubmissionData");
        console.log(data);
        return data;
    }

    function _isValidationButtonClick(action) {
        return action.indexOf("ValidationButtonClick") >= 0;
    }

    /**
     * Submits all front-end data to the backend.
     * @param data  Data object (containing Interactions, Missions, etc...)
     * @param async
     * @returns {*}
     */
    function submit(data, async) {
        console.log("[Form.js] Submit function called");
        if (typeof async === "undefined") {
            async = true;
        }

        if (data.constructor !== Array) {
            console.log("Converting data...");
            data = [data];
        }
        console.log("[Form.js] Submitting data");
        console.log(data);

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) {
                    console.log('Success');
                    // If a mission was returned after posting data, create a new mission.
                    if (result.mission) {
                        svv.missionContainer.trigger("MissionContainer:createAMission", result.mission);
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
        self.submit(data, true);
        console.log("Unloading - finished submitting data");
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}