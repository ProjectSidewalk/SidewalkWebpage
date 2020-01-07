function Form(url, beaconUrl) {
    let properties = {
        dataStoreUrl : url,
        beaconDataStoreUrl : beaconUrl
    };

    /**
     * Compiles data into a format that can be parsed by our backend.
     * @returns {{}}
     */
    function compileSubmissionData() {
        let data = {};
        let missionContainer = svv.missionContainer;
        let mission = missionContainer ? missionContainer.getCurrentMission() : null;

        let labelContainer = svv.labelContainer;
        let labelList = labelContainer ? labelContainer.getCurrentLabels() : null;

        // Only submit mission progress if there is a mission when we're compiling submission data.
        if (mission) {
            // Add the current mission
            data.missionProgress = {
                mission_id: mission.getProperty("missionId"),
                mission_type: mission.getProperty("missionType"),
                labels_progress: mission.getProperty("labelsProgress"),
                label_type_id: mission.getProperty("labelTypeId"),
                completed: mission.getProperty("completed"),
                skipped: mission.getProperty("skipped")
            };
        }

        // Only label list if there is a label list when we're compiling submission data.
        if (labelList) {
            data.labels = svv.labelContainer.getCurrentLabels();
            svv.labelContainer.refresh();
        } else {
            data.labels = [];
        }

        data.interactions = svv.tracker.getActions();
        svv.tracker.refresh();
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

                    // If the back-end says it is time to switch to auditing, then do it immediately (mostly to
                    // prevent turkers from modifying JS variables to prevent switching to auditing).
                    if (result.switch_to_auditing) window.location.replace('/audit');

                    // If a mission was returned after posting data, create a new mission.
                    if (result.hasMissionAvailable) {
                        if (result.mission) {
                            svv.missionContainer.createAMission(result.mission, result.progress);
                            svv.panoramaContainer.setLabelList(result.labels);
                            svv.panoramaContainer.reset();
                            svv.modalMissionComplete.setProperty('clickable', true);
                        }
                    } else {
                        // Otherwise, display popup that says there are no more labels left.
                        svv.modalMissionComplete.hide();
                        svv.modalNoNewMission.show();
                    }
                }
            },
            error: function (xhr, status, result) {
                console.error(xhr.responseText);
                console.error(result);
            }
        });
    }

    $(window).on('beforeunload', function () {
        svv.tracker.push("Unload");

        // April 17, 2019
        // What we want here is type: 'application/json'. Can't do that quite yet because the
        // feature has been disabled, but we should switch back when we can.
        //
        // // For now, we send plaintext and the server converts it to actual JSON
        //
        // Source for fix and ongoing discussion is here:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        let data = [compileSubmissionData()];
        let jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}
