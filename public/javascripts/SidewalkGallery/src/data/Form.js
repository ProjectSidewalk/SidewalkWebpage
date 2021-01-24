/**
 * Compiles and submits log data from Sidewalk Gallery.
 * 
 * @param {*} url URL to send interaction data to.
 * @param {*} beaconUrl URL to send interaction data to on page unload.
 * @returns {Form}
 * @constructor
 */
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

        data.environment = {
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,
            avail_height: screen.availHeight, 
            operating_system: util.getOperatingSystem(),
            language: i18next.language
        };

        data.interactions = sg.tracker.getActions();
        sg.tracker.refresh();
        return data;
    }

    /**
     * Submits all front-end data to the backend.
     * 
     * @param data  Data object containing interactions.
     * @param async Whether to submit asynchronously or not.
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
            success: function () {
                console.log("Data logged successfully");
            },
            error: function (xhr, status, result) {
                console.error(xhr.responseText);
                console.error(result);
            }
        });
    }

    // On page unload, we compile stored interaction data and send it over.
    $(window).on('beforeunload', function () {
        sg.tracker.push("Unload");

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
