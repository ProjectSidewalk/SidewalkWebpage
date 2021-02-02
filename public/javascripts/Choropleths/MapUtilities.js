/**
 * Handles the toggling of layers on a map/choropleth according to the slider/checkbox.
 */
function toggleLayers(label, checkboxId, sliderId, map, allLayers) {
    if (document.getElementById(checkboxId).checked) {
        if(checkboxId === 'occlusion'){
            for (let i = 0; i < allLayers[label].length; i++) {
                if (!map.hasLayer(allLayers[label][i])) {
                    map.addLayer(allLayers[label][i]);
                }
            }
        }
        else {
            for (let i = 0; i < allLayers[label].length; i++) {
                if (!map.hasLayer(allLayers[label][i])
                    && ($(sliderId).slider('option', 'values')[0] <= i &&
                        $(sliderId).slider('option', 'values')[1] >= i )) {
                    map.addLayer(allLayers[label][i]);
                } else if ($(sliderId).slider('option', 'values')[0] > i
                    || $(sliderId).slider('option', 'values')[1] < i) {
                    map.removeLayer(allLayers[label][i]);
                }
            }
        }
    } else {
        for (let i = 0; i < allLayers[label].length; i++) {
            if (map.hasLayer(allLayers[label][i])) {
                map.removeLayer(allLayers[label][i]);
            }
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
