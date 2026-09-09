/**
 * Fetches a label feed, rejecting with an error that says what actually went wrong.
 *
 * The feed is streamed from the database under a chunked 200 (#3932), so the status and headers are committed
 * before the rows are read. A mid-flight failure therefore arrives as a *truncated body under a success status* —
 * `response.ok` cannot see it, and the JSON parse is what throws. jQuery surfaces that as a bare "parsererror"
 * indistinguishable from a malformed payload, which is why this reports the two cases separately.
 *
 * @param {string|URL} url - The label feed endpoint.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Optional abort signal, so a superseded viewport fetch can be cancelled.
 * @returns {Promise<object>} The parsed GeoJSON FeatureCollection.
 */
async function fetchLabelFeed(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Label feed ${url} failed with HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch (e) {
    if (e.name === 'AbortError') throw e; // Cancellation isn't a feed failure; callers must tell them apart.
    throw new Error(`Label feed ${url} returned an unreadable body (truncated stream?): ${e.message}`, { cause: e });
  }
}

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
      ['==', ['get', 'has_validations'], true],
    ],
    [
      'all', mapData.unvalidated,
      ['==', ['get', 'correct'], null],
      ['==', ['get', 'has_validations'], false],
    ],
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

  // The label the popup is currently spotlighting bypasses every filter: a deep-linked or arrow-paged label must
  // stay visible even when the active filters (e.g. the default incorrect/low-quality exclusions) would hide it.
  const withSpotlight = (filter) => (mapData.spotlightLabelId
    ? ['any', filter, ['==', ['get', 'label_id'], mapData.spotlightLabelId]]
    : filter);

  // Apply per-layer, appending a tag sub-filter when that label type has active tags.
  for (const [labelType, layerName] of Object.entries(mapData.layerNames)) {
    if (!map.getLayer(layerName)) continue;

    const selectedTags = mapData.selectedTags[labelType];
    if (selectedTags && selectedTags.size > 0) {
      const tagFilter = ['any', ...Array.from(selectedTags).map((t) => ['in', t, ['get', 'tags']])];
      map.setFilter(layerName, withSpotlight([...baseFilter, tagFilter]));
    } else {
      map.setFilter(layerName, withSpotlight(baseFilter));
    }
  }
}

/**
 * The Mapbox expression matching each of a street's three audit states (#4384): audited (has an audit on current
 * imagery), outdated (audited before, but newer imagery exists), or unaudited (neither property set). Held in one
 * place because both the layer's filter and its width read them, and a street matching two would be a contradiction.
 */
const STREET_STATE_FILTERS = {
  audited: ['==', ['get', 'audited'], true],
  outdated: ['==', ['get', 'outdated'], true],
  unaudited: ['all', ['!=', ['get', 'audited'], true], ['!=', ['get', 'outdated'], true]],
};

/**
 * The street layer's line-width expression, thickening one audit state if asked.
 *
 * Emphasis borrows the pointer-hover thickness rather than a size of its own, so a state called out from the sidebar
 * looks like the same street a mapper would get by hovering it on the map.
 *
 * @param {?string} [emphasizedState=null] An audit state to thicken (a `STREET_STATE_FILTERS` key), or null for none.
 * @returns {Array} A Mapbox zoom-interpolated line-width expression.
 */
function streetLineWidth(emphasizedState = null) {
  const emphasized = emphasizedState ? STREET_STATE_FILTERS[emphasizedState] : null;
  const atZoom = (thick, thin) => (emphasized
    ? ['case', ['boolean', ['feature-state', 'hover'], false], thick, emphasized, thick, thin]
    : ['case', ['boolean', ['feature-state', 'hover'], false], thick, thin]);

  return ['interpolate', ['linear'], ['zoom'], 12, atZoom(3, 1), 15, atZoom(7, 3)];
}

/**
 * Thickens every street in one audit state, for as long as its sidebar row is hovered or focused (#5258).
 *
 * A repaint rather than per-feature state: the three states cover the whole city, and setting feature-state on
 * thousands of features per pointer entry would cost far more than swapping one paint expression. Mapbox transitions
 * the width for free, so the change reads as a swell rather than a jump.
 *
 * @param {object} map The Mapbox map object.
 * @param {?string} streetState The audit state to thicken, or null to return every street to its normal width.
 */
