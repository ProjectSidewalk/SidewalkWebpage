/**
 * Central function that handles the creation of choropleths and maps.
 *
 * @param {object} $ - Allows the use of jQuery.
 * @param {object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {string} params.mapStyle - URL of a Mapbox style.
 * @param {string} [params.mapboxApiKey] - Mapbox API key to use for the map.
 * @param {string} [params.neighborhoodFillMode] - One of 'singleColor' or 'completionRate'.
 * @param {string|URL} [params.neighborhoodsURL] - URL of the endpoint containing neighborhood boundaries.
 * @param {string|URL} params.completionRatesURL - URL of the endpoint containing neighborhood completion rates.
 * @param {boolean} [params.loadCities] - Whether to load deployment cities on the map.
 * @param {boolean} [params.animateCityFit=true] - Whether the fit to all deployment cities is animated. Set false to
 *     have the world view simply appear, with no flight out from the city's own center.
 * @param {string|URL} [params.streetsURL] - URL of the endpoint containing streets.
 * @param {string|URL} [params.labelsURL] - URL of the endpoint containing labels.
 * @param {boolean} [params.viewportLabelLoading=false] - Load labels scoped to the viewport via
 *     ViewportLabelLoader, refetching as the map moves, instead of one up-front whole-feed fetch (#5002). The
 *     returned mapData carries the loader as `labelLoader` so the page can drive UI off its events. Note the
 *     all-loaded promise then resolves once the (empty) label layers exist — label data streams in afterward,
 *     and a feed failure reports through the loader's error event rather than rejecting the promise.
 * @param {object} [params.viewportLabelOptions] - Options forwarded to ViewportLabelLoader.
 * @param {boolean} [params.mobileZoomedStart=false] - On mobile devices, open the map zoomed in on the city
 *     center rather than fitted to the whole city.
 * @param {number} [params.zoomCorrection=0] - Amount to increase default zoom to account for different map dimensions.
 * @param {boolean} [params.scrollWheelZoom=true] - Whether to allow zooming with the scroll wheel.
 * @param {boolean} [params.cooperativeGestures=false] - Whether panning on touch takes two fingers.
 * @param {string} [params.mapboxLogoLocation=bottom-left] - 'top-left', 'top-right', 'bottom-left', or 'bottom-right'.
 * @param {string} [params.neighborhoodTooltip='none'] One of 'none' or 'completionRate'.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {string} [params.neighborhoodFillColor] - Fill color to use if neighborhoodFillMode='singleColor'.
 * @param {number} [params.neighborhoodFillOpacity] - Fill opacity to use if neighborhoodFillMode='singleColor'
 * @param {boolean} [params.differentiateUnauditedStreets=false] - Whether to color unaudited streets differently.
 * @param {boolean} [params.interactiveStreets=false] - Whether to include hover/click interactions on the streets.
 * @param {boolean} [params.includeLabelCounts=false] - Whether to include label counts for each type in the legend.
 * @param {string} [params.navigationControlPosition='top-left'] - Position of the zoom/pitch controls on the map.
 * @param {boolean} [params.sidebarStartsCollapsed=false] - Open the page with the filter drawer closed. Narrow
 *     viewports collapse it regardless, since there it covers the map.
 * @param {string} [params.uiSource] - Records the UI used when submitting a validation through the popup.
 * @param {object} [params.popupLabelViewer] - Shows a validation popup on labels on the map.
 * @param {function} [params.onMapReady] - Called with the map as soon as it has loaded, BEFORE the
 *     (potentially large) neighborhoods/streets/labels layers render. Use this to mount map-bound UI
 *     early (e.g. the LabelMap search box) instead of waiting on the returned all-loaded promise.
 * @returns {Promise} - Promise that resolves once all components of the map have loaded.
 */
