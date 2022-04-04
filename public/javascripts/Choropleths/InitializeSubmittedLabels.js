/**
 * Initializes labels onto map/choropleth, returns information about label layers on map.
 * @param map Map that labels are rendered onto.
 * @param params Object that include properties that can change the process of label rendering.
 * @param params.streetColor {string} color to use for streets on the map.
 * @param params.includeLabelCounts {boolean} whether to include label counts for each type in the legend.
 * @param params.labelPopup {boolean} whether to include a validation popup on labels on the map.
 * @param params.includeLabelColor {boolean} whether to color the labels.
 * @param adminGSVLabelView Allows on click label popup GSV functionality.
 * @param mapData Object that stores the layers of the map.
 * @param labelData Data about submitted labels.
 */
function InitializeSubmittedLabels(map, params, adminGSVLabelView, mapData, labelData) {
    let colorMapping = util.misc.getLabelColors();
    let geojsonMarkerOptions = {
            radius: 5,
            fillColor: '#ff7800',
            color: '#ffffff',
            weight: 1,
            opacity: 0.5,
            fillOpacity: 0.5,
            'stroke-width': 1
        };

    let auditedStreetColor = params.streetColor;

    document.getElementById('map-legend-curb-ramp').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
    document.getElementById('map-legend-no-curb-ramp').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
    document.getElementById('map-legend-obstacle').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
    document.getElementById('map-legend-surface-problem').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
    document.getElementById('map-legend-no-sidewalk').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "' stroke='" + colorMapping['NoSidewalk'].strokeStyle + "'></svg>";
    document.getElementById('map-legend-crosswalk').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Crosswalk'].fillStyle + "'></svg>";
    document.getElementById('map-legend-audited-street').innerHTML = "<svg width='20' height='20'><path stroke='" + auditedStreetColor + "' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";
    if (params.includeLabelCounts) {
        // Count the number of each label type and fill in the legend with those counts.
        let labelCounter = {
            'CurbRamp': 0,
            'NoCurbRamp': 0,
            'Obstacle': 0,
            'SurfaceProblem': 0,
            'NoSidewalk': 0,
            'Crosswalk': 0,
            'Signal': 0
        };
        for (let i = labelData.features.length - 1; i >= 0; i--) {
            labelCounter[labelData.features[i].properties.label_type] += 1;
        }
        document.getElementById('td-number-of-curb-ramps').innerHTML = labelCounter['CurbRamp'];
        document.getElementById('td-number-of-missing-curb-ramps').innerHTML = labelCounter['NoCurbRamp'];
        document.getElementById('td-number-of-obstacles').innerHTML = labelCounter['Obstacle'];
        document.getElementById('td-number-of-surface-problems').innerHTML = labelCounter['SurfaceProblem'];
        document.getElementById('td-number-of-no-sidewalks').innerHTML = labelCounter['NoSidewalk'];
        document.getElementById('td-number-of-crosswalks').innerHTML = labelCounter['Crosswalk'];
        document.getElementById('td-number-of-signals').innerHTML = labelCounter['Signal'];
        createLayer(labelData).addTo(map);
    } else {    // When loading label map.
        document.getElementById('map-legend-other').innerHTML =
            "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle +
            "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
        document.getElementById('map-legend-occlusion').innerHTML =
            "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle +
            "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";

        // Separate labels into an array for each label type and severity.
        for (let i = 0; i < labelData.features.length; i++) {
            let labelType = labelData.features[i].properties.label_type;
            let severity = labelData.features[i].properties.severity;
            if (labelType === 'Occlusion' || labelType === 'Signal' || !severity) { // No severity level.
                mapData.labelLayers[labelType][0].push(labelData.features[i]);
            } else {
                mapData.labelLayers[labelType][severity].push(labelData.features[i]);
            }
        }
        Object.keys(mapData.labelLayers).forEach(function (key) {
            for (let i = 0; i < mapData.labelLayers[key].length; i++) {
                mapData.labelLayers[key][i] = createLayer({
                    'type': 'FeatureCollection',
                    'features': mapData.labelLayers[key][i]
                });
                mapData.labelLayers[key][i].addTo(map);
            }
        });

        // Set up the initial set of filters.
        filterLayers('incorrect', mapData);
    }
    
    function addLabelMarkerListeners(feature, marker) {
        if (params.labelPopup) {
            marker.on('click', function () {
                adminGSVLabelView.showLabel(feature.properties.label_id);
            });
            marker.on({
                'mouseover': function () {
                    marker.setRadius(15);
                },
                'mouseout': function () {
                    marker.setRadius(5);
                }
            });
        }
    }

    function createLayer(data) {
        return L.mapbox.featureLayer(data, {
            pointToLayer: function (feature, latlng) {
                let style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                if (params.includeLabelColor) {
                    if (feature.properties.expired) {
                        style.fillColor = 'lightgrey';
                        style.color = colorMapping[feature.properties.label_type].fillStyle;
                    } else {
                        style.color = colorMapping[feature.properties.label_type].strokeStyle;
                    }
                }
                var marker = L.circleMarker(latlng, style);
                addLabelMarkerListeners(feature, marker);
                return marker;
            }
        });
    }
    return mapData;
}
