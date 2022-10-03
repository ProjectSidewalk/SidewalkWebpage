/**
 * Handles the toggling of layers on a map/choropleth according to the slider/checkbox.
 */
function toggleLayers(label, checkboxId, sliderId, map, mapData) {
    if (document.getElementById(checkboxId).checked) {
        // For label types that don't have severity, show all labels.
        if (sliderId === undefined) {
            for (let i = 0; i < mapData.labelLayers[label].length; i++) {
                if (!map.hasLayer(mapData.labelLayers[label][i])) {
                    map.addLayer(mapData.labelLayers[label][i])
                }
            }
        }
        // Only show labels with severity in range of sliders. This works for null severity b/c null >= 0 === true.
        let lowRange = $(sliderId).slider('option', 'values')[0];
        let highRange = $(sliderId).slider('option', 'values')[1];
        for (let i = 0; i < mapData.labelLayers[label].length; i++) {
            if (lowRange <= i && highRange >= i && !map.hasLayer(mapData.labelLayers[label][i])) {
                map.addLayer(mapData.labelLayers[label][i])
            } else if ((lowRange > i || highRange < i) && map.hasLayer(mapData.labelLayers[label][i])) {
                map.removeLayer(mapData.labelLayers[label][i]);
            }
        }
    } else {
        // Box is unchecked, remove all labels of that type.
        for (let i = 0; i < mapData.labelLayers[label].length; i++) {
            if (map.hasLayer(mapData.labelLayers[label][i])) {
                map.removeLayer(mapData.labelLayers[label][i]);
            }
        }
    }
}

/**
 * Handles the filtering of labels based on validation status.
 * @param checkboxId
 * @param mapData
 */
function filterLayers(checkboxId, mapData) {
    if (checkboxId) mapData[checkboxId] = document.getElementById(checkboxId).checked;
    Object.keys(mapData.labelLayers).forEach(function (key) {
        for (let i = 0; i < mapData.labelLayers[key].length; i++) {
            mapData.labelLayers[key][i].setFilter(function(feature) {
                return (mapData.lowQualityUsers || feature.properties.high_quality_user) &&
                    (
                        (mapData.correct && feature.properties.correct) ||
                        (mapData.incorrect && feature.properties.correct === false) ||
                        (mapData.unvalidated && feature.properties.correct === null)
                    );
            });
        }
    });
}

function toggleAuditedStreetLayer(map, auditedStreetLayer) {
    if (document.getElementById('auditedstreet').checked) {
        map.addLayer(auditedStreetLayer);
    } else {
        map.removeLayer(auditedStreetLayer);
    }
}

function toggleUnauditedStreetLayer(map, unauditedStreetLayer) {
    if (document.getElementById('unauditedstreet').checked) {
        map.addLayer(unauditedStreetLayer);
    } else {
        map.removeLayer(unauditedStreetLayer);
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
