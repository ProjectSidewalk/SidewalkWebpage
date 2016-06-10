function AdminTask(_, $, c3, d3, svl, params) {
    var self = {};
    var _data = {};

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';
    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });

    var map = L.mapbox.map('map', "kotarohara.8e0c6890", {zoomControl: false})
    // .addLayer(mapboxTiles)
        .setView([38.910, -77.040], 17);

    // Don't allow zooming (yet!)
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();

    (function mapAnimation () {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[-75, 36], [-75, 40], [-78, 40], [-78, 36],[-75, 36]]
                        ]
                    }
                }
            ]
        };

        var overlayPolygonLayer = L.geoJson(overlayPolygon).addTo(map);
        var colorScheme = svl.misc.getLabelColors();

        // Prepare a layer to put d3 stuff
        var svg = d3.select(map.getPanes().overlayPane).append("svg");  // The base svg
        var g = svg.append("g").attr("class", "leaflet-zoom-hide");  // The root group

        // Import the sample data and start animating
        var geojsonURL = "/contribution/auditInteractions";
        d3.json(geojsonURL, function (collection) {
            animate(collection);
        });

        /**
         * This function animates how a user (represented as a yellow circle) walked through the map and labeled
         * accessibility attributes.
         *
         * param walkTrajectory A trajectory of a user's auditing activity in a GeoJSON FeatureCollection format.
         */
        function animate(walkTrajectory) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var initialCoordinate = walkTrajectory.features[0].geometry.coordinates,
                transform = d3.geo.transform({point: projectPoint}),
                d3path = d3.geo.path().projection(transform),
                featuresdata = walkTrajectory.features,
                markerGroup = g.append("g").data(featuresdata);
            var marker = markerGroup.append("circle")
                .attr("r", 2)
                .attr("id", "marker")
                .attr("class", "travelMarker");
            var markerNose = markerGroup.append("line")
                .attr({'x1': 0, 'y1': -3, 'x2': 0, 'y2': -10})
                .attr('stroke', 'gray')
                .attr('stroke-width', 2);

            map.setView([initialCoordinate[1], initialCoordinate[0]], 18);

            // Set the initial heading
            markerGroup.attr("transform", function () {
                var y = featuresdata[0].geometry.coordinates[1];
                var x = featuresdata[0].geometry.coordinates[0];
                var heading = featuresdata[0].properties.heading;
                return "translate(" +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")" +
                    "rotate(" + heading + ")";
            });


            // Get the bounding box and align the svg
            var bounds = d3path.bounds(walkTrajectory),
                topLeft = bounds[0],
                bottomRight = bounds[1];
            svg.attr("width", bottomRight[0] - topLeft[0] + 120)
                .attr("height", bottomRight[1] - topLeft[1] + 120)
                .style("left", topLeft[0] - 50 + "px")
                .style("top", topLeft[1] - 50 + "px");
            g.attr("transform", "translate(" + (-topLeft[0] + 50) + "," + (-topLeft[1] + 50) + ")");

            // Apply the toLine function to align the path to
            markerGroup.attr("transform", function () {
                var y = featuresdata[0].geometry.coordinates[1];
                var x = featuresdata[0].geometry.coordinates[0];
                return "translate(" +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")";
            });

            // Animate the marker
            markerGroup = markerGroup.attr("counter", 0)
                .transition()
                .each("start", function () {
                    var thisMarker = d3.select(d3.select(this).node().children[0]);
                    var thisMarkerNose = d3.select(d3.select(this).node().children[0]);

                    thisMarker.transition()
                        .duration(250)
                        .attr("r", 7);
                })
                .duration(750);


            // Chain transitions
            for (var i = 0; i < featuresdata.length; i++) {
                featuresdata[i].properties.timestamp /= 5;
            }

            var currentTimestamp = featuresdata[0].properties.timestamp;
            for (var i = 0; i < featuresdata.length; i++) {
                var duration = featuresdata[i].properties.timestamp - currentTimestamp,
                    currentTimestamp = featuresdata[i].properties.timestamp;
                markerGroup = markerGroup.transition()
                    .duration(duration)
                    .attr("transform", function () {
                        var y = featuresdata[i].geometry.coordinates[1];
                        var x = featuresdata[i].geometry.coordinates[0];
                        var heading = featuresdata[i].properties.heading;
                        return "translate(" +
                            map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                            map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")" +
                            "rotate(" + heading + ")";
                    })
                    .each("end", function () {
                        // If the "label" is in the data, draw the label data and attach mouseover/mouseout events.
                        var counter = d3.select(this).attr("counter");
                        var d = featuresdata[counter];
                        if (d) {
                            if ("label" in d.properties) {
                                var label = d.properties.label;
                                var p = map.latLngToLayerPoint(new L.LatLng(label.coordinates[1], label.coordinates[0]));
                                var c = g.append("circle")
                                    .attr("r", 5)
                                    .attr("cx", p.x)
                                    .attr("cy", p.y)
                                    .attr("fill", function () {
                                        return svl.util.color.changeAlphaRGBA(colorScheme["CurbRamp"].fillStyle, 0.5);
                                    })
                                    // .attr("color", "white")
                                    // .attr("stroke", "#ddd")
                                    .attr("stroke-width", 1)
                                    .on("mouseover", function () {
                                        d3.select(this).attr("r", 15);
                                    })
                                    .on("mouseout", function () {
                                        d3.select(this).attr("r", 5);
                                    });
                                // Update the chart as well
                                dotPlotVisualization.increment(label.label_type);
                                dotPlotVisualization.udpate();

                            }
                        }
                        d3.select(this).attr("counter", ++counter);
                    });
            }
            // Finally delete the marker
            markerGroup.transition()
                .each("start", function () {
                    var thisMarker = d3.select(d3.select(this).node().children[0]);
                    thisMarker.transition()
                        .delay(500)
                        .duration(250)
                        .attr("r", 1);
                })
                .duration(750)
                .remove();
        }

        function projectPoint(x, y) {
            var point = map.latLngToLayerPoint(new L.LatLng(y, x));

            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            this.stream.point(point.x, point.y);
        }
        function applyLatLngToLayer(d) {
            var y = d.geometry.coordinates[1];
            var x = d.geometry.coordinates[0];
            return map.latLngToLayerPoint(new L.LatLng(y, x))
        }
    })();


    function DotPlotVisualization () {
        var radius = 0.4, dR = radius / 2;
        var svgWidth = 800, svgHeight = 50;
        var margin = {top: 10, right: 10, bottom: 10, left: 10},
            padding = {left: 5, top: 15},
            width = 200 - margin.left - margin.right,
            height = 50 - margin.top - margin.bottom;
        var colorScheme = svl.misc.getLabelColors();
        // Prepare a group to store svg elements, and declare a text
        var dotPlots = {
            "CurbRamp": {
                id: "CurbRamp",
                description: "Curb Ramp",
                left: margin.left,
                top: margin.top,
                fillColor: svl.util.color.changeAlphaRGBA(colorScheme["CurbRamp"].fillStyle, 0.5),
                count: 0,
                data: []
            },
            "NoCurbRamp": {
                id: "NoCurbRamp",
                description: "Missing Curb Ramp",
                left: width + margin.left,
                top: margin.top,
                fillColor: colorScheme["NoCurbRamp"].fillStyle,
                count: 0,
                data: []
            },
            "Obstacle": {
                id: "Obstacle",
                description: "Obstacle in Path",
                left: 2 * width + margin.left,
                top: margin.top,
                fillColor: colorScheme["Obstacle"].fillStyle,
                count: 0,
                data: []
            },
            "SurfaceProblem": {
                id: "SurfaceProblem",
                description: "Surface Problem",
                left: 3 * width + margin.left,
                top: margin.top,
                fillColor: colorScheme["SurfaceProblem"].fillStyle,
                count: 0,
                data: []
            }
        };

        var x = d3.scale.linear()
            .domain([0, 20])
            .range([0, width]);

        var y = d3.scale.linear()
            .domain([0, 20])
            .range([height, 0]);

        var svg = d3.select('#map-chart')
            .append('svg')
            .attr('width', svgWidth)
            .attr('height', svgHeight)


        var chart = svg.append('g')
            .attr('width', svgWidth)
            .attr('height', svgHeight)
            .attr('class', 'chart')
            .attr('transform', function () {
                return 'translate(135,10)';
            });

        for (var key in dotPlots) {
            dotPlots[key].g = chart.append('g')
                .attr('transform', 'translate(' + dotPlots[key].left + ',' + dotPlots[key].top + ')')
                .attr('width', width)
                .attr('height', height)
                .attr('class', 'main');
            dotPlots[key].plot = dotPlots[key].g.append("g")
                .attr('transform', 'translate(' + padding.left + ',' + padding.top + ')');

            dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
                .data([0])
                .enter()
                .append("text")
                .text(function () { return dotPlots[key].description; })
                .style("font-size", "13px");
            dotPlots[key].countLabel = dotPlots[key].plot.selectAll("text.count-label")
                .data([0])
                .enter()
                .append("text")
                .style("font-size", "13px")
                .style("fill", "gray");
        }

        function update(key) {
            // If a key is given, udpate the dot plot for that specific data.
            // Otherwise update all.
            if (key) {
                _update(key)
            } else {
                for (var key in dotPlots) {
                    _update(key);
                }
            }

            // Actual update function
            function _update(key) {
                var firstDigit = dotPlots[key].count % 10,
                    higherDigits = (dotPlots[key].count - firstDigit) / 10,
                    count = firstDigit + higherDigits;

                // Update the label
                dotPlots[key].countLabel
                    .transition().duration(1000)
                    .attr("x", function () {
                        return x(higherDigits * 2 * (radius + dR) + firstDigit * 2 * radius)
                    })
                    .attr("y", function () {
                        return x(radius + dR - 0.05);
                    })
                    // .transition().duration(1000)
                    .text(function (d) {
                        return dotPlots[key].count;
                    });

                // Update the dot plot
                if (dotPlots[key].data.length >= count) {
                    // Remove dots
                    dotPlots[key].data = dotPlots[key].data.slice(0, count);

                    dotPlots[key].plot.selectAll("circle")
                        .transition().duration(500)
                        .attr("r", function (d, i) {
                            return i < higherDigits ? x(radius + dR) : x(radius);
                        })
                        .attr("cy", 0);

                    dotPlots[key].plot.selectAll("circle")
                        .data(dotPlots[key].data)
                        .exit()
                        .transition()
                        .duration(500)
                        .attr("cx", function () {
                            return x(higherDigits);
                        })
                        .attr("r", 0)
                        .remove();
                } else {
                    // Add dots
                    var len = dotPlots[key].data.length;
                    for (var i = 0; i < count - len; i++) {
                        dotPlots[key].data.push([len + i, 0, radius])
                    }
                    dotPlots[key].plot.selectAll("circle")
                        .data(dotPlots[key].data)
                        .enter().append("circle")
                        .attr("cx", x(0))
                        .attr("cy", 0)
                        .attr("r", x(radius + dR))
                        .style("fill", dotPlots[key].fillColor)
                        .transition().duration(1000)
                        .attr("cx", function (d, i) {
                            if (i <= higherDigits) {
                                return x(d[0] * 2 * (radius + dR));
                            } else {
                                return x((higherDigits) * 2 * (radius + dR)) + x((i - higherDigits) * 2 * radius)
                            }
                        })
                        .attr("cy", function (d, i) {
                            if (i < higherDigits) {
                                return 0;
                            } else {
                                return x(dR);
                            }
                        })
                        .attr("r", function (d, i) {
                            return i < higherDigits ? x(radius + dR) : x(radius);
                        });
                }
            }
        }

        function increment(key) {
            dotPlots[key].count += 1;
        }

        // Initialize
        update();
        //  setInterval(function () {
        //    var keys = Object.keys(dotPlots),
        //      idx = parseInt(keys.length * Math.random(), 10);
        //    increment[keys[idx]].count += 1
        //    update(keys[idx]);
        //  }, 1500);

        return {
            udpate: update,
            increment: increment
        }
    }
    var dotPlotVisualization = new DotPlotVisualization();

    self.data = _data;
    return self;
}
function AdminUser(_, $, c3, d3, svl, params) {
    var self = {};
    var _data = {};

    self.username = params.username;

    $.getJSON("/adminapi/interactions/" + self.username, function (data) {
        var grouped = _.groupBy(data, function (d) { return d.audit_task_id; });
        _data.interactions = data;
        var keys = Object.keys(grouped);
        var keyIndex;
        var keysLength = keys.length;
        var padding = { top: 5, right: 10, bottom: 5, left: 100 };
        var userInteractionSVGArray = [];
        var svgHeight = 45;
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
                    // if (!(d.action in eventProperties)) {
                    //     style = eventProperties["Default"];
                    // } else if (d.action.indexOf("FinishLabeling")) {
                    //     if (d.note) {
                    //         console.log(d.note);
                    //         var labelType = d.note.split(",")[0].split(":")[1];
                    //         var colors = svl.misc.getLabelColors();
                    //
                    //         console.log(colors);
                    //         console.log(colors[labelType]);
                    //         // console.log(labelType);
                    //         // console.log(svl.util.color.RGBAToRGB(svl.misc.getLabelColors("CurbRamp")));
                    //
                    //         style= eventProperties[d.action];
                    //     } else {
                    //         style = eventProperties["Default"];
                    //     }
                    // } else {
                    //     style = eventProperties[d.action];
                    // }
                    if (d.action.indexOf("FinishLabeling") > -1) {
                        if (d.note) {
                            var colors = svl.misc.getLabelColors();
                            var labelType = d.note.split(",")[0].split(":")[1];

                            if (labelType in colors) {
                                return svl.util.color.RGBAToRGB(colors[labelType].fillStyle);
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
                .attr("x", function (d) { return x(0) - padding.left; })
                .attr("y", function (d, i) { return 13 * (i + 1); })
                .attr("font-size", "10px")
                .text(function (d) { return d; });

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
function Admin ($, c3, turf) {
    var self = {};

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
    

    $.getJSON('/adminapi/missionsCompletedByUsers', function (data) {
        var i,
            len = data.length;

        // Todo. This code double counts the missions completed for different region. So it should be fixed in the future.
        var missions = {};
        var printedMissionName;
        for (i = 0; i < len; i++) {
            // Set the printed mission name
            if (data[i].label == "initial-mission") {
                printedMissionName = "Initial Mission (1000 ft)";
            } else if (data[i].label == "distance-mission") {
                if (data[i].level <= 2) {
                    printedMissionName = "Distance Mission (" + data[i].distance_ft + " ft)";
                } else {
                    printedMissionName = "Distance Mission (" + data[i].distance_mi + " mi)";
                }
            } else {
                printedMissionName = "Onboarding";
            }

            // Create a counter for the printedMissionName if it does not exist yet.
            if (!(printedMissionName in missions)) {
                missions[printedMissionName] = {
                    label: data[i].label,
                    level: data[i].level,
                    printedMissionName: printedMissionName,
                    count: 0
                };
            }
            missions[printedMissionName].count += 1;
        }
        var arrayOfMissions = Object.keys(missions).map(function (key) { return missions[key]; });
        arrayOfMissions.sort(function (a, b) {
            if (a.count < b.count) { return 1; }
            else if (a.count > b.count) { return -1; }
            else { return 0; }
        });
        
        var missionCountArray = ["Mission Counts"];
        var missionNames = [];
        for (i = 0; i < arrayOfMissions.length; i++) {
            missionCountArray.push(arrayOfMissions[i].count);
            missionNames.push(arrayOfMissions[i].printedMissionName);
        }
        var chart = c3.generate({
            bindto: '#completed-mission-histogram',
            data: {
                columns: [
                    missionCountArray
                ],
                type: 'bar'
            },
            axis: {
                x: {
                    type: 'category',
                    categories: missionNames
                },
                y: {
                    label: "# Users Completed the Mission",
                    min: 0,
                    padding: { top: 50, bottom: 10 }
                }
            },
            legend: {
                show: false
            }
        });
    });

    $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {
        var i,
            len = data.length,
            completionRate,
            row,
            rows = "";
        var coverageRateColumn = ["Neighborhood Coverage Rate (%)"];
        var coverageDistanceArray = ["Neighborhood Coverage (m)"];
        var neighborhoodNames = [];
        for (i = 0; i < len; i++) {
            completionRate = data[i].completed_distance_m / data[i].total_distance_m * 100;
            coverageRateColumn.push(completionRate);
            coverageDistanceArray.push(data[i].completed_distance_m);

            neighborhoodNames.push(data[i].name);
            // row = "<tr><th>" + data[i].region_id + " " + data[i].name + "</th><td>" + completionRate + "%</td>"
            // rows += row;
        }

        var coverageChart = c3.generate({
            bindto: '#neighborhood-completion-rate',
            data: {
                columns: [
                    coverageRateColumn
                ],
                type: 'bar'
            },
            axis: {
                x: {
                    type: 'category',
                    categories: neighborhoodNames
                },
                y: {
                    label: "Neighborhood Coverage Rate (%)",
                    min: 0,
                    max: 100,
                    padding: { top: 50, bottom: 10 }
                }
            },
            legend: {
                show: false
            }
        });

        var coverageDistanceChart = c3.generate({
            bindto: '#neighborhood-completed-distance',
            data: {
                columns: [
                    coverageDistanceArray
                ],
                type: 'bar'
            },
            axis: {
                x: {
                    type: 'category',
                    categories: neighborhoodNames
                },
                y: {
                    label: "Coverage Distance (m)",
                    min: 0,
                    padding: { top: 50, bottom: 10 }
                }
            },
            legend: {
                show: false
            }
        });

    });

    $.getJSON("/contribution/auditCounts/all", function (data) {
        var dates = ['Date'].concat(data[0].map(function (x) { return x.date; })),
            counts = ['Audit Count'].concat(data[0].map(function (x) { return x.count; }));
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
                    tick: { format: '%Y-%m-%d' }
                },
                y: {
                    label: "Street Audit Count",
                    min: 0,
                    padding: { top: 50, bottom: 10 }
                }
            },
            legend: {
                show: false
            }
        });
    });

    $.getJSON("/contribution/labelCounts/all", function (data) {
        var dates = ['Date'].concat(data[0].map(function (x) { return x.date; })),
            counts = ['Label Count'].concat(data[0].map(function (x) { return x.count; }));
        var chart = c3.generate({
            bindto: "#label-count-chart",
            data: {
                x: 'Date',
                columns: [ dates, counts ],
                types: { 'Audit Count': 'line' }
            },
            axis: {
                x: {
                    type: 'timeseries',
                    tick: { format: '%Y-%m-%d' }
                },
                y: {
                    label: "Label Count",
                    min: 0,
                    padding: { top: 50, bottom: 10 }
                }
            },
            legend: {
                show: false
            }
        });
    });

    // Initialize the map
    /**
     * This function adds a semi-transparent white polygon on top of a map
     */
    function initializeOverlayPolygon (map) {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {
                "type": "Polygon", "coordinates": [
                    [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
                ]}}]};
        var layer = L.geoJson(overlayPolygon);
        layer.setStyle({color: "#ccc", fillColor: "#ccc"});
        layer.addTo(map);
    }

    /**
     * render points
     */
    function initializeNeighborhoodPolygons(map) {
        var neighborhoodPolygonStyle = {
                color: '#888',
                weight: 1,
                opacity: 0.25,
                fillColor: "#ccc",
                fillOpacity: 0.1
            },
            layers = [],
            currentLayer;

        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id,
                url = "/audit/region/" + regionId,
                popupContent = "Do you want to explore this area to find accessibility issues? " +
                    "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Sure!</a>";
            layer.bindPopup(popupContent);
            layers.push(layer);

            layer.on('mouseover', function (e) {
                this.setStyle({color: "red", fillColor: "red"});

            });
            layer.on('mouseout', function (e) {
                for (var i = layers.length - 1; i >= 0; i--) {
                    if (currentLayer !== layers[i])
                        layers[i].setStyle(neighborhoodPolygonStyle);
                }
                //this.setStyle(neighborhoodPolygonStyle);
            });
            layer.on('click', function (e) {
                var center = turf.center(this.feature),
                    coordinates = center.geometry.coordinates,
                    latlng = L.latLng(coordinates[1], coordinates[0]),
                    zoom = map.getZoom();
                zoom = zoom > 14 ? zoom : 14;

                map.setView(latlng, zoom, {animate: true});
                currentLayer = this;
            });
        }

        $.getJSON("/geometry/neighborhoods", function (data) {
            L.geoJson(data, {
                style: function (feature) {
                    return $.extend(true, {}, neighborhoodPolygonStyle);
                },
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
        });
    }

    /**
     * This function queries the streets that the user audited and visualize them as segmetns on the map.
     */
    function initializeAuditedStreets(map) {
        var distanceAudited = 0,  // Distance audited in km
            streetLinestringStyle = {
                color: "black",
                weight: 3,
                opacity: 0.75
            };

        function onEachStreetFeature(feature, layer) {
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
        }

        $.getJSON("/contribution/streets/all", function (data) {

            // Render audited street segments
            L.geoJson(data, {
                pointToLayer: L.mapbox.marker.style,
                style: function(feature) {
                    var style = $.extend(true, {}, streetLinestringStyle);
                    var randomInt = Math.floor(Math.random() * 5);
                    style.color = "#000";
                    style["stroke-width"] = 3;
                    style.opacity = 0.75;
                    style.weight = 3;

                    return style;
                },
                onEachFeature: onEachStreetFeature
            })
                .addTo(map);

            // Calculate total distance audited in (km)
            for (var i = data.features.length - 1; i >= 0; i--) {
                distanceAudited += turf.lineDistance(data.features[i]);
            }
            // document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " km";
        });
    }

    function initializeSubmittedLabels(map) {
        var colorMapping = svl.misc.getLabelColors(),
            geojsonMarkerOptions = {
                radius: 5,
                fillColor: "#ff7800",
                color: "#ffffff",
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.5,
                "stroke-width": 1
            };

        function onEachLabelFeature(feature, layer) {
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
        }

        $.getJSON("/contribution/labels/all", function (data) {
            // Count a number of each label type
            var labelCounter = {
                "CurbRamp": 0,
                "NoCurbRamp": 0,
                "Obstacle": 0,
                "SurfaceProblem": 0
            };

            for (var i = data.features.length - 1; i >= 0; i--) {
                labelCounter[data.features[i].properties.label_type] += 1;
            }
            //document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
            //document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
            //document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
            //document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];

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
                },
                onEachFeature: onEachLabelFeature
            })
                .addTo(map);
        });
    }
    initializeOverlayPolygon(map);
    initializeNeighborhoodPolygons(map);
    initializeAuditedStreets(map);
    initializeSubmittedLabels(map);
        

    return self;
}