function emphasizeStreetState(map, streetState) {
  if (!map.getLayer('streets')) return;
  map.setPaintProperty('streets', 'line-width', streetLineWidth(streetState));
}

/**
 * Filters the street layer based on the audited/outdated/unaudited street checkboxes.
 *
 * On pages without the outdated checkbox, outdated streets follow the audited checkbox.
 * @param {object} map The Mapbox map object.
 */
function filterStreetLayer(map) {
  const includeAudited = document.getElementById('audited-street').checked;
  const includeOutdated = document.getElementById('outdated-street')?.checked ?? includeAudited;
  const includeUnaudited = document.getElementById('unaudited-street').checked;

  const included = [];
  if (includeAudited) included.push(STREET_STATE_FILTERS.audited);
  if (includeOutdated) included.push(STREET_STATE_FILTERS.outdated);
  if (includeUnaudited) included.push(STREET_STATE_FILTERS.unaudited);

  if (included.length === 0) {
    map.setLayoutProperty('streets', 'visibility', 'none');
  } else {
    map.setLayoutProperty('streets', 'visibility', 'visible');
    map.setFilter('streets', included.length === 3 ? null : ['any', ...included]);
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
  // Label ID the label popup is spotlighting (or null). That one label bypasses all filters in filterLabelLayers so
  // the dot a user explicitly asked to see (deep link, arrow paging) can't be hidden by the current filter state.
  mapData.spotlightLabelId = null;

  // Severity filter state (all enabled by default).
  mapData.severities = { 0: true, 1: true, 2: true, 3: true };

  // Tag filter state: maps label type -> Set of active tag strings. Empty set = no tag filter.
  mapData.selectedTags = {};

  // One flat array of features and one layer name string per label type.
  mapData.sortedLabels = {};
  mapData.layerNames = {};
  const labelTypes = [
    'CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Occlusion', 'NoSidewalk', 'Crosswalk', 'Signal', 'Other',
  ];
  for (const labelType of labelTypes) {
    mapData.sortedLabels[labelType] = [];
    mapData.layerNames[labelType] = '';
    mapData.selectedTags[labelType] = new Set();
  }
  return mapData;
}

/**
 * Searches for a region id in the query string. If found, frames the map on that region.
 * @param {object} map The Mapbox map object.
 */
function setRegionFocus(map) {
  const regionId = util.getURLParameter('regionId');
  // Small timeout to allow map to load before focusing on region.
  setTimeout(() => {
    if (regionId && map.getLayer('neighborhood-polygons')) {
      const region = map.queryRenderedFeatures({ layers: ['neighborhood-polygons'] })
        .filter((f) => f.id === Number(regionId))[0];
      // Fitting the region's own bounds frames neighborhoods of every size, where one zoom level can only suit one.
      if (region) map.fitBounds(geometryBounds(region.geometry), { padding: 40 });
    }
  }, 250);
}

/**
 * Returns the bounds enclosing a GeoJSON geometry, whatever its nesting depth (point through multi-polygon).
 * @param {object} geometry The GeoJSON geometry.
 * @returns {mapboxgl.LngLatBounds} Bounds covering every coordinate in it.
 */
function geometryBounds(geometry) {
  const bounds = new mapboxgl.LngLatBounds();
  const extend = (coords) => {
    if (typeof coords[0] === 'number') bounds.extend(coords);
    else coords.forEach(extend);
  };
  extend(geometry.coordinates);
  return bounds;
}

/**
 * Returns the bounds enclosing every feature in a GeoJSON FeatureCollection.
 * @param {object} featureCollection The collection.
 * @returns {mapboxgl.LngLatBounds} Bounds covering all of its features.
 */
function featureCollectionBounds(featureCollection) {
  const bounds = new mapboxgl.LngLatBounds();
  for (const feature of featureCollection.features ?? []) bounds.extend(geometryBounds(feature.geometry));
  return bounds;
}
