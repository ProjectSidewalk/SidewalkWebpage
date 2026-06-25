/**
 * Toggles the visibility of a label type layer on the map.
 * @param {string} labelType The label type key (e.g., 'CurbRamp').
 * @param {boolean} visible Whether the layer should be visible.
 * @param {object} map The Mapbox map object.
 * @param {object} mapData The layer tracker from CreateMapLayerTracker.
 */
function toggleLabelLayer(labelType, visible, map, mapData) {
    const layerName = mapData.layerNames[labelType];
    if (layerName && map.getLayer(layerName)) {
        map.setLayoutProperty(layerName, 'visibility', visible ? 'visible' : 'none');
    }
}

/**
 * Builds and applies Mapbox filter expressions to all label layers based on the current filter state in mapData.
 * @param {HTMLElement|null} checkbox The validation checkbox that was clicked, or null if the update was triggered by
 *      something else (e.g., a severity toggle).
 * @param {object} map The Mapbox map object.
 * @param {object} mapData The layer tracker containing current filter state.
 * @param {boolean} highQualityFilter Whether to apply the high-quality user filter.
 */
function filterLabelLayers(checkbox, map, mapData, highQualityFilter) {
    if (checkbox && typeof checkbox === 'object') {
        mapData[checkbox.id] = checkbox.checked;
    }

    // Build severity sub-filter: show labels whose severity matches any enabled toggle.
    const sevFilter = ['any'];
    for (const [sev, enabled] of Object.entries(mapData.severities)) {
        if (enabled) {
            if (Number(sev) === 0) {
                sevFilter.push(['==', ['get', 'severity'], null]);
            } else {
                sevFilter.push(['==', ['get', 'severity'], Number(sev)]);
            }
        }
    }
    // If no severities are selected, create a filter that matches nothing.
    if (sevFilter.length === 1) sevFilter.push(false);

    // Build validation sub-filter.
    const valFilter = [
        'any',
        ['all', mapData.correct, ['==', ['get', 'correct'], true]],
        ['all', mapData.incorrect, ['==', ['get', 'correct'], false]],
        [
            'all', mapData.unsure,
            ['==', ['get', 'correct'], null],
            ['==', ['get', 'has_validations'], true]
        ],
        [
            'all', mapData.unvalidated,
            ['==', ['get', 'correct'], null],
            ['==', ['get', 'has_validations'], false]
        ]
    ];

    // Build the base filter combining severity, validation, and optionally high-quality user filters.
    const baseFilter = ['all', sevFilter, valFilter];
    if (highQualityFilter) {
        baseFilter.push(['any', mapData.lowQualityUsers, ['==', ['get', 'high_quality_user'], true]]);
    }
    // Admin-only: restrict to labels with no Administrator/Owner validation when the toggle is on (#4243).
    if (mapData.notAdminValidated) {
        baseFilter.push(['==', ['get', 'has_admin_validation'], false]);
    }

    // Apply per-layer, appending a tag sub-filter when that label type has active tags.
    for (const [labelType, layerName] of Object.entries(mapData.layerNames)) {
        if (!map.getLayer(layerName)) continue;

        const selectedTags = mapData.selectedTags[labelType];
        if (selectedTags && selectedTags.size > 0) {
            const tagFilter = ['any', ...Array.from(selectedTags).map(t => ['in', t, ['get', 'tags']])];
            map.setFilter(layerName, [...baseFilter, tagFilter]);
        } else {
            map.setFilter(layerName, baseFilter);
        }
    }
}

/**
 * Filters the street layer based on the audited/unaudited street checkboxes.
 * @param {object} map The Mapbox map object.
 */
function filterStreetLayer(map) {
    const includeAudited = document.getElementById('audited-street').checked;
    const includeUnaudited = document.getElementById('unaudited-street').checked;
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

/**
 * Creates and returns the mapData object that tracks filter state and layer references.
 * @returns {object} The initialized map data tracker.
 */
function CreateMapLayerTracker() {
    const mapData = {};

    // Validation filter state (matches default checked checkboxes in the sidebar).
    mapData.correct = true;
    mapData.incorrect = false;
    mapData.unsure = true;
    mapData.unvalidated = true;
    mapData.lowQualityUsers = false;
    // Admin-only filter (#4243): when true, restrict to labels not yet validated by an Administrator/Owner. Defaults
    // to off so the shared filter logic is a no-op on the public LabelMap, where the control isn't rendered.
    mapData.notAdminValidated = false;

    // Severity filter state (all enabled by default).
    mapData.severities = { 0: true, 1: true, 2: true, 3: true };

    // Tag filter state: maps label type -> Set of active tag strings. Empty set = no tag filter.
    mapData.selectedTags = {};

    // One flat array of features and one layer name string per label type.
    mapData.sortedLabels = {};
    mapData.layerNames = {};
    const labelTypes = [
        'CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Occlusion', 'NoSidewalk', 'Crosswalk', 'Signal', 'Other'
    ];
    for (const labelType of labelTypes) {
        mapData.sortedLabels[labelType] = [];
        mapData.layerNames[labelType] = '';
        mapData.selectedTags[labelType] = new Set();
    }
    return mapData;
}

/**
 * Searches for a region id in the query string. If found, centers the map on that region.
 * @param {object} map The Mapbox map object.
 */
function setRegionFocus(map) {
    const regionId = util.getURLParameter('regionId');
    // Small timeout to allow map to load before focusing on region.
    setTimeout(function() {
        if (regionId && map.getLayer('neighborhood-polygons')) {
            const region = map.queryRenderedFeatures({ layers: ['neighborhood-polygons'] })
                .filter(f => f.id == regionId)[0];
            if (region) {
                map.setCenter(turf.center(region).geometry.coordinates);
                map.zoomTo(13);
            }
        }
    }, 250);
}
