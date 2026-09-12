/**
 * Address/place search for the public LabelMap (issue #4370).
 *
 * Mounts a Mapbox Search JS `MapboxSearchBox` at the top of the map's left filter sidebar and
 * hard-limits suggestions to the deployment city's actual extent, so this stays a within-city finder
 * (hospitals, schools, libraries, ...) rather than a general-purpose geocoder. Selecting a result flies
 * the map to the place and drops a Project Sidewalk pin; activating the pin opens the Explore tool at that
 * exact spot, and hovering or focusing it first previews the invitation (#4451). A "clear" button under the
 * search box, and Escape, take the place back off the map again (#5321). Mirrors the setup in
 * `routeBuilder.js` (`#setUpSearchBox`), except the control is mounted inside the sidebar (per #4370)
 * rather than added as a floating control.
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

// Layer id the neighborhood polygons are rendered under. Must match NEIGHBORHOOD_LAYER_NAME in
// `public/js/ps-map/addNeighborhoodsToMap.js`, which owns the layer and attaches `completionRate` to each feature.
const NEIGHBORHOOD_LAYER_ID = 'neighborhood-polygons';

/**
 * Find the neighborhood the given point falls in, reading the polygon the map already renders.
 *
 * Queried from the rendered layer rather than re-fetched so the completion figure shown here is by construction the
 * same one the choropleth is displaying underneath the pin.
 *
 * @param {mapboxgl.Map} map - The LabelMap.
 * @param {number} lat - Latitude of the point.
 * @param {number} lng - Longitude of the point.
 * @returns {{name: string, completionRate: number}|null} Neighborhood name and 0-100 completion, or null if the
 *          point isn't inside a rendered neighborhood (outside the deployment, or the layer hasn't loaded).
 */
function neighborhoodAt(map, lat, lng) {
  if (!map.getLayer(NEIGHBORHOOD_LAYER_ID)) return null;
  const hits = map.queryRenderedFeatures(map.project([lng, lat]), { layers: [NEIGHBORHOOD_LAYER_ID] });
  const props = hits?.[0]?.properties;
  if (!props) return null;
  return { name: props.region_name, completionRate: props.completionRate };
}

/**
 * Extract just the street address from a search result.
 *
 * The search is already scoped to a single city, so city, state, postcode and country are all things the reader
 * already knows — only the street line adds anything. Prefers the structured `context.address` the Search Box API
 * returns, falling back to the first segment of the formatted address.
 *
 * @param {object} props - Properties of the retrieved search feature.
 * @returns {string} Street address (e.g. "100 Elizabeth Ave"), or '' if the result carries none.
 */
function streetAddress(props) {
  const structured = props?.context?.address?.name || props?.address;
  if (structured) return structured;
  const formatted = props?.full_address || '';
  return formatted.split(',')[0].trim();
}

/**
 * Build the "explore here" popup body.
 *
 * @param {mapboxgl.Map} map - The LabelMap, for looking up the surrounding neighborhood.
 * @param {number} lat - Latitude the Explore session should open at.
 * @param {number} lng - Longitude the Explore session should open at.
 * @param {string} placeName - Name of the searched place, or '' when the result carried none.
 * @param {string} address - Street address of the place, or '' when it would just repeat the name.
 * @param {string} exploreHref - URL the "explore here" button opens.
 * @returns {HTMLElement} The popup content element.
 */
function buildExploreHereContent(map, lat, lng, placeName, address, exploreHref) {
  const wrapper = document.createElement('div');
  wrapper.className = 'explore-here';

  const neighborhood = neighborhoodAt(map, lat, lng);
  // Only pitch an incomplete neighborhood — telling someone a finished area is "100% explored" reads as "nothing to
  // do here", the opposite of the invitation this popup is making.
  const showProgress = neighborhood && Number.isFinite(neighborhood.completionRate)
    && neighborhood.completionRate < 100;
  const percent = showProgress ? Math.round(neighborhood.completionRate) : 0;

  // Only trusted markup goes through innerHTML. The place, address, and region strings come from outside this codebase
  // (Mapbox search results are built on user-editable OSM data), so they are set via textContent below — interpolating
  // them here would make this a DOM-XSS sink. In the href, encodeURIComponent covers URL and attribute metacharacters.
  wrapper.innerHTML = `
    ${placeName ? '<p class="explore-here__place"></p>' : ''}
    ${address ? '<p class="explore-here__address"></p>' : ''}
    ${showProgress
      ? `
      <p class="explore-here__context">
        <span class="explore-here__region"></span>
        <span class="explore-here__percent">${i18next.t('labelmap:explore-here-percent', { percent })}</span>
      </p>
      <div class="explore-here__track"><div class="explore-here__fill" style="width:${percent}%"></div></div>`
      : ''}
    <a class="explore-here-button button-ps button--primary button--small" href="${exploreHref}">
      ${i18next.t('labelmap:explore-here')}
    </a>`;
  if (placeName) wrapper.querySelector('.explore-here__place').textContent = placeName;
  if (address) wrapper.querySelector('.explore-here__address').textContent = address;
  if (showProgress) wrapper.querySelector('.explore-here__region').textContent = neighborhood.name;

  wrapper.querySelector('.explore-here-button').addEventListener('click', () => {
    if (typeof window.logWebpageActivity === 'function') {
      window.logWebpageActivity(`Click_module=ExploreSidewalksHere_lat=${lat}_lng=${lng}`);
    }
  });
  return wrapper;
}

/**
 * Initialize the LabelMap address search box.
 *
 * @param {mapboxgl.Map} map - The Mapbox GL map created by createPSMap.
 * @param {string} mapboxApiKey - Mapbox access token (the same token that initialized the map).
 * @returns {{clear: function(): boolean}|null} Handle whose `clear()` takes the searched place back off the
 *          map (true if there was one), or null if the sidebar container or the Search SDK is unavailable.
 */
function initLabelMapLocationSearch(map, mapboxApiKey) {
  const container = document.getElementById('labelmap-search-box');
  if (!container || typeof MapboxSearchBox === 'undefined') return null;

  const searchBox = new MapboxSearchBox();
  searchBox.accessToken = mapboxApiKey;
  searchBox.options = { language: i18next.t('common:mapbox-language-code') };
  searchBox.placeholder = i18next.t('labelmap:search-placeholder');

  // Let the component fly the map to the selected result, but draw our own marker: the stock Mapbox pin is generic,
  // and the component keeps no reference to it, so a custom element is also what makes hover/focus interaction
  // possible at all.
  searchBox.mapboxgl = mapboxgl;
  searchBox.marker = false;

  // onAdd(map) binds the map (enabling the auto-flyTo and a map-center proximity bias) and returns the
  // control's DOM element, which we place inside the sidebar instead of handing to map.addControl().
  const searchBoxElement = searchBox.onAdd(map);
  container.appendChild(searchBoxElement);
  const searchInput = searchBoxElement.querySelector('input[role="combobox"]');
  // Seed the aria-expanded that Search JS itself only writes once its result list has opened (#5087).
  searchInput?.setAttribute('aria-expanded', 'false');

  // The pin a search drops outlives the query that found it: the search box's own ✕ empties the input and leaves the
  // map untouched, so once the text is gone there is nothing left on screen offering to put the place away (#5321).
  // This button is that affordance. It is built here rather than in the two views that mount the control so the
  // affordance and the state it undoes live in one file, and it is hidden until there is a place to clear.
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.id = 'labelmap-search-clear';
  clearButton.className = 'filter-sidebar__deselect-all labelmap-search-clear';
  clearButton.hidden = true;
  clearButton.textContent = i18next.t('labelmap:search-clear');
  container.insertAdjacentElement('afterend', clearButton);

  // On selecting a result, drop a pin the user can hover/focus to open the "explore here" invitation (#4451). The
  // popup is deliberately NOT opened on selection: someone searching an address on the LabelMap is there to look at
  // the labels around it, and a popup sitting open covers exactly what they came to see.
  let searchMarker = null;
  let searchPinEl = null;
  let exploreHerePopup = null;

  const hidePopup = () => {
    if (!exploreHerePopup) return;
    exploreHerePopup.remove();
    exploreHerePopup = null;
  };

  /**
   * Take the searched place back off the map: its pin, the invitation popup, the search text, and this button.
   *
   * The one undo path for a selection — the clear button, Escape, and the search box's own ✕ all come through here,
   * as the place card in #5311 will — so no caller can unwind half of the state and leave a pin with no owner.
   *
   * @param {string} trigger - Activity-log prefix naming how the clear was asked for ('Click', 'KeyboardShortcut').
   * @returns {boolean} True if a place was showing and is now cleared; false if there was nothing to clear.
   */
  const clearSelection = (trigger) => {
    if (!searchMarker) return false;
    // Read before the teardown: focus sitting on something about to be removed (the pin) or hidden (this button)
    // would fall to <body> and lose a keyboard user their place, so below it is handed back to the search field.
    const focusWasOnSelection = document.activeElement === clearButton || document.activeElement === searchPinEl;
    hidePopup();
    searchMarker.remove();
    searchMarker = null;
    searchPinEl = null;
    clearButton.hidden = true;
    if (focusWasOnSelection) searchInput?.focus();
    // Empty the input too, so the box can't keep naming a place that is no longer on the map. The camera is
    // deliberately left where the search flew it: the user asked to go there and only asked to put the pin away.
    searchBox.value = '';
    if (typeof window.logWebpageActivity === 'function') {
      window.logWebpageActivity(`${trigger}_module=ClearSearchResult`);
    }
    return true;
  };

  clearButton.addEventListener('click', () => clearSelection('Click'));
  // Search JS fires `clear` when its own ✕ is pressed. Dropping the pin with it keeps the box and the map from
  // disagreeing about whether a place is selected.
  searchBox.addEventListener('clear', () => clearSelection('Click'));

  // Escape takes one step at a time: it closes an open invitation popup first, so a keyboard user previewing it can
  // back out without also losing the pin they are standing on, and only a second Escape clears the place itself.
  // Bound once for the page — registering this inside the `retrieve` handler would add another listener per search.
  document.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Escape') return;
    if (exploreHerePopup) hidePopup();
    else clearSelection('KeyboardShortcut');
  });

  searchBox.addEventListener('retrieve', (e) => {
    const feature = e.detail?.features?.[0];
    if (!feature) return;
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties || {};
    // No fallback for a missing name: `place_formatted` is a locality line ("Teaneck, NJ 07666, United States"), and
    // presenting that as the place's *name* — here and in the Explore greeting the name feeds — reads as broken.
    const placeName = props.name || '';
    // For a POI the name is the place ("Teaneck High School") and the street address adds something. For a plain
    // address search the name already IS the street address, so showing it twice would just look broken.
    const street = streetAddress(props);
    const address = street && street !== placeName ? street : '';
    // Carry the place name across so Explore can greet the user with where they landed rather than a generic message.
    const exploreHref = `/explore?lat=${lat}&lng=${lng}${
      placeName ? `&placeName=${encodeURIComponent(placeName)}` : ''}`;

    // Null the reference, not just the popup: `showPopup` treats a non-null `exploreHerePopup` as "already open", so
    // leaving a removed popup here would make every later hover a no-op.
    if (exploreHerePopup) {
      exploreHerePopup.remove();
      exploreHerePopup = null;
    }
    if (searchMarker) searchMarker.remove();

    // The pin is a button so it is reachable and operable by keyboard: hover-only content fails WCAG 2.1 AA (1.4.13),
    // so the hover preview is mirrored on focus and the pin itself performs the navigation (see the click handler).
    const pinEl = document.createElement('button');
    pinEl.type = 'button';
    pinEl.className = 'ps-search-pin';
    pinEl.setAttribute('aria-label', i18next.t('labelmap:explore-here'));
    // Drawn as one SVG rather than a badge plus a CSS tail: Mapbox puts its own `.mapboxgl-marker` class (with
    // `position: absolute`) on this very element, so any tail positioned against it is at the mercy of which rule
    // wins. Baking the point into the path makes the geometry independent of the marker's own styling.
    pinEl.innerHTML = `
      <svg class="ps-search-pin__svg" viewBox="0 0 38 48" width="38" height="48" aria-hidden="true" focusable="false">
        <path class="ps-search-pin__body"
              d="M19 47 C19 47 4 31 4 19 A15 15 0 1 1 34 19 C34 31 19 47 19 47 Z"/>
        <circle class="ps-search-pin__face" cx="19" cy="19" r="12.5"/>
        <image href="${util.assetPath('images/logos/ProjectSidewalkLogo_NoText_WheelchairCircleCentered_100x100.png')}"
               x="8" y="8" width="22" height="22"/>
      </svg>`;

    searchMarker = new mapboxgl.Marker({ element: pinEl, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
    searchPinEl = pinEl;
    clearButton.hidden = false;

    const showPopup = () => {
      if (exploreHerePopup) return;
      exploreHerePopup = new mapboxgl.Popup({
        offset: 46,
        closeOnClick: false,
        closeButton: false,
        focusAfterOpen: false,
        className: 'ps-explore-here-popup',
      })
        .setDOMContent(buildExploreHereContent(map, lat, lng, placeName, address, exploreHref))
        .setLngLat([lng, lat])
        .addTo(map);
    };
    pinEl.addEventListener('mouseenter', showPopup);
    pinEl.addEventListener('focus', showPopup);
    pinEl.addEventListener('blur', hidePopup);
    // Leaving the pin shouldn't close a popup the pointer has moved *into* (the user is reaching for the button), so
    // hand off to the popup's own mouseleave. WCAG 1.4.13 requires hover content stay reachable this way.
    pinEl.addEventListener('mouseleave', () => {
      setTimeout(() => {
        const el = exploreHerePopup?.getElement();
        if (el && !el.matches(':hover') && !pinEl.matches(':hover')) hidePopup();
      }, 120);
    });
    // Activating the pin navigates directly — it must perform the action its accessible name promises. The popup's
    // link can never be the only path: for a keyboard user, Tabbing toward it blurs the pin, which tears the popup
    // down before its link could receive focus, so a popup-only design fails WCAG 2.1.1 (Keyboard).
    pinEl.addEventListener('click', () => {
      if (typeof window.logWebpageActivity === 'function') {
        window.logWebpageActivity(`Click_module=ExploreSidewalksHere_lat=${lat}_lng=${lng}`);
      }
      window.location.assign(exploreHref);
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

  return { clear: () => clearSelection('Click') };
}
