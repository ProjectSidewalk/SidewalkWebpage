/**
 * Address/place search for the public LabelMap (issue #4370).
 *
 * Mounts a Mapbox Search JS `MapboxSearchBox` at the top of the map's left filter sidebar and
 * hard-limits suggestions to the deployment city's actual extent, so this stays a within-city finder
 * (hospitals, schools, libraries, ...) rather than a general-purpose geocoder. Selecting a result flies
 * the map to the place, drops a marker, and shows an "Explore the sidewalks here" popup that opens the
 * Explore tool at that exact spot (#4451). Mirrors the setup in `routeBuilder.js` (`#setUpSearchBox`),
 * except the control is mounted inside the sidebar (per #4370) rather than added as a floating control.
 */

// Fraction of the region's own span to pad the search bbox by on each edge, so places just outside the audited
// footprint (e.g. a hospital across a boundary road) still surface, without opening the search up to the surrounding
// metro. A small buffer — the DB config pan-bounds are far too loose to use here (e.g. Seattle's spans ~300 km).
const CITY_BBOX_BUFFER_FRACTION = 0.1;

/**
 * Compute a slightly-buffered bounding box of a GeoJSON FeatureCollection (or single Feature).
 *
 * @param {object} geojson - GeoJSON FeatureCollection or Feature with Polygon/MultiPolygon geometry.
 * @returns {number[][]|null} bbox as [[minLng, minLat], [maxLng, maxLat]] (Mapbox LngLatBounds order),
 *                            padded by CITY_BBOX_BUFFER_FRACTION per edge, or null if no coordinates found.
 */
function cityBoundingBox(geojson) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(visit);
    }
  };
  const features = geojson.features || (geojson.geometry ? [geojson] : []);
  for (const feature of features) {
    if (feature.geometry && feature.geometry.coordinates) visit(feature.geometry.coordinates);
  }
  if (minLng === Infinity) return null;
  const padLng = (maxLng - minLng) * CITY_BBOX_BUFFER_FRACTION;
  const padLat = (maxLat - minLat) * CITY_BBOX_BUFFER_FRACTION;
  return [[minLng - padLng, minLat - padLat], [maxLng + padLng, maxLat + padLat]];
}

/**
 * Initialize the LabelMap address search box.
 *
 * @param {mapboxgl.Map} map - The Mapbox GL map created by createPSMap.
 * @param {string} mapboxApiKey - Mapbox access token (the same token that initialized the map).
 * @returns {void} No-op if the sidebar container or the Search SDK is unavailable.
 */
function initLabelMapLocationSearch(map, mapboxApiKey) {
  const container = document.getElementById('labelmap-search-box');
  if (!container || typeof MapboxSearchBox === 'undefined') return;

  const searchBox = new MapboxSearchBox();
  searchBox.accessToken = mapboxApiKey;
  searchBox.options = { language: i18next.t('common:mapbox-language-code') };
  searchBox.placeholder = i18next.t('labelmap:search-placeholder');

  // Let the component fly the map to, and drop a marker on, the selected result for free.
  searchBox.mapboxgl = mapboxgl;
  searchBox.marker = true;

  // onAdd(map) binds the map (enabling the auto-flyTo and a map-center proximity bias) and returns the
  // control's DOM element, which we place inside the sidebar instead of handing to map.addControl().
  container.appendChild(searchBox.onAdd(map));

  // On selecting a result, offer to open the Explore tool right at that spot (#4451). The popup is offset above the
  // component's own result marker; searching again replaces the previous popup.
  let exploreHerePopup = null;
  searchBox.addEventListener('retrieve', (e) => {
    const feature = e.detail?.features?.[0];
    if (!feature) return;
    const [lng, lat] = feature.geometry.coordinates;

    if (exploreHerePopup) exploreHerePopup.remove();
    exploreHerePopup = new mapboxgl.Popup({ offset: 40, closeOnClick: false, focusAfterOpen: false })
      .setHTML(`
        <a class="explore-here-button" href="/explore?lat=${lat}&lng=${lng}">
          ${i18next.t('labelmap:explore-here')}
        </a>
      `)
      .setLngLat([lng, lat])
      .addTo(map);
    exploreHerePopup.getElement().querySelector('.explore-here-button').addEventListener('click', () => {
      if (typeof window.logWebpageActivity === 'function') {
        window.logWebpageActivity(`Click_module=ExploreSidewalksHere_lat=${lat}_lng=${lng}`);
      }
    });
  });

  // Hard-limit suggestions to the deployment city's actual footprint (the bounding box of its
  // neighborhoods), NOT the map's deliberately-generous pan-bounds (which can span a whole metro area).
  // Merge onto the existing options so we don't clobber a proximity the map binding may have added.
  fetch('/neighborhoods')
    .then((response) => response.json())
    .then((geojson) => {
      const bbox = cityBoundingBox(geojson);
      if (bbox) searchBox.options = { ...searchBox.options, bbox };
    })
    .catch(() => { /* If the city extent can't be loaded, leave the search unbounded. */ });
}
