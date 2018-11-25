function Form(url) {
    var properties = {
        dataStoreUrl : url
    };

    function compileSubmissionData() {
        var data = {};
        data.interactions = svv.tracker.getActions();
        data.labels = svv.labelContainer.getCurrentLabels();

        svv.tracker.refresh();
        svv.labelContainer.refresh();
        console.log("[Form.js] compileSubmissionData");
        console.log(data);
        return data;
    }

    function _isValidationButtonClick(action) {
        return action.indexOf("ValidationButtonClick") >= 0;
    }

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
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
        return data;
    }

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}