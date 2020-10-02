function AdminUser(user) {
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
        polygonFillStyle: 'singleColor',
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
        useTotalAuditedDistance: true,
        progressElement: 'td-total-distance-audited-admin'
    };
    var map;
    var layers = [];
    var loadPolygons = $.getJSON('/neighborhoods');
    var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
    var loadMapParams = $.getJSON('/cityMapParams');
    var loadAuditedStreets = $.getJSON('/adminapi/auditedStreets/' + params.username);
    var loadSubmittedLabels = $.getJSON('/adminapi/labelLocations/' + params.username);
    // When the polygons, polygon rates, and map params are all loaded the polygon regions can be rendered.
    var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
        map = Choropleth(_, $, 'null', params, layers, data1[0], data2[0], data3[0]);
    });
    // When the polygons have been rendered and the audited streets have loaded,
    // the audited streets can be rendered.
    var renderAuditedStreets = $.when(renderPolygons, loadAuditedStreets).done(function(data1, data2) {
        InitializeAuditedStreets(map, streetParams, data2[0]);
    });
    // When the audited streets have been rendered and the submitted labels have loaded,
    // the submitted labels can be rendered.
    $.when(renderAuditedStreets, loadSubmittedLabels).done(function(data1, data2) {
        InitializeSubmittedLabels(map, streetParams, AdminGSVLabelView(true), InitializeMapLayerContainer(), data2[0])
        if (streetParams.isUserDash) setRegionFocus(map, layers)
    })
    
    $.getJSON("/adminapi/tasks/" + params.username, function (data) {
        var grouped = _.groupBy(data, function (o) { return o.audit_task_id});
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

    return self;
}
