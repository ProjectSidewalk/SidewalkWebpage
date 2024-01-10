/**
 * Handles the toggling of layers on a map/choropleth according to the slider/checkbox.
 */
function toggleLayers(label, checkboxId, sliderId, map, mapData) {
    if (document.getElementById(checkboxId).checked) {
        // For label types that don't have severity, show all labels.
        if (sliderId === undefined) {
            for (let i = 0; i < mapData.layerNames[label].length; i++) {
                if (map.getLayoutProperty(mapData.layerNames[label][i], 'visibility') !== 'visible') {
                    map.setLayoutProperty(mapData.layerNames[label][i], 'visibility', 'visible');
                }
            }
        }
        // Only show labels with severity in range of sliders. This works for null severity b/c null >= 0 === true.
        let lowRange = $(sliderId).slider('option', 'values')[0];
        let highRange = $(sliderId).slider('option', 'values')[1];
        for (let i = 0; i < mapData.layerNames[label].length; i++) {
            if (lowRange <= i && highRange >= i && map.getLayoutProperty(mapData.layerNames[label][i], 'visibility') !== 'visible') {
                map.setLayoutProperty(mapData.layerNames[label][i], 'visibility', 'visible');
            } else if ((lowRange > i || highRange < i) && map.getLayoutProperty(mapData.layerNames[label][i], 'visibility') === 'visible') {
                map.setLayoutProperty(mapData.layerNames[label][i], 'visibility', 'none');
            }
        }
    } else {
        // Box is unchecked, remove all labels of that type.
        for (let i = 0; i < mapData.layerNames[label].length; i++) {
            if (map.getLayoutProperty(mapData.layerNames[label][i], 'visibility') === 'visible') {
                map.setLayoutProperty(mapData.layerNames[label][i], 'visibility', 'none');
            }
        }
    }
}

/**
 * Handles the filtering of labels based on validation status.
 * @param checkboxId
 * @param mapData
 */
function filterLayers(checkboxId, map, mapData) {
    if (checkboxId) mapData[checkboxId] = document.getElementById(checkboxId).checked;
    Object.keys(mapData.layerNames).forEach(function (key) {
        for (let i = 0; i < mapData.layerNames[key].length; i++) {
            map.setFilter(mapData.layerNames[key][i], [
                'all',
                ['any', mapData.lowQualityUsers, ['==', ['get', 'high_quality_user'], true]], // TODO can I get rid of the ==? I use this in other places too.
                [
                    'any',
                    ['all', mapData.correct, ['==', ['get', 'correct'], true]],
                    ['all', mapData.incorrect, ['==', ['get', 'correct'], false]],
                    ['all', mapData.notsure, ['==', ['get', 'correct'], null], ['==', ['get', 'has_validations'], true]],
                    ['all', mapData.unvalidated, ['==', ['get', 'correct'], null], ['==', ['get', 'has_validations'], false]]
                ]
            ]);
        }
    });
}

function toggleAuditedStreetLayer(map) {
    if (document.getElementById('auditedstreet').checked) {
        map.setLayoutProperty('streets-audited', 'visibility', 'visible');
    } else {
        map.setLayoutProperty('streets-audited', 'visibility', 'none');
    }
}

function toggleUnauditedStreetLayer(map, unauditedStreetLayer) {
    if (document.getElementById('unauditedstreet').checked) {
        map.setLayoutProperty('streets-unaudited', 'visibility', 'visible');
    } else {
        map.setLayoutProperty('streets-unaudited', 'visibility', 'none');
    }
}

// Functionality for the legend's minimize button.
function toggleLegend() {
    $('#legend-table').slideToggle(0);
    $('#map-legend-minimize-button').text(function(_, value) { return value === '-' ? '+' : '-'});
}

// Searches for a region id in the query string. If you find one, focus on that region.
function setRegionFocus(map, layers) {
    let regionId = util.getURLParameter('regionId')
    if (regionId && layers) {
        let len = layers.length;
        for (let i = 0; i < len; i++) {
            if ('feature' in layers[i] && 'properties' in layers[i].feature && regionId == layers[i].feature.properties.region_id) {
                let center = turf.center(layers[i].feature);
                let coordinates = center.geometry.coordinates;
                let latlng = L.latLng(coordinates[1], coordinates[0]);
                let zoom = map.getZoom();
                zoom = zoom > 14 ? zoom : 14;

                map.setView(latlng, zoom, {animate: true});
                layers[i].setStyle({color: 'red', fillColor: 'red'});
                break;
            }
        }
    }
}
