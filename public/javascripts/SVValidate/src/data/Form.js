function Form(url) {
    let properties = {
        dataStoreUrl : url
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
        let data = compileSubmissionData();

        // Synchronous ajax requests have been disabled in Google Chrome, so our beforeunload requests are now failing.
        // The alternative we would like to use is Navigator.sendBeacon, but application/json is currently disabled
        // there :( So one small improvement we are making is to send _asynchronous_ requests in Chrome. These are not
        // guaranteed to send like sendBeacon or synchronous requests, but they will at least send some of the time. So
        // we will use synchronous for other browsers to guarantee data is sent and async on Chrome so it sometimes
        // sends until we are able to switch to something more reliable like sendBeacon. Make sure to make this change
        // on the audit page as well when a fix is found. How to check if Chrome:
        // https://stackoverflow.com/questions/9847580/how-to-detect-safari-chrome-ie-firefox-and-opera-browser
        let asyncParam;
        if (!!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime))
            asyncParam = true;
        else
            asyncParam = false;

        // Old code: this does not work on the newest versions of Google Chrome.
        // TODO: Replace with beacon (or some ajax alternative) asap. Starter code below.
        self.submit(data, asyncParam);

        // April 17, 2019
        // It looks like this isn't working at the moment. I'm replacing this method with what we
        // had previously, but I'm not convinced that it works on Chrome (at the very least, it
        // sends us an error message, but I'm not sure if it (reluctantly) submits data as well.
        //
        // let data = compileSubmissionData();
        let jsonData = JSON.stringify(data);
        //
        // April 17, 2019
        // What we want here is type: 'application/json'. Can't do that quite yet because the
        // feature has been disabled, but we should switch back when we can.
        //
        // Source for fix and ongoing discussion is here:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        //
        let headers = {
            type: 'application/x-www-form-urlencoded'
        };

        let blob = new Blob([jsonData], headers);
        navigator.sendBeacon(properties.dataStoreUrl, blob);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}
