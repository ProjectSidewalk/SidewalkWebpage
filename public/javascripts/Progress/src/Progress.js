function Progress (_, $, L, role, difficultRegionIds) {
    var self = {};
    var completedInitializingNeighborhoodPolygons = false;
    var completedInitializingAuditedStreets = false;
    var completedInitializingSubmittedLabels = false;
    var completedInitializingAuditCountChart = false;
    var completedInitializingAuditedTasks = false;

    var neighborhoodPolygonStyle = {
            color: '#888',
            weight: 2,
            opacity: 0.80,
            fillColor: "#808080",
            fillOpacity: 0.1
        },
        layers = [];

    var _data = {
        neighborhoodPolygons: null,
        streets: null,
        labels: null,
        tasks: null,
        interactions: null
    };

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });
    var map = L.mapbox.map('map', null, {
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    }).addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/streets-v11'));

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    $.getJSON('/cityMapParams', function(data) {
        map.setView([data.city_center.lat, data.city_center.lng]);
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        map.setMaxBounds(L.latLngBounds(southWest, northEast));
        map.setZoom(data.default_zoom);
    });

    var popup = L.popup().setContent('<p>Hello!</p>');

    function handleInitializationComplete (map) {
        if (completedInitializingNeighborhoodPolygons &&
            completedInitializingAuditedStreets &&
            completedInitializingSubmittedLabels &&
            completedInitializingAuditCountChart &&
            completedInitializingAuditedTasks
        ) {

            // Search for a region id in the query string. If you find one, focus on that region.
            var regionId = util.getURLParameter("regionId"),
                i,
                len;
            if (regionId && layers) {
                len = layers.length;
                for (i = 0; i < len; i++) {
                    if ("feature" in layers[i] && "properties" in layers[i].feature && regionId == layers[i].feature.properties.region_id) {
                        var center = turf.center(layers[i].feature),
                            coordinates = center.geometry.coordinates,
                            latlng = L.latLng(coordinates[1], coordinates[0]),
                            zoom = map.getZoom();
                        zoom = zoom > 14 ? zoom : 14;

                        map.setView(latlng, zoom, {animate: true});
                        layers[i].setStyle({color: "red", fillColor: "red"});
                        break;
                    }
                }
            }
        }
    }

    /**
     * render points
     */
    function initializeNeighborhoodPolygons(map, rates) {
        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id;
            var regionName = feature.properties.region_name;
            var userCompleted = feature.properties.user_completed;
            var url = "/audit/region/" + regionId;
            // default popup content if we don't find neighborhood in list of neighborhoods from query
            var popupContent = "Do you want to find accessibility problems in " + regionName + "? " +
                    "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Sure!</a>";
            var compRate = 0;
            var milesLeft = 0;
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    var measurementSystem = i18next.t('common:measurement-system');
                    compRate = Math.round(100.0 * rates[i].rate);
                    distanceLeft = rates[i].total_distance_m - rates[i].completed_distance_m;
                    // If using metric system, convert from meters to kilometers. If using IS system, convert from meters to miles.
                    if (measurementSystem === "metric") distanceLeft *= 0.001;
                    else distanceLeft *= 0.000621371;
                    distanceLeft = Math.round(distanceLeft);

                    var advancedMessage = '';
                    if (difficultRegionIds.includes(feature.properties.region_id)) {
                        advancedMessage = '<br><b>Careful!</b> This neighborhood is not recommended for new users.<br><br>';
                    }

                    if (userCompleted) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.100-percent-complete") + "<br>" +
                            i18next.t("common:map.thanks");
                    } else if (compRate === 100) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.100-percent-complete") + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else if (distanceLeft === 0) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.less-than-one-unit-left") + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else if (distanceLeft === 1) {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.distance-left-one-unit") + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.distance-left", { n: distanceLeft }) + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    }
                    break;
                }
            }
            // Add listeners to popup so the popup closes when the mouse leaves the popup area.
            layer.bindPopup(popupContent).on("popupopen", () => {
                var popupWrapper = $('.leaflet-popup-content-wrapper');
                var popupCloseButton = $('.leaflet-popup-close-button');
                popupWrapper.on('mouseout', e => {
                    if (e.originalEvent.toElement.classList.contains('leaflet-container')) {
                        clearChoroplethRegionOutlines(layers);
                        layer.closePopup();
                    }
                });
                popupCloseButton.on('mouseout', e => {
                    if (e.originalEvent.toElement.classList.contains('leaflet-container')) {
                        clearChoroplethRegionOutlines(layers);
                        layer.closePopup();
                    }
                });
                // Make sure the region outline is removed when the popup close button is clicked.
                popupCloseButton.on('click', e => {
                    clearChoroplethRegionOutlines(layers);
                });
            });
            layers.push(layer);

            layer.on('mouseover', function (e) {
                clearChoroplethRegionOutlines(layers);
                addChoroplethRegionOutline(this);
                this.openPopup();

            });
            layer.on('mouseout', function (e) {
                if (e.originalEvent.toElement.classList.contains('leaflet-container')) {
                    clearChoroplethRegionOutlines(layers);
                    this.closePopup();
                }
            });
            layer.on('click', function (e) {
                // Log when a user clicks on a region on the user map
                // Logs are of the form "Click_module=UserMap_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=inspect"
                // Log is stored in WebpageActivityTable
                var regionId = e.target.feature.properties.region_id;
                var ratesEl = rates.find(function(x){
                    return regionId == x.region_id;
                });
                var compRate = Math.round(100.0 * ratesEl.rate);
                var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
                var distanceLeft = "";
                if (compRate === 100) {
                    distanceLeft = "0";
                }
                else if (milesLeft === 0) {
                    distanceLeft = "<1";
                }
                else if (milesLeft === 1) {
                    distanceLeft = "1";
                }
                else {
                    distanceLeft = ">1";
                }
                var url = "/userapi/logWebpageActivity";
                var async = true;
                var data = "Click_module=UserMap_regionId="+regionId+"_distanceLeft="+distanceLeft+"_target=inspect";
                $.ajax({
                    async: async,
                    contentType: 'application/json; charset=utf-8',
                    url: url,
                    type: 'post',
                    data: JSON.stringify(data),
                    dataType: 'json',
                    success: function (result) {
                    },
                    error: function (result) {
                        console.error(result);
                    }
                });
            });

        }

        $.getJSON("/neighborhoods", function (data) {
            _data.neighborhoodPolygons = data;

            L.geoJson(data, {
                style: function (feature) {
                    return $.extend(true, {}, neighborhoodPolygonStyle);
                },
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
            completedInitializingNeighborhoodPolygons = true;
            handleInitializationComplete(map);
        });


        // Logs when a region is selected from the user map and 'Click here' is clicked
        // Logs are of the form "Click_module=UserMap_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=audit"
        // Log is stored in WebpageActivityTable
        $("#map").on('click', '.region-selection-trigger', function () {
            var regionId = $(this).attr('regionId');
            var ratesEl = rates.find(function(x){
                return regionId == x.region_id;
            });
            var compRate = Math.round(100.0 * ratesEl.rate);
            var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
            var distanceLeft = "";
            if (compRate === 100) {
                distanceLeft = "0";
            }
            else if (milesLeft === 0) {
                distanceLeft = "<1";
            }
            else if (milesLeft === 1) {
                distanceLeft = "1";
            }
            else {
                distanceLeft = ">1";
            }
            var url = "/userapi/logWebpageActivity";
            var async = true;
            var data = "Click_UserMap_regionId="+regionId+"_distanceLeft="+distanceLeft+"_target=audit";
            $.ajax({
                async: async,
                contentType: 'application/json; charset=utf-8',
                url: url,
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                },
                error: function (result) {
                    console.error(result);
                }
            });
        });
    }

    function clearChoroplethRegionOutlines(layers) {
        for (var i = layers.length - 1; i >= 0; i--) {
            layers[i].setStyle({opacity: 0.8, weight: 2, color: "#888"});
        }
    }

    function addChoroplethRegionOutline(layer) {
        layer.setStyle({opacity: 1.0, weight: 3, color: "#000"});
    }


    /**
     * This function queries the streets that the user audited and visualize them as segments on the map.
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

        $.getJSON("/contribution/streets", function (data) {
            _data.streets = data;

            // Render audited street segments
            L.geoJson(data, {
                pointToLayer: L.mapbox.marker.style,
                style: function(feature) {
                    var style = $.extend(true, {}, streetLinestringStyle);
                    style.color = "rgba(128, 128, 128, 1.0)";
                    style["stroke-width"] = 3;
                    style.opacity = 0.75;
                    style.weight = 3;

                    return style;
                },
                onEachFeature: onEachStreetFeature
            })
                .addTo(map);

            // Calculate total distance audited in kilometers/miles depending on the measurement system used in the user's country.
            for (var i = data.features.length - 1; i >= 0; i--) {
                distanceAudited += turf.length(data.features[i], {units: i18next.t('common:unit-distance')});
            }
            var totalDistanceAuditedElement = document.getElementById("td-total-distance-audited")
            if (totalDistanceAuditedElement != null){
                totalDistanceAuditedElement.innerHTML = distanceAudited.toPrecision(2) + " " +
                    i18next.t("common:unit-abbreviation-distance-user-dashboard");
            }
            // Get total reward if a turker
            if (role === 'Turker') {
                $.ajax({
                    async: true,
                    url: '/rewardEarned',
                    type: 'get',
                    success: function(rewardData) {
                        document.getElementById("td-total-reward-earned").innerHTML = "$" +
                            rewardData.reward_earned.toFixed(2);
                    },
                    error: function (xhr, ajaxOptions, thrownError) {
                        console.log(thrownError);
                    }
                })
            }

            completedInitializingAuditedStreets = true;
            handleInitializationComplete(map);
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
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
        }

        $.getJSON("/userapi/labels", function (data) {
            _data.labels = data;
            // Count a number of each label type
            var labelCounter = {
                "CurbRamp": 0,
                "NoCurbRamp": 0,
                "Obstacle": 0,
                "SurfaceProblem": 0,
                "NoSidewalk": 0
            };

            for (var i = data.features.length - 1; i >= 0; i--) {
                labelCounter[data.features[i].properties.label_type] += 1;
            }
            document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
            document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
            document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
            document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];
            document.getElementById("td-number-of-no-sidewalks").innerHTML = labelCounter["NoSidewalk"];

            document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
            document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
            document.getElementById("map-legend-no-sidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "'></svg>";
            document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='rgba(128, 128, 128, 1.0)' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

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

            completedInitializingSubmittedLabels = true;
            handleInitializationComplete(map);
        });
    }


    $.getJSON('/adminapi/neighborhoodCompletionRate', function (neighborhoodCompletionData) {
        initializeNeighborhoodPolygons(map, neighborhoodCompletionData);
        initializeAuditedStreets(map);
        initializeSubmittedLabels(map);
    });

    self.data = _data;
    return self;
}
