/**
 * Initializes labels onto map/choropleth, returns information about label layers on map.
 * @param map Map that labels are rendered onto.
 * @param params Object that include properties that can change the process of label rendering.
 * @param adminGSVLabelView Allows on click label popup GSV functionality.
 * @param mapData Object that stores the layers of the map.
 * @param labelData Data about submitted labels.
 */
function InitializeSubmittedLabels(map, params, adminGSVLabelView, mapData, labelData) {
    var colorMapping = util.misc.getLabelColors();
    var geojsonMarkerOptions = {
            radius: 5,
            fillColor: "#ff7800",
            color: "#ffffff",
            weight: 1,
            opacity: 0.5,
            fillOpacity: 0.5,
            "stroke-width": 1
        };

    var auditedStreetColor = params.streetColor;
    // Count a number of each label type.
    var labelCounter = {
        "CurbRamp": 0,
        "NoCurbRamp": 0,
        "Obstacle": 0,
        "SurfaceProblem": 0,
        "NoSidewalk": 0
    };
    for (var i = labelData.features.length - 1; i >= 0; i--) {
        labelCounter[labelData.features[i].properties.label_type] += 1;
    }
    document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
    document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
    document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
    document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
    document.getElementById("map-legend-no-sidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "' stroke='" + colorMapping['NoSidewalk'].strokeStyle + "'></svg>";
    document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='" + auditedStreetColor + "' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";
    if (params.includeLabelCounts) {
        document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
        document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
        document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
        document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];
        document.getElementById("td-number-of-no-sidewalks").innerHTML = labelCounter["NoSidewalk"];
        createLayer(labelData).addTo(map);
    } else {    // When loading label map.
        document.getElementById("map-legend-other").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
        document.getElementById("map-legend-occlusion").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";
        // Separate labels into an array for each label type and severity.
        for (var i = 0; i < labelData.features.length; i++) {
            var labelType = labelData.features[i].properties.label_type;
            if (labelData.features[i].properties.severity === 1) {
                mapData.allLayers[labelType][1].push(labelData.features[i]);
            } else if (labelData.features[i].properties.severity === 2) {
                mapData.allLayers[labelType][2].push(labelData.features[i]);
            } else if (labelData.features[i].properties.severity === 3) {
                mapData.allLayers[labelType][3].push(labelData.features[i]);
            } else if (labelData.features[i].properties.severity === 4) {
                mapData.allLayers[labelType][4].push(labelData.features[i]);
            } else if (labelData.features[i].properties.severity === 5) {
                mapData.allLayers[labelType][5].push(labelData.features[i]);
            } else { // No severity level
                mapData.allLayers[labelType][0].push(labelData.features[i]);
            }
        }
        Object.keys(mapData.allLayers).forEach(function (key) {
            for (var i = 0; i < mapData.allLayers[key].length; i++) {
                mapData.allLayers[key][i] = createLayer({
                    "type": "FeatureCollection",
                    "features": mapData.allLayers[key][i]
                });
                mapData.allLayers[key][i].addTo(map);
            }
        })
    }
    
    function onEachLabelFeature(feature, layer) {
        if (params.labelPopup) {
            layer.on('click', function () {
                adminGSVLabelView.showLabel(feature.properties.label_id);
            });
            layer.on({
                'mouseover': function () {
                    layer.setRadius(15);
                },
                'mouseout': function () {
                    layer.setRadius(5);
                }
            })
        // When on user dash.
        } else { 
            layer.bindPopup(feature.properties.type);
        }
    }

    function createLayer(data) {
        return L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                if (params.includeLabelColor) {
                    style.color = colorMapping[feature.properties.label_type].strokeStyle;
                }
                return L.circleMarker(latlng, style);
            },
            onEachFeature: onEachLabelFeature
        })
    }
    return mapData;
}
