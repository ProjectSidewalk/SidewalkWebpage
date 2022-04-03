/**
 * Handles the toggling of layers on a map/choropleth according to the slider/checkbox.
 */
function toggleLayers(label, checkboxId, sliderId, allLayers) {
    if (document.getElementById(checkboxId).checked) {
        // For label types that don't have severity, show all labels.
        if (sliderId === undefined) {
            for (let i = 0; i < allLayers[label].length; i++) {
                allLayers[label][i].setFilter(function() { return true; });
            }
        }
        // Only show labels with severity in range of sliders. This works for null severity b/c null >= 0 === true.
        for (let i = 0; i < allLayers[label].length; i++) {
            allLayers[label][i].setFilter( function(feature) {
                return feature.properties.severity >= $(sliderId).slider('option', 'values')[0] &&
                    feature.properties.severity <= $(sliderId).slider('option', 'values')[1];
            })
        }
    } else {
        // Box is unchecked, remove all labels of that type.
        for (let i = 0; i < allLayers[label].length; i++) {
            allLayers[label][i].setFilter(function() { return false; });
        }
    }
}

function toggleAuditedStreetLayer(map, auditedStreetLayer) {
    if (document.getElementById('auditedstreet').checked) {
        map.addLayer(auditedStreetLayer);
    } else {
        map.removeLayer(auditedStreetLayer);
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
            if ('feature' in layers[i] && 'properties' in layers[i].feature && regionId === layers[i].feature.properties.region_id) {
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
