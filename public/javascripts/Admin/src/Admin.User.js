function AdminUser(_, $, c3, params) {
    var self = {};
    var _data = {};

    self.username = params.username;

    $.getJSON("/admin/tasks/" + self.username, function (data) {
        _data.tasks = data;
        completedInitializingAuditedTasks = true;

        // http://stackoverflow.com/questions/3552461/how-to-format-a-javascript-date
        var monthNames = [
            "January", "February", "March",
            "April", "May", "June", "July",
            "August", "September", "October",
            "November", "December"
        ];



        var grouped = _.groupBy(_data.tasks, function (o) { return o.audit_task_id});
        var auditTaskId;
        var auditTaskIds = Object.keys(grouped);
        var tableRows = "";
        var labelCounter;
        var i;
        var auditTaskIdsLength = auditTaskIds.length;
        var j;
        var labelsLength;
        var labelType;
        auditTaskIds.sort(function (id1, id2) {
            var timestamp1 = grouped[id1][0].task_start;
            var timestamp2 = grouped[id2][0].task_start;
            if (timestamp1 < timestamp2) { return -1; }
            else if (timestamp1 > timestamp2) { return 1; }
            else { return 0; }
        });

        for (i = auditTaskIdsLength - 1; i >= 0; i--) {
            labelCounter = { "CurbRamp": 0, "NoCurbRamp": 0, "Obstacle": 0, "SurfaceProblem": 0, "Other": 0 };
            auditTaskId = auditTaskIds[i];
            labelsLength = grouped[auditTaskId].length;
            for (j = 0; j < labelsLength; j++) {
                labelType = grouped[auditTaskId][j]["label_type"];
                
                if (!(labelType in labelCounter)) {
                    labelType = "Other";
                }
                labelCounter[labelType] += 1;
            }

            var date = new Date(grouped[auditTaskId][0]["task_end"]);
            var day = date.getDate();
            var monthIndex = date.getMonth();
            var year = date.getFullYear();

            tableRows += "<tr>" +
                "<td class='col-xs-2'>" + day + ' ' + monthNames[monthIndex] + ' ' + year + "</td>" +
                "<td class='col-xs-2'>" + labelCounter["CurbRamp"] + "</td>" +
                "<td class='col-xs-2'>" + labelCounter["NoCurbRamp"] + "</td>" +
                "<td class='col-xs-2'>" + labelCounter["Obstacle"] + "</td>" +
                "<td class='col-xs-2'>" + labelCounter["SurfaceProblem"] + "</td>" +
                "<td class='col-xs-2'>" + labelCounter["Other"] + "</td>" +
                "</tr>";
        }

        $("#task-contribution-table").append(tableRows);
    });

    return self;
}