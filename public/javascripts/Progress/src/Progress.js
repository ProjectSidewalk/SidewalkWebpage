function Progress (_, $, difficultRegionIds, userRole) {
    var params = {
        choroplethType: 'userDash',
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
        clickData: true,
        mapName: 'map',
        mapStyle: "mapbox.streets",
        accessToken: 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA'
    };
    var streetParams = {
        choroplethType: 'userDash',
        isUserDash: true,
        streetColor: 'rgba(128, 128, 128, 1.0)',
        progress: true,
        progressElement: 'td-total-distance-audited',
        userRole: userRole
    };
    var map;
    var loadPolygons = $.getJSON('/neighborhoods');
    var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
    var loadMapParams = $.getJSON('/cityMapParams');
    var loadAuditedStreets = $.getJSON('/contribution/streets');
    var loadSubmittedLabels = $.getJSON('/userapi/labels');
    var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
        map = Choropleth(_, $, 'null', params, data1[0], data2[0], data3[0]);
    });
    var renderAuditedStreets = $.when(renderPolygons, loadAuditedStreets).done(function(data1, data2) {
        InitializeAuditedStreets(map, streetParams, data2[0]);
    });
    $.when(renderAuditedStreets, loadSubmittedLabels).done(function(data1, data2) {
        InitializeSubmittedLabels(map, streetParams, 'null', InitializeMapLayerContainer(), data2[0])
    })
    initializeAuditCountChart();
    initializeSubmittedMissions();

    function initializeAuditCountChart() {
        $.getJSON("/contribution/auditCounts", function (data) {
            var dates = ['Date'].concat(data[0].map(function (x) { return x.date; }));
            var counts = [i18next.t("audit-count")].concat(data[0].map(function (x) { return x.count; }));
            var chart = c3.generate({
                bindto: "#audit-count-chart",
                data: {
                    x: 'Date',
                    columns: [ dates, counts ],
                    types: { 'Audit Count': 'line' }
                },
                axis: {
                    x: {
                        type: 'timeseries',
                        tick: {
                            format: function(x) {
                                return moment(x).format('D MMMM YYYY');
                            }
                        }
                    },
                    y: {
                        label: i18next.t("street-audit-count"),
                        min: 0,
                        padding: { top: 50, bottom: 10 }
                    }
                },
                legend: {
                    show: false
                }
            });
        });
    }

    /**
     * This method appends all the missions a user has to the task
     * contribution table in the user dashboard
     */
    function initializeSubmittedMissions() {
        $.getJSON("/getMissions", function (data) {
            // sorts all labels the user has completed by mission
            var grouped = _.groupBy(data, function (o) { return o.mission_id });
            var missionId;
            var missionTaskIds = Object.keys(grouped);
            var missionNumber = 0;
            var tableRows = "";
            var labelCounter;
            var i;
            var missionTaskIdsLength = missionTaskIds.length;
            var j;
            var labelsLength;
            var labelType;
            // sorts missions by putting completed missions first then
            // uncompleted missions, each in chronological order
            missionTaskIds.sort(function (id1, id2) {
                var timestamp1 = grouped[id1][0].mission_end;
                var timestamp2 = grouped[id2][0].mission_end;
                var firstCompleted = grouped[id1][0].completed;
                var secondCompleted = grouped[id2][0].completed;
                if (firstCompleted && secondCompleted) {
                    if (timestamp1 < timestamp2) { return 1; }
                    else if (timestamp1 > timestamp2) { return -1; }
                    else { return 0; }
                } else if (firstCompleted && !secondCompleted) {
                    return 1;
                } else if (!firstCompleted && secondCompleted) {
                    return -1;
                } else {
                    var startstamp1 = grouped[id1][0].mission_start;
                    var startstamp2 = grouped[id2][0].mission_start;
                    if (startstamp1 < startstamp2) { return 1; }
                    else if (startstamp1 > startstamp2) { return -1; }
                    else { return 0; }
                }
            });

            // counts the type of label for each mission to display the
            // numbers in the missions table
            for (i = missionTaskIdsLength - 1; i >= 0; i--) {
                labelCounter = { "CurbRamp": 0, "NoCurbRamp": 0, "Obstacle": 0, "SurfaceProblem": 0, "NoSidewalk": 0, "Other": 0 };
                missionId = missionTaskIds[i];
                labelsLength = grouped[missionId].length;
                for (j = 0; j < labelsLength; j++) {
                    labelType = grouped[missionId][j]["label_type"];
                    // missions with no labels have an undefined labelType
                    if (labelType === undefined) {
                        break;
                    } else {
                        if (!(labelType in labelCounter)) {
                            labelType = "Other";
                        }
                        labelCounter[labelType] += 1;
                    }
                }
                
                // No need to load locale, correct locale loaded for timestamp.
                var localDate = moment(new Date(grouped[missionId][0]["mission_end"]));

                var neighborhood;
                // neighborhood name is tutorial if there is no neighborhood
                // assigned for that mission
                if (grouped[missionId][0]["neighborhood"]) {
                    neighborhood = grouped[missionId][0]["neighborhood"];
                } else {
                    neighborhood = "Tutorial";
                }

                var dateString;
                // Date is "In Progress" if the mission has not yet been completed
                if (grouped[missionId][0]["completed"]) {
                    dateString = localDate.format('D MMM YYYY');
                } else {
                    dateString = i18next.t("in-progress");
                }

                missionNumber++;

                // adds all the mission information to a row in the table
                tableRows += "<tr>" +
                    "<td class='col-xxs-1'>" + missionNumber + "</td>" +
                    "<td class='col-date'>" + dateString + "</td>" +
                    "<td class='col-neighborhood'>" + neighborhood + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["CurbRamp"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["NoCurbRamp"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["Obstacle"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["SurfaceProblem"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["NoSidewalk"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["Other"] + "</td>" +
                    "</tr>";
            }
            $("#task-contribution-table").append(tableRows);
        });
    }
}
