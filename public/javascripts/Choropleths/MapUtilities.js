/**
 * Handles the toggling of layers on a map/choropleth according to the slider/checkbox.
 */
function toggleLabelLayer(label, checkboxId, sliderId, map, mapData) {
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
 * @param map The Mapbox map object.
 * @param mapData
 */
function filterLabelLayers(checkboxId, map, mapData) {
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

/**
 * Handles filtering of streets based on audit status and the legend checkboxes.
 * @param map
 */
function filterStreetLayer(map) {
    const includeAudited = document.getElementById('auditedstreet').checked;
    const includeUnaudited = document.getElementById('unauditedstreet').checked;
    if (includeAudited && includeUnaudited) {
        map.setLayoutProperty('streets', 'visibility', 'visible');
        map.setFilter('streets', null);
    } else if (includeAudited) {
        map.setLayoutProperty('streets', 'visibility', 'visible');
        map.setFilter('streets', ['==', 'audited', true]);
    } else if (includeUnaudited) {
        map.setLayoutProperty('streets', 'visibility', 'visible');
        map.setFilter('streets', ['==', 'audited', false]);
    } else {
        map.setLayoutProperty('streets', 'visibility', 'none');
    }
}

// Functionality for the legend's minimize button.
function toggleLegend() {
    $('#legend-table').slideToggle(0);
    $('#map-legend-minimize-button').text(function(_, value) { return value === '-' ? '+' : '-'});
}

// Searches for a region id in the query string. If you find one, focus on that region.
function setRegionFocus(map) {
    let regionId = util.getURLParameter('regionId');
    // TODO remove the setTimeout once we have everything working correctly.
    setTimeout(function() {
        if (regionId && map.getLayer('neighborhood-polygons')) {
            const region = map.queryRenderedFeatures({ layers: ['neighborhood-polygons'] }).filter(f => f.id == regionId)[0];
            if (region) {
                map.setCenter(turf.center(region).geometry.coordinates);
                map.zoomTo(14);
            }
        }
    }, 250);
}
