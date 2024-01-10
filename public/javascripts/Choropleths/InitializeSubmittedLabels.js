/**
 * Initializes labels onto map/choropleth, returns information about label layers on map.
 * @param map Map that labels are rendered onto.
 * @param params Object that include properties that can change the process of label rendering.
 * @param params.auditedStreetColor {string} color to use for audited streets on the map.
 * @param params.unauditedStreetColor {string} optional color to use for unaudited streets on the map.
 * @param params.includeLabelCounts {boolean} whether to include label counts for each type in the legend.
 * @param params.labelPopup {boolean} whether to include a validation popup on labels on the map.
 * @param params.differentiateExpiredLabels {boolean} whether to color the labels.
 * @param adminGSVLabelView Allows on click label popup GSV functionality.
 * @param mapData Object that stores the layers of the map.
 * @param labelData Data about submitted labels.
 */
function InitializeSubmittedLabels(map, params, adminGSVLabelView, mapData, labelData) {
    let colorMapping = util.misc.getLabelColors();
    let hasUnauditedStreets = params.unauditedStreetColor != null;

    // Set icons in the legend.
    document.getElementById('map-legend-curb-ramp').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.CurbRamp.fillStyle + "'></svg>";
    document.getElementById('map-legend-no-curb-ramp').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.NoCurbRamp.fillStyle + "'></svg>";
    document.getElementById('map-legend-obstacle').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.Obstacle.fillStyle + "'></svg>";
    document.getElementById('map-legend-surface-problem').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.SurfaceProblem.fillStyle + "'></svg>";
    document.getElementById('map-legend-no-sidewalk').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.NoSidewalk.fillStyle + "' stroke='" + colorMapping.NoSidewalk.strokeStyle + "'></svg>";
    document.getElementById('map-legend-crosswalk').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.Crosswalk.fillStyle + "'></svg>";
    document.getElementById('map-legend-signal').innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping.Signal.fillStyle + "'></svg>";
    document.getElementById('map-legend-audited-street').innerHTML = "<svg width='20' height='20'><path stroke='" + params.auditedStreetColor + "' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";
    if (hasUnauditedStreets) {
        document.getElementById('map-legend-unaudited-street').innerHTML = "<svg width='20' height='20'><path stroke='" + params.unauditedStreetColor + "' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";
    }

    // Separate labels into an array for each label type and severity.
    let sortedLabels = {};
    for (let i = 0; i < labelData.features.length; i++) {
        let labelType = labelData.features[i].properties.label_type;
        let severity = labelData.features[i].properties.severity;
        sortedLabels[labelType] = sortedLabels[labelType] || {};
        if (labelType === 'Occlusion' || labelType === 'Signal' || !severity) { // No severity level.
            mapData.sortedLabels[labelType][0].push(labelData.features[i]);
        } else {
            mapData.sortedLabels[labelType][severity].push(labelData.features[i]);
        }
    }
    Object.keys(mapData.sortedLabels).forEach(function (key) {
        for (let i = 0; i < mapData.sortedLabels[key].length; i++) {
            mapData.layerNames[key][i] = createLayer({
                'type': 'FeatureCollection',
                'features': mapData.sortedLabels[key][i]
            }, key, i);
        }
    });

    if (params.includeLabelCounts) {
        // Count the number of each label type and fill in the legend with those counts.
        document.getElementById('td-number-of-curb-ramps').innerHTML =
            mapData.sortedLabels['CurbRamp'].map(l => l.length).reduce((acc, len) => acc + len, 0);
        document.getElementById('td-number-of-missing-curb-ramps').innerHTML =
            mapData.sortedLabels['NoCurbRamp'].map(l => l.length).reduce((acc, len) => acc + len, 0);
        document.getElementById('td-number-of-obstacles').innerHTML =
            mapData.sortedLabels['Obstacle'].map(l => l.length).reduce((acc, len) => acc + len, 0);
        document.getElementById('td-number-of-surface-problems').innerHTML =
            mapData.sortedLabels['SurfaceProblem'].map(l => l.length).reduce((acc, len) => acc + len, 0);
        document.getElementById('td-number-of-no-sidewalks').innerHTML =
            mapData.sortedLabels['NoSidewalk'].map(l => l.length).reduce((acc, len) => acc + len, 0);
        document.getElementById('td-number-of-crosswalks').innerHTML =
            mapData.sortedLabels['Crosswalk'].map(l => l.length).reduce((acc, len) => acc + len, 0);
        document.getElementById('td-number-of-signals').innerHTML =
            mapData.sortedLabels['Signal'].map(l => l.length).reduce((acc, len) => acc + len, 0);
    } else {
        // For LabelMap.
        document.getElementById('map-legend-other').innerHTML =
            "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle +
            "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
        document.getElementById('map-legend-occlusion').innerHTML =
            "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle +
            "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";

        // Set up the initial set of filters.
        filterLayers('incorrect', map, mapData);
    }

    // Set up the label hover and popup functionality.
    if (params.labelPopup) {
        map.on('click', Object.values(mapData.layerNames).flat(), (event) => {
            adminGSVLabelView.showLabel(event.features[0].properties.label_id);
        });

        let hoveredLab = null;
        map.on('mousemove', Object.values(mapData.layerNames).flat(), (event) => {
            let currLab = event.features[0];
            if (hoveredLab && hoveredLab.properties.label_id !== currLab.properties.label_id) {
                map.setFeatureState({ source: hoveredLab.layer.id, id: hoveredLab.properties.label_id }, { hover: false });
                map.setFeatureState({ source: currLab.layer.id, id: currLab.properties.label_id }, { hover: true });
                hoveredLab = currLab;
            } else if (!hoveredLab) {
                map.setFeatureState({ source: currLab.layer.id, id: currLab.properties.label_id }, { hover: true });
                hoveredLab = currLab;
                document.querySelector('.mapboxgl-canvas').style.cursor = 'pointer';
            }
        });
        map.on('mouseleave', Object.values(mapData.layerNames).flat(), (event) => {
            map.setFeatureState({ source: hoveredLab.layer.id, id: hoveredLab.properties.label_id }, { hover: false });
            hoveredLab = null;
            document.querySelector('.mapboxgl-canvas').style.cursor = '';
        });
    }

    function createLayer(data, labelType, severity) {
        let layerName = `labels-${labelType}-${severity}`;
        map.addSource(layerName, {
            type: 'geojson',
            data: data,
            promoteId: 'label_id'
        });
        // TODO can we improve performance by not using data-driven styling on LabelMap since they are in their own layers?
        map.addLayer({
            id: layerName,
            type: 'circle',
            source: layerName,
            layout: { visibility: 'visible' },
            paint: {
                'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 15, 5 ],
                'circle-opacity': 0.5,
                'circle-stroke-opacity': 0.5,
                'circle-stroke-width': 1,
                'circle-color': [
                    'case',
                    ['all',
                        ['==', params.differentiateExpiredLabels ? params.differentiateExpiredLabels : false, true],
                        ['==', ['get', 'expired'], true]
                    ],
                    'lightgrey',
                    colorMapping[labelType].fillStyle
                ],
                'circle-stroke-color': [
                    'case',
                    ['all',
                        ['==', params.differentiateExpiredLabels ? params.differentiateExpiredLabels : false, true],
                        ['==', ['get', 'expired'], true],
                    ],
                    colorMapping[labelType].fillStyle,
                    colorMapping[labelType].strokeStyle
                ]
            }
        });
        return layerName;
    }
    return mapData;
}
