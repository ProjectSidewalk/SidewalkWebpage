/**
 * Compiles and submits log data from Gallery.
 *
 * @param {*} url URL to send interaction data to.
 * @returns {Form}
 * @constructor
 */
function Form(url) {
    const dataStoreUrl = url;

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
            url: dataStoreUrl,
            method: 'POST',
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

    // Flush any remaining logs when the page is being dismissed. `pagehide` is the reliable, bfcache-compatible
    // unload signal; `keepalive` lets the POST outlive the page while still routing through AppManager's fetch
    // wrapper, which attaches the `Csrf-Token` header Play's CSRF filter requires (#3935).
    window.addEventListener('pagehide', function () {
        sg.tracker.push("Unload");
        let data = [compileSubmissionData()];
        fetch(dataStoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data),
            keepalive: true
        });
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}
