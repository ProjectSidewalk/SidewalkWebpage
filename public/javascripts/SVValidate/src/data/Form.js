function Form(url) {
    var properties = {
        dataStoreUrl : url
    };

    console.log("Form: " + properties.dataStoreUrl);

    function compileSubmissionData() {
        var data = {};

    };

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
                    /*
                    var taskId = result.audit_task_id;
                    task.setProperty("auditTaskId", taskId);
                    svl.tracker.setAuditTaskID(taskId);
                    if (result.mission) missionModel.createAMission(result.mission);
                    */
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