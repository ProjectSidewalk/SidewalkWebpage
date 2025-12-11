/**
 * Adds labels to the map and returns a promise.
 *
 * @param map Map on which the streets are rendered.
 * @param {Object} map The Mapbox map object.
 * @param {Object} labelData - GeoJSON object containing labels to draw on the map.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {boolean} [params.includeLabelCounts=false] - Whether to include label counts for each type in the legend.
 * @param {boolean} [params.differentiateExpiredLabels=false] - Whether to color expired labels differently.
 * @param {Object} [params.popupLabelViewer] - Shows a validation popup on labels on the map.
 * @returns {Promise} Promise that resolves with all layer names when the labels have been added to the map.
 */
function AddLabelsToMap(map, labelData, params) {
    const colorMapping = util.misc.getLabelColors();
    let mapData = CreateMapLayerTracker();

    // Separate labels into an array for each label type and severity.
    let sortedLabels = {};
    for (let i = 0; i < labelData.features.length; i++) {
        let labelType = labelData.features[i].properties.label_type;
        let severity = labelData.features[i].properties.severity;
        sortedLabels[labelType] = sortedLabels[labelType] || {};
        if (['NoSidewalk', 'Signal', 'Occlusion'].includes(labelType) || !severity) { // No severity level.
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
        // Set up the initial set of filters.
        filterLabelLayers('incorrect', map, mapData, true);
    }

    // Set up the label hover and popup functionality.
    if (params.popupLabelViewer) {
        map.on('click', Object.values(mapData.layerNames).flat(), async (event) => {
            await params.popupLabelViewer.showLabel(event.features[0].properties.label_id);
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

    // Check if all the label layers have been added to the map.
    function allLabelLayersLoaded() {
        let allLoaded = true;
        Object.keys(mapData.sortedLabels).forEach(function (key) {
            for (let i = 0; i < mapData.sortedLabels[key].length; i++) {
                if (map.getLayer(mapData.layerNames[key][i]) === undefined) {
                    allLoaded = false;
                    break;
                }
            }
        });
        return allLoaded;
    }

    // Return promise that is resolved once all the layers have been added to the map.
    return new Promise((resolve, reject) => {
        if (allLabelLayersLoaded()) {
            resolve(mapData);
        } else {
            map.on('sourcedataloading', function(e) {
                if (allLabelLayersLoaded()) {
                    resolve(mapData);
                }
            });
        }
    });
}
