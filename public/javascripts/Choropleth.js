function Choropleth(_, $, turf) {
    var neighborhoodPolygonLayer;

// Construct a bounding box for these maps that the user cannot move out of
// https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262);
    var northEast = L.latLng(39.060, -76.830);
    var bounds = L.latLngBounds(southWest, northEast);

// var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });

// a grayscale tileLayer for the choropleth
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var choropleth = L.mapbox.map('choropleth', "kotarohara.8e0c6890", {
        // set that bounding box as maxBounds to restrict moving the map
        // see full maxBounds documentation:
        // http://leafletjs.com/reference.html#map-maxbounds
        maxBounds: bounds,
        maxZoom: 19,
        minZoom: 9,
        legendControl: {
            position: 'bottomleft'
        }
    })
        .fitBounds(bounds)
        .setView([38.892, -77.038], 12);
    choropleth.scrollWheelZoom.disable();

    L.mapbox.styleLayer('mapbox://styles/mapbox/light-v9').addTo(choropleth);


    /**
     * Takes a completion percentage, bins it, and returns the appropriate color for a choropleth.
     *
     * @param p {float} represents a completion percentage, between 0 and 100
     * @returns {string} color in hex
     */

    function getColor(p) {
        return p > 90 ? '#08306b' :
            p > 80 ? '#08519c' :
                p > 70 ? '#08719c' :
                    p > 60 ? '#2171b5' :
                        p > 50 ? '#4292c6' :
                            p > 40 ? '#6baed6' :
                                p > 30 ? '#9ecae1' :
                                    p > 20 ? '#c6dbef' :
                                        p > 10 ? '#deebf7' :
                                            '#f7fbff';
    }

    /**
     * render the neighborhood polygons, colored by completion percentage
     */
    function initializeChoroplethNeighborhoodPolygons(map, rates) {
        var neighborhoodPolygonStyle = { // default bright red, used to check if any regions are missing data
                color: '#888',
                weight: 1,
                opacity: 0.25,
                fillColor: "#f00",
                fillOpacity: 1.0
            },
            layers = [],
            currentLayer;

        // finds the matching neighborhood's completion percentage, and uses it to determine the fill color
        function style(feature) {
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {

                    return {
                        color: '#888',
                        weight: 1,
                        opacity: 0.25,
                        fillColor: getColor(100.0 * rates[i].rate),
                        fillOpacity: 0.25 + (0.5 * rates[i].rate)
                    }
                }
            }
            return neighborhoodPolygonStyle; // default case (shouldn't happen, will be bright red)
        }

        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id,
                regionName = feature.properties.region_name,
                compRate = -1.0,
                milesLeft = -1.0,
                url = "/audit/region/" + regionId,
                popupContent = "???";
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    compRate = Math.round(100.0 * rates[i].rate);
                    milesLeft = Math.round(0.000621371 * (rates[i].total_distance_m - rates[i].completed_distance_m));
                    if (compRate === 100) {
                        popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to find accessibility issues in this neighborhood yourself!";
                    }
                    else if (milesLeft === 0) {
                        popupContent = "<strong>" + regionName + "</strong>: " + compRate +
                            "\% Complete<br>Less than a mile left!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    else if (milesLeft === 1) {
                        var popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete<br>Only " +
                            milesLeft + " mile left!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    else {
                        var popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete<br>Only " +
                            milesLeft + " miles left!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    break;
                }
            }
            layer.bindPopup(popupContent);
            layers.push(layer);

            layer.on('mouseover', function (e) {
                this.setStyle({opacity: 1.0, weight: 3, color: "#000"});

            });
            layer.on('mouseout', function (e) {
                for (var i = layers.length - 1; i >= 0; i--) {
                    if (currentLayer !== layers[i])
                        layers[i].setStyle({opacity: 0.25, weight: 1});
                }
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

        // adds the neighborhood polygons to the map
        $.getJSON("/neighborhoods", function (data) {
            neighborhoodPolygonLayer = L.geoJson(data, {
                style: style,
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
        });

        $("#choropleth").on('click', '.region-selection-trigger', function () {
            var regionId = $(this).attr('regionId');
            var ratesEl = rates.find(function(x){
                return regionId == x.region_id;
            })
            var compRate = Math.round(100.0 * ratesEl.rate);
            var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
            var distanceLeft = "";
            if(compRate === 100){
                distanceLeft = "0";
            }
            else if(milesLeft === 0){
                distanceLeft = "<1";
            }
            else if(milesLeft === 1){
                distanceLeft = "1";
            }
            else{
                distanceLeft = ">1";
            }
            var url = "/userapi/selfAssign";
            var async = true;
            var data = "SelfAssign_Region"+regionId+"_"+distanceLeft+"MilesLeft";
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


    $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {
        // make a choropleth of neighborhood completion percentages
        initializeChoroplethNeighborhoodPolygons(choropleth, data);
        choropleth.legendControl.addLegend(document.getElementById('legend').innerHTML);
        setTimeout(function () {
            choropleth.invalidateSize(false);
        }, 1);
    });
}