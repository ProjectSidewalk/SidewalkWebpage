/**
 * Handles the toggling of layers on a map/choropleth according to the slider/checkbox.
 */
function toggleLayers(label, checkboxId, sliderId, map, allLayers) {
    if (document.getElementById(checkboxId).checked) {
        if(checkboxId == "occlusion"){
            for (var i = 0; i < allLayers[label].length; i++) {
                if (!map.hasLayer(allLayers[label][i])) {
                    map.addLayer(allLayers[label][i]);
                }
            }
        }
        else {
            for (var i = 0; i < allLayers[label].length; i++) {
                if (!map.hasLayer(allLayers[label][i])
                    && ($(sliderId).slider("option", "values")[0] <= i &&
                        $(sliderId).slider("option", "values")[1] >= i )) {
                    map.addLayer(allLayers[label][i]);
                } else if ($(sliderId).slider("option", "values")[0] > i
                    || $(sliderId).slider("option", "values")[1] < i) {
                    map.removeLayer(allLayers[label][i]);
                }
            }
        }
    } else {
        for (var i = 0; i < allLayers[label].length; i++) {
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
    $("#legend-table").slideToggle(0);
    $("#map-legend-minimize-button").text(function(_, value) { return value === '-' ? '+' : '-'});
}
