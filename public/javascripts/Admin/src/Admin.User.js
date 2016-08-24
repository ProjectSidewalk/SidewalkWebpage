function AdminUser(params) {
    var self = {};
    var _data = {};
    self.username = params.username;

    // Initialize the map
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // Construct a bounding box for this map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast),

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
        tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA",
        mapboxTiles = L.tileLayer(tileUrl, {
            attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
        }),
        map = L.mapbox.map('admin-map', "kotarohara.8e0c6890", {
            // set that bounding box as maxBounds to restrict moving the map
            // see full maxBounds documentation:
            // http://leafletjs.com/reference.html#map-maxbounds
            maxBounds: bounds,
            maxZoom: 19,
            minZoom: 9
        })
        // .addLayer(mapboxTiles)
            .fitBounds(bounds)
            .setView([38.892, -77.038], 12),
        popup = L.popup().setContent('<p>Hello world!<br />This is a nice popup.</p>');

    // Visualize audited streets
    $.getJSON("/adminapi/auditedStreets/" + self.username, function (data) {
        // Render audited street segments
        L.geoJson(data, {
            pointToLayer: L.mapbox.marker.style,
            style: function(feature) {
                var style = {}; // $.extend(true, {}, streetLinestringStyle);
                var randomInt = Math.floor(Math.random() * 5);
                style.color = "#000";
                style["stroke-width"] = 3;
                style.opacity = 0.75;
                style.weight = 3;

                return style;
            },
            onEachFeature: function (feature, layer) {
                layer.on({
                    click: function (e) {  }
                })
            }
        })
            .addTo(map);
    });

    // Visualize the labels collected
    $.getJSON("/adminapi/labelLocations/" + self.username, function (data) {
        var colorMapping = util.misc.getLabelColors(),
            geojsonMarkerOptions = {
                radius: 5,
                fillColor: "#ff7800",
                color: "#ffffff",
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.5,
                "stroke-width": 1
            },
            labelCounter = {
                "CurbRamp": 0,
                "NoCurbRamp": 0,
                "Obstacle": 0,
                "SurfaceProblem": 0
            };

        for (var i = data.features.length - 1; i >= 0; i--) labelCounter[data.features[i].properties.label_type] += 1;

        document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
        document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
        document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
        document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
        document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='black' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

        // Render submitted labels
        L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                return L.circleMarker(latlng, style);
            }
        }).addTo(map);
    });

    // Visualize user interactions
    $.getJSON("/adminapi/interactions/" + self.username, function (data) {
        var grouped = _.groupBy(data, function (d) { return d.audit_task_id; });
        _data.interactions = data;
        var keys = Object.keys(grouped);
        var keyIndex;
        var keysLength = keys.length;
        var padding = { top: 5, right: 10, bottom: 5, left: 100 };
        var userInteractionSVGArray = [];
        var svgHeight = 60;
        var eventProperties = {
            "Default": {
                y: 30,
                fill: "#eee"
            },
            "LabelingCanvas_FinishLabeling": {
                y: 15,
                fill: "#888"
            },
            "TaskStart": {
                y: 0,
                fill: "steelblue"
            },
            "TaskEnd": {
                y: 0,
                fill: "green"
            },
            "TaskSkip": {
                y: 0,
                fill: "red"
            },
            "TaskSubmit": {
                y: 0,
                fill: "steelblue"
            },
            "Unload": {
                y: 0,
                fill: "red"
            }
        };

        // Draw Gantt charts for each task
        for (keyIndex = keysLength - 1; keyIndex >= 0; keyIndex--) {

            var key = keys[keyIndex];
            var taskInteractionArray = grouped[keys[keyIndex]];
            var taskInteractionArrayLength = taskInteractionArray.length;
            var svgWidth = $("#user-activity-chart").width();

            // Sort tasks by timestamp
            taskInteractionArray.sort(function (a, b) {
                if (a.timestamp < b.timestamp) return -1;
                else if (a.timestamp > b.timestamp) return 1;
                else return 0;
            });

            // Add the relativeTimestamp field to each record.
            taskInteractionArray = taskInteractionArray.map(function (o) {
                o.relativeTimestamp = o.timestamp - taskInteractionArray[0].timestamp;
                return o;
            });

            var timestampMax = 300000; // 5 minutes
            var x = d3.scale.linear().domain([ 0, timestampMax ]).range([ padding.left, svgWidth - padding.left - padding.right ]); //.clamp(true);
            var y = d3.scale.linear().domain([ 0, svgHeight]).range([ padding.top, svgHeight - padding.top - padding.bottom ]);

            var svg = d3.select("#user-activity-chart").append('svg').attr('width', svgWidth).attr('height', svgHeight);

            // Tooltip: http://bl.ocks.org/biovisualize/1016860
            var tooltip = d3.select("body")
                .append("div")
                .style("position", "absolute")
                .style("background", "#fefefe")
                .style("border", "1px solid #eee")
                .style("font-size", "10px")
                .style("padding", "1px")
                .style("z-index", "10")
                .style("visibility", "hidden");

            var chart = svg.append('g').attr('width', svgWidth).attr('height', svgHeight).attr('transform', function () { return 'translate(0, 0)'; });

            // Mouse event
            chart.selectAll("circle")
                .data(taskInteractionArray)
                .enter().append("circle")
                .attr("r", 5)
                .attr("cy", function (d) {
                    var style = (d.action in eventProperties) ? eventProperties[d.action] : eventProperties["Default"];
                    return y(style.y);
                })
                .attr("cx", function (d) {
                    return x(d.relativeTimestamp);
                })
                .style({opacity: 0.5, stroke: "white", "stroke-width": "2px"})
                .style("fill", function (d) {
                    var style = !(d.action in eventProperties) ? eventProperties["Default"] : eventProperties[d.action];
                    if (d.action.indexOf("FinishLabeling") > -1) {
                        if (d.note) {
                            var colors = util.misc.getLabelColors();
                            var labelType = d.note.split(",")[0].split(":")[1];

                            if (labelType in colors) {
                                return util.color.RGBAToRGB(colors[labelType].fillStyle);
                            }
                        }
                    }
                    return style.fill;
                })
                .on("mouseover", function(d){
                    var labelText = "Action: " + d.action + " " +
                        "<br />Time: " + (d.relativeTimestamp / 1000 / 60).toFixed(1) + "min" +
                        "<br />" + d.note;
                    return tooltip.style("visibility", "visible").html(labelText);
                })
                .on("mousemove", function(){ return tooltip.style("top", (event.pageY-10)+"px").style("left",(event.pageX+10)+"px"); })
                .on("mouseout", function(){ return tooltip.style("visibility", "hidden"); });

            // Draw borders
            var border = svg.append("line")
                .style("stroke", "#eee")
                .attr("x1", 0)
                .attr("y1", 0)
                .attr("x2", svgWidth)
                .attr("y2", 0);

            // Draw labels
            var taskId = "TaskId: " + key;

            var date = new Date(taskInteractionArray[0].timestamp);
            var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            var dateLabel = monthNames[date.getMonth()] + " " + date.getDate();
            var duration = "Duration: " + (taskInteractionArray[taskInteractionArrayLength - 1].relativeTimestamp / 1000 / 60).toFixed(1) + " min";
            var labelGroup = svg.append('g').attr('width', 100).attr('height', svgHeight);
            var labels = labelGroup.selectAll("text")
                .data([taskId, duration, dateLabel])
                .enter().append("text")
                .attr("class", "interaction-label")
                .attr("x", function (d) { return x(0) - padding.left; })
                .attr("y", function (d, i) { return 13 * (i + 1); })
                .attr("font-size", "10px")
                .text(function (d) { return d; });

            labels.filter(function(d){ return typeof(d) == "string" && d.indexOf("TaskId") !== -1; })
                .style("cursor", "pointer")
                .on("click", function(d){
                    var taskId = d.split(" ")[1];
                    document.location.href = "/admin/task/" + taskId;
                });


        }

    });
    
    $.getJSON("/adminapi/tasks/" + self.username, function (data) {
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

    self.data = _data;
    return self;
}