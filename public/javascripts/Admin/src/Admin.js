function Admin (_, $, c3, turf) {
    var self = {};
    self.markerLayer = null;
    self.auditedStreetLayer = null;
    self.visibleMarkers = ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Occlusion", "NoSidewalk", "Other"];

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // console.log(document.getElementById("anonUserTable").rows);
    // Getting data for histograms
    var regUserTable = document.getElementById("userTable").rows;
    var anonUserTable = document.getElementById("anonUserTable").rows;

    var regUserLabels = [], regUserAudits = [], regUserMissions = [];
    var anonUserLabels = [], anonUserAudits = [];

    for(var i = 1; i < regUserTable.length; i++) {
        var userInfo = regUserTable[i].innerText.split("\t");
        regUserLabels.push(userInfo[userInfo.length - 1]);
        regUserAudits.push(userInfo[userInfo.length - 2]);
        regUserMissions.push(userInfo[userInfo.length - 3]);
    }

    for(var i = 1; i < anonUserTable.length; i++) {
        var userInfo = anonUserTable[i].innerText.split("\t");
        anonUserLabels.push(userInfo[userInfo.length - 1]);
        anonUserAudits.push(userInfo[userInfo.length - 2]);
    }

    var allUsersLabels = regUserLabels.concat(anonUserLabels);
    var allUsersAudits = regUserAudits.concat(anonUserAudits);

    // new histogram code
    drawHistogram("svg1", "Labels Made Per User (Registered)", "Labels", regUserLabels);
    drawHistogram("svg2", "Labels Made Per User (Anonymous)", "Labels", anonUserLabels);
    drawHistogram("svg3", "Labels Made Per User (All)", "Labels", allUsersLabels);
    drawHistogram("svg4", "Audits Made Per User (Registered)", "Audits", regUserAudits);
    drawHistogram("svg5", "Audits Made Per User (Anonymous)", "Audits", anonUserAudits);
    drawHistogram("svg6", "Audits Made Per User (All)", "Audits", allUsersAudits);
    drawHistogram("svg7", "Missions Cleared Per User (Registered)", "Missions", regUserMissions);

    function drawHistogram(svgID, title, xAxis, data) {
        var mean = Math.round(d3.mean(data));
        var median = Math.round(d3.median(data));
        var padding = 20;
        var titlePadding = 25;
        var meanMedianOffset = 60;
        var meanOffset = 30;
        var medianOffset = 50;
        var correcting = 20;
        var textOffset = 15;

        var formatCount = d3.format(",.0f");

        var svg = d3.select("#" + svgID),
            margin = {top: 10, right: 30, bottom: 40, left: 30},
            width = +svg.attr("width") - margin.left - margin.right,
            height = +svg.attr("height") - margin.top - margin.bottom,
            g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        var x = d3.scaleLinear()
            .domain([0, d3.max(data)])
            .range([padding, width]);
            //.rangeRound([padding, width]);

        var bins = d3.histogram()
            .domain(x.domain())
            .thresholds(x.ticks(10))
            (data);

        var y = d3.scaleLinear()
            .domain([0, d3.max(bins, function(d) { return d.length; })])
            .range([height, padding + meanMedianOffset]);

        svg.append("text")
            .attr("transform",
                    "translate(" + (margin.left + x(d3.max(data) / 2)) + " ," + (height + margin.top + 35) + ")")
            .style("text-anchor", "middle")
            .style("font-family", "Helvetica Neue")
            .text(xAxis);

        svg.append("text")
            .attr("x", width/2 + padding)
            .attr("y", margin.top + titlePadding)
            .style("text-anchor", "middle")
            .style("font-family", "Helvetica Neue")
            .style("font-size", "32px")
            .text(title);

        svg.append("text")
            .attr("transform",
                  "translate(" + (margin.left + x(mean)) + " ," + (titlePadding + meanOffset + correcting - textOffset) + ")")
            .style("text-anchor", "middle")
            .style("font-family", "Helvetica Neue")
            .style("font-size", "12px")
            .style("fill", "#ee7600")
            .text("Mean: " + mean);

        svg.append("text")
            .attr("transform",
                    "translate(" + (margin.left + x(median)) + " ," + (titlePadding + medianOffset + correcting - textOffset) + ")")
            .style("text-anchor", "middle")
            .style("font-family", "Helvetica Neue")
            .style("font-size", "12px")
            .style("fill", "#ee7600")
            .text("Median: " + median);

        svg.append("rect")
            .attr("x", margin.left + x(mean))
            .attr("y", margin.top + titlePadding + meanOffset)
            .attr("width", 2)
            .attr("height", height - correcting - meanOffset)
            .style("fill", "#ee7600");

        svg.append("rect")
            .attr("x", margin.left + x(median))//width / d3.max(data) * median + padding + margin.left)
            .attr("y", margin.top + titlePadding + medianOffset)
            .attr("width", 2)
            .attr("height", height - correcting - medianOffset)
            .style("fill", "#ee7600");

        // svg.append("text")
        //     .attr("x", -width/3)
        //     .attr("y", height/2 + margin.top)
        //     .attr("transform", "rotate(-90)")
        //     .style("text-anchor", "middle")
        //     .style("font-family", "Lato")
        //     .text("User Time Spent (min)");

        var bar = g.selectAll(".bar")
            .data(bins)
            .enter().append("g")
            .attr("class", "bar")
            .attr("transform", function(d) { return "translate(" + x(d.x0) + "," + y(d.length) + ")"; });

        bar.append("rect")
            .attr("x", 1)
            .attr("width", x(bins[0].x1) - x(bins[0].x0) - 1)
            .attr("height", function(d) { return height - y(d.length); })
            .style("fill", "steelblue");

        // bar.append("text")
        //     .attr("dy", ".75em")
        //     .attr("y", 6)
        //     .attr("x", (x(bins[0].x1) - x(bins[0].x0)) / 2)
        //     .attr("text-anchor", "middle")
        //     .text(function(d) { return formatCount(d.length); });

        g.append("g")
            .attr("class", "axis axis--y")
            .attr("transform", "translate(" + padding+ ")")
            .call(d3.axisLeft(y));

        g.append("g")
            .attr("class", "axis axis--x")
            .attr("transform", "translate(0," + height + ")")
            .call(d3.axisBottom(x));
        }
    // end new histogram code


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

        $.getJSON("/neighborhoods", function (data) {
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
            self.auditedStreetLayer = L.geoJson(data, {
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
        var colorMapping = util.misc.getLabelColors(),
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
            layer.on('click', function(){
                self.adminGSVLabelView.showLabel(feature.properties.label_id);
            });
            layer.on({
                'mouseover': function() {
                    layer.setRadius(15);
                },
                'mouseout': function() {
                    layer.setRadius(5);
                }
            })
        }

        $.getJSON("/adminapi/labels/all", function (data) {
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
            document.getElementById("map-legend-other").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-occlusion").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-nosidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['NoSidewalk'].strokeStyle + "'></svg>";

            document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='black' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

            // Render submitted labels
            self.markerLayer = L.geoJson(data, {
                pointToLayer: function (feature, latlng) {
                    var style = $.extend(true, {}, geojsonMarkerOptions);
                    style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                    style.color = colorMapping[feature.properties.label_type].strokeStyle;
                    return L.circleMarker(latlng, style);
                },
                filter: function (feature, layer) {
                    return ($.inArray(feature.properties.label_type, self.visibleMarkers) > -1);

                },
                onEachFeature: onEachLabelFeature
            })
                .addTo(map);
        });
    }

    function clearMap(){
        map.removeLayer(self.markerLayer);
    }
    function clearAuditedStreetLayer(){
        map.removeLayer(self.auditedStreetLayer);
    }
    function redrawAuditedStreetLayer(){
        initializeAuditedStreets(map);
    }
    function redrawLabels(){
        initializeSubmittedLabels(map);
    }

    function updateVisibleMarkers() {
        self.visibleMarkers = []
        if (document.getElementById("curbramp").checked) {
            self.visibleMarkers.push("CurbRamp");
        }
        if (document.getElementById("missingcurbramp").checked) {
            self.visibleMarkers.push("NoCurbRamp");
        }
        if (document.getElementById("obstacle").checked) {
            self.visibleMarkers.push("Obstacle");
        }
        if (document.getElementById("surfaceprob").checked) {
            self.visibleMarkers.push("SurfaceProblem");
        }
        if (document.getElementById("occlusion").checked) {
            self.visibleMarkers.push("Occlusion");
        }
        if (document.getElementById("nosidewalk").checked) {
            self.visibleMarkers.push("NoSidewalk");
        }
        if (document.getElementById("other").checked) {
            self.visibleMarkers.push("Other");
        }


        admin.clearMap();
        admin.clearAuditedStreetLayer();
        admin.redrawLabels();

        if (document.getElementById("auditedstreet").checked) {
            admin.redrawAuditedStreetLayer();
        }

    }


    // A helper method to make an histogram of an array.
    function makeAHistogramArray(arrayOfNumbers, numberOfBins) {
        arrayOfNumbers.sort(function (a, b) { return a - b; });
        var stepSize = arrayOfNumbers[arrayOfNumbers.length - 1] / numberOfBins;
        var dividedArray = arrayOfNumbers.map(function (x) { return x / stepSize; });
        var histogram = Array.apply(null, Array(numberOfBins)).map(Number.prototype.valueOf,0);
        for (var i = 0; i < dividedArray.length; i++) {
            var binIndex = Math.floor(dividedArray[i] - 0.0000001);
            histogram[binIndex] += 1;
        }
        return {
            histogram: histogram,
            stepSize: stepSize,
            numberOfBins: numberOfBins
        };
    }

    function initializeAdminGSVLabelView() {
        self.adminGSVLabelView = AdminGSVLabel();
    }

    function initializeLabelTable() {
        $('.labelView').click(function (e) {
            e.preventDefault();
            self.adminGSVLabelView.showLabel($(this).data('labelId'));
        });
    }

    initializeOverlayPolygon(map);
    initializeNeighborhoodPolygons(map);
    initializeAuditedStreets(map);
    initializeSubmittedLabels(map);
    initializeAdminGSVLabelView();
    initializeLabelTable();

    self.clearMap = clearMap;
    self.redrawLabels = redrawLabels;
    self.clearAuditedStreetLayer = clearAuditedStreetLayer;
    self.redrawAuditedStreetLayer = redrawAuditedStreetLayer;
    self.updateVisibleMarkers = updateVisibleMarkers;
    return self;
}