function createPSMap($, params) {
  // Set default parameters.
  params.logClicks = params.logClicks === undefined ? true : params.logClicks;
  params.scrollWheelZoom = params.scrollWheelZoom === undefined ? true : params.scrollWheelZoom;
  params.neighborhoodTooltip = params.neighborhoodTooltip === undefined ? 'none' : params.neighborhoodTooltip;
  params.differentiateUnauditedStreets = params.differentiateUnauditedStreets === undefined
    ? false
    : params.differentiateUnauditedStreets;

  // Create the map.
  let map;
  const loadMapParams = $.getJSON('/cityMapParams');
  const mapLoaded = Promise.all([loadMapParams]).then((data) => {
    return createMap(data[0]);
  }).then((newMap) => {
    map = newMap; // Assign the returned map to the map variable.

    // mapbox-gl resizes itself only on the window's resize event, but a full-window map is sized in dvh, which
    // changes when a mobile browser's toolbar collapses — the layout viewport doesn't move, so no resize event
    // fires and the GL canvas is left at a stale size with mis-hit-tested clicks. Observing the container catches
    // that as well as every case the window event already covered.
    const mapContainer = document.getElementById(params.mapName);
    if (mapContainer && window.ResizeObserver) {
      let resizeFrame = null;
      new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => map.resize());
      }).observe(mapContainer);
    }

    // Show the sidebar early (in its disabled/loading state) so it's visible while data loads.
    // Also shift the map center to account for the sidebar covering part of the map.
    const sidebar = document.getElementById('filter-sidebar');
    if (sidebar) {
      sidebar.classList.remove('ps-invisible');
      sidebar.classList.add('filter-sidebar--loading');
      // Built here, not alongside MapSidebarFilter: that waits on the label feed, and the drawer's reopen button
      // is the only way back to the filters once it starts collapsed. Suppress the slide for the first frame so
      // a drawer that opens closed doesn't wipe across the map on load.
      sidebar.classList.add('filter-sidebar--no-transition');
      // Not retained: it binds to the sidebar's own controls, which keep it alive.
      new MapSidebarDrawer(map, sidebar, { startCollapsed: Boolean(params.sidebarStartsCollapsed) });
      requestAnimationFrame(() => sidebar.classList.remove('filter-sidebar--no-transition'));
    }

    // Mount map-bound UI (e.g. the LabelMap search box) now, while the map is ready but the data
    // layers are still loading. Labels alone can be tens of MB (Seattle ~87 MB), so deferring this
    // to the all-loaded promise leaves the control missing for many seconds and then shoves the
    // sidebar down when it finally appears — worse over the network than on localhost (#4370/#4447).
    // Guarded so a failure in the page's callback can't reject this promise and break the data layers.
    if (params.onMapReady) {
      try {
        params.onMapReady(map);
      } catch (e) {
        console.error('onMapReady callback failed', e);
      }
    }

    return map;
  });

  // Render the neighborhoods on the map if applicable. The fetches are kept inside the guard so callers that omit
  // these URLs (e.g. the shared-label minimap) don't fire a stray $.getJSON(undefined) at the current page.
  let renderNeighborhoods;
  if (params.neighborhoodsURL && params.completionRatesURL) {
    const loadNeighborhoods = $.getJSON(params.neighborhoodsURL);
    const loadCompletionRates = $.getJSON(params.completionRatesURL);
    renderNeighborhoods = Promise.all([mapLoaded, loadNeighborhoods, loadCompletionRates]).then((data) => {
      addNeighborhoodsToMap(map, data[1], data[2], params);
    });
  }

  // Render deployment cities on the map if applicable.
  let renderCities;
  if (params.loadCities) {
    const loadCities = $.getJSON('/v3/api/cities?filetype=geojson');
    renderCities = Promise.all([mapLoaded, loadCities]).then((data) => {
      addCitiesToMap(map, data[1], params);
    });
  }

  // Render the streets on the map if applicable.
  let renderStreets;
  if (params.streetsURL) {
    const loadStreets = $.getJSON(params.streetsURL);
    renderStreets = Promise.all([mapLoaded, renderNeighborhoods, loadStreets]).then(
      (data) => addStreetsToMap(map, data[2], params),
    );
  }

  // Render the labels on the map if applicable.
  let renderLabels;
  if (params.labelsURL && params.viewportLabelLoading) {
    renderLabels = Promise.all([mapLoaded, renderStreets]).then(async (data) => {
      // Layers are created empty and filled by the loader, so filters, visibility, and the popup handlers bind
      // once and persist across viewport refetches.
      const mapData = await addLabelsToMap(map, { type: 'FeatureCollection', features: [] }, params);
      // Streets carry no label filters, so their counts are settled the moment they load; park them on the tracker
      // for the sidebar to render alongside the counts it facets itself.
      mapData.streetCounts = data[1];
      const loader = new ViewportLabelLoader(map, params.labelsURL, params.viewportLabelOptions);
      loader.onData((featureCollection) => setLabelData(map, mapData, featureCollection));
      // The page drives its own UI (loading overlay, counts, retry, zoom hint) off the loader's events.
      mapData.labelLoader = loader;
      loader.start();
      return mapData;
    });
  } else if (params.labelsURL) {
    const loadLabels = fetchLabelFeed(params.labelsURL);
    renderLabels = Promise.all([mapLoaded, renderStreets, loadLabels]).then(async (data) => {
      const mapData = await addLabelsToMap(map, data[2], params);
      // Streets carry no label filters, so their counts are settled the moment they load; park them on the tracker
      // for the sidebar to render alongside the counts it facets itself.
      mapData.streetCounts = data[1];
      return mapData;
    });
  }

  // Return a promise that resolves once everything on the map has loaded.
  const allLoaded = Promise.all([mapLoaded, renderNeighborhoods, renderCities, renderStreets, renderLabels]);
  allLoaded.then(() => {
    // Resize the map when the window is resized.
    $(window).resize(() => {
      if (window.citiesMap) {
        window.citiesMap.resize();
      }
    });
  }, () => {
    // Failure is the caller's to report — it owns the page's error UI. Handled here as the second argument to
    // `then` rather than left off, so this branch doesn't become a second, unhandled copy of the same rejection.
    // Note this handler is on the DERIVED promise, which is discarded: `allLoaded` is returned untouched below
    // and still rejects. Attaching the same handler to a promise that IS returned would convert its rejection
    // into a resolution, and callers would receive `undefined` instead of an error.
  });
  return allLoaded;

  /**
   * Create the Mapbox map object and attach a custom logging function to it.
   * @param {object} mapParamData - Map configuration parameters from the /cityMapParams endpoint.
   * @returns {Promise} - Promise that resolves with the Mapbox map once it has loaded.
   */
  function createMap(mapParamData) {
    params.zoomCorrection = params.zoomCorrection ? params.zoomCorrection : 0;
    mapParamData.default_zoom = mapParamData.default_zoom + params.zoomCorrection;

    // Mobile opens zoomed in on the city center rather than fitted to the whole city: with viewport label
    // loading the initial fetch then covers a neighborhood, not the entire feed (#5002). 14 shows a few blocks
    // and sits above ViewportLabelLoader's default zoom floor, so labels are visible immediately. Deep links
    // still win — the URL viewport is applied after construction (applyUrlViewport in the page's onMapReady).
    if (params.mobileZoomedStart && util.isMobile()) {
      mapParamData.default_zoom = Math.max(mapParamData.default_zoom, 14);
    }

    mapboxgl.accessToken = params.mapboxApiKey;
    const newMap = new mapboxgl.Map({
      container: params.mapName, // HTML container ID
      style: params.mapStyle,
      center: [mapParamData.city_center.lng, mapParamData.city_center.lat],
      zoom: mapParamData.default_zoom,
      minZoom: 8.25,
      maxZoom: 19,
      maxBounds: [
        [mapParamData.southwest_boundary.lng, mapParamData.southwest_boundary.lat],
        [mapParamData.northeast_boundary.lng, mapParamData.northeast_boundary.lat],
      ],
      scrollZoom: params.scrollWheelZoom,
      cooperativeGestures: params.cooperativeGestures,
      locale: { 'TouchPanBlocker.Message': i18next.t('common:map-two-finger-pan') },
    });
    newMap.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
    const navPosition = params.navigationControlPosition || 'top-left';
    newMap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), navPosition);

    // Move the Mapbox logo if necessary.
    if (['top-left', 'top-right', 'bottom-right'].includes(params.mapboxLogoLocation)) {
      const mapboxLogoElem = document.querySelector(`#${params.mapName} .mapboxgl-ctrl-logo`).parentElement;
      const newParentElement = document.querySelector(`#${params.mapName} .mapboxgl-ctrl-${params.mapboxLogoLocation}`);
      const attributionElem = newParentElement.querySelector(`#${params.mapName} .mapboxgl-ctrl-attrib`);
      // Add above the other attribution if they are in the same corner, o/w just add it to that corner.
      if (attributionElem) {
        newParentElement.insertBefore(mapboxLogoElem, attributionElem);
      } else {
        newParentElement.appendChild(mapboxLogoElem);
      }
    }

    // From manual testing, it looks best to hide the loading spinner at this point.
    $('#page-loading').hide();

    // Create a promise that resolves when the map has loaded.
    return new Promise((resolve) => {
      if (newMap.loaded()) {
        resolve(newMap);
      } else {
        newMap.on('load', () => {
          resolve(newMap);
        });
      }
    });
  }
}
