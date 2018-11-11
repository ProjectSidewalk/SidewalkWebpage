function Form(url) {
    var properties = {
        dataStoreUrl : url
    };

    function compileSubmissionData() {
        var data = {};
        var label = undefined;
    }

    function _isValidationButtonClick(action) {
        return action.indexOf("ValidationButtonClick") >= 0;
    }

    function submit(data, async) {
        if (typeof async === "undefined") {
            async = true;
        }


        if (data.constructor !== Array) {
            console.log("Converting data...");
            data = [data];
        }

        console.log("Data: " + data);

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
    }

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}