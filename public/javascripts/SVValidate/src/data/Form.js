function Form(url, beaconUrl) {
    let properties = {
        dataStoreUrl : url,
        beaconDataStoreUrl : beaconUrl
    };

    /**
     * Compiles data into a format that can be parsed by our backend.
     * @returns {{}}
     * @param {boolean} missionComplete Whether or not the mission is complete. To ensure we only send once per mission.
     */
    function compileSubmissionData(missionComplete) {
        let data = { timestamp: new Date().getTime() };
        let missionContainer = svv.missionContainer;
        let mission = missionContainer ? missionContainer.getCurrentMission() : null;

        let labelContainer = svv.labelContainer;
        let labelList = labelContainer ? labelContainer.getCurrentLabels() : null;
        // Only submit mission progress if there is a mission when we're compiling submission data.
        if (mission) {
            // Add the current mission
            data.mission_progress = {
                mission_id: mission.getProperty("missionId"),
                mission_type: mission.getProperty("missionType"),
                labels_progress: mission.getProperty("labelsProgress"),
                label_type_id: mission.getProperty("labelTypeId"),
                completed: missionComplete ? missionComplete : false,
                skipped: mission.getProperty("skipped")
            };
        }

        // Only include labels if there is a label list when we're compiling submission data.
        if (labelList) {
            data.labels = svv.labelContainer.getCurrentLabels();
            svv.labelContainer.refresh();
        } else {
            data.labels = [];
        }

        data.environment = {
            mission_id: mission ? mission.getProperty("missionId") : null,
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,              // total width - interface (taskbar)
            avail_height: screen.availHeight,            // total height - interface };
            operating_system: util.getOperatingSystem(),
            language: i18next.language,
            css_zoom: svv.cssZoom ? svv.cssZoom : 100
        };

        data.admin_params = {
            admin_version: svv.adminVersion,
            label_type_id: svv.adminLabelTypeId,
            user_ids: svv.adminUserIds,
            neighborhood_ids: svv.adminNeighborhoodIds
        };

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
                    if (result.switch_to_auditing) window.location.replace('/explore');

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
        let data = compileSubmissionData(false);
        let jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}
