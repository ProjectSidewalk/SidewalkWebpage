function AdminUser(params) {
    var self = {};
    var _data = {};
    self.username = params.username;
    self.adminGSVLabelView = AdminGSVLabelView(true);

    // Initialize the map
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });
    var map = L.mapbox.map('admin-map', "mapbox.streets", {
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    });
    var popup = L.popup().setContent('<p>Hello world!<br />This is a nice popup.</p>');

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    $.getJSON('/cityMapParams', function(data) {
        map.setView([data.city_center.lat, data.city_center.lng]);
        map.setZoom(data.default_zoom);
    });

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
                "SurfaceProblem": 0,
                "NoSidewalk":0
            };

        for (var i = data.features.length - 1; i >= 0; i--) labelCounter[data.features[i].properties.label_type] += 1;
        document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
        document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
        document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
        document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];
        document.getElementById("td-number-of-no-sidewalks").innerHTML = labelCounter["NoSidewalk"];
        document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
        document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
        document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
        document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
        document.getElementById("map-legend-nosidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "'></svg>";
        document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='black' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

        // Render submitted labels
        L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                return L.circleMarker(latlng, style);
            },
            onEachFeature: onEachLabelFeature
        }).addTo(map);
    });

    function onEachLabelFeature(feature, layer) {
        layer.on('click', function () {
            self.adminGSVLabelView.showLabel(feature.properties.label_id);
        });
        layer.on({
            'mouseover': function () {
                layer.setRadius(15);
            },
            'mouseout': function () {
                layer.setRadius(5);
            }
        })
    }
    
    $.getJSON("/adminapi/tasks/" + self.username, function (data) {
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
