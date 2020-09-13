function AdminUser(user) {
    var _data = {};
    var params = {
        neighborhoodPolygonStyle: {
            color: '#888',
            weight: 2,
            opacity: 0.80,
            fillColor: "#808080",
            fillOpacity: 0.1
        },
        mouseoverStyle: {
            color: "red",
            fillColor: "red",
        },
        mouseoutStyle: {
            color: "#888",
            fillColor: "#808080"
        },
        webpageActivity: "Click_module=UserMap_regionId=",
        singleRegionColor: true,
        zoomControl: true,
        overlayPolygon: true,
        username: user,
        mapName: 'admin-map',
        mapStyle: "mapbox.streets",
        accessToken: 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA'
    };
    var streetParams = {
        labelPopup: true,
        isUserDash: true,
        streetColor: 'rgba(128, 128, 128, 1.0)',
        progress: true,
        progressElement: 'td-total-distance-audited-admin'
    };
    var map = Choropleth(_, $, 'null', params);
    InitializeAuditedStreets(map, "/adminapi/auditedStreets/" + params.username, streetParams);
    var self = InitializeSubmittedLabels(map, "/adminapi/labelLocations/" + params.username, streetParams, AdminGSVLabelView(true));
        
    $.getJSON("/adminapi/tasks/" + params.username, function (data) {
        _data.tasks = data;
        
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
            labelCounter = { "CurbRamp": 0, "NoCurbRamp": 0, "Obstacle": 0, "SurfaceProblem": 0, "NoSidewalk": 0, "Other": 0 };
            auditTaskId = auditTaskIds[i];
            labelsLength = grouped[auditTaskId].length;
            for (j = 0; j < labelsLength; j++) {
                labelType = grouped[auditTaskId][j]["label_type"];
                
                if (!(labelType in labelCounter)) {
                    labelType = "Other";
                }
                labelCounter[labelType] += 1;
            }

            // No need to load locale, correct locale loaded in timestamp.
            var localDate = moment(new Date(grouped[auditTaskId][0]["task_end"]));

            tableRows += "<tr>" +
                "<td class='col-xs-1'>" + localDate.format('L') + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["CurbRamp"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["NoCurbRamp"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["Obstacle"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["SurfaceProblem"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["NoSidewalk"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["Other"] + "</td>" +
                "</tr>";
        }

        $("#task-contribution-table").append(tableRows);
    });

    self.data = _data;
    return self;
}
