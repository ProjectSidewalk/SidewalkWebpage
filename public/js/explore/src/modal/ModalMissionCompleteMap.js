/**
 * The Mapbox map inside the mission-complete modal. It shows the streets the user worked on, split into three tiers
 * (the just-finished mission, the user's earlier missions, and everyone's community progress), plus the labels the user
 * placed during the mission and, on a user-defined route, start/finish flags at the route's ends. The view is framed to
 * the streets from the mission that just finished.
 */
class ModalMissionCompleteMap {
  #mapPromise;
  #labelLayerNames = [];
  #flagMarkers = [];
  #explorerRaf = null;
  #explorerLingerTimeout = null;
  #routeIconsReady = false;

  // The three street tiers, drawn bottom-to-top. Colors come from CSS so the map matches the legend.
  static #STREET_TIERS = [
    { id: 'mc-street-community', colorVar: '--mc-line-community', width: 3 },
    { id: 'mc-street-previous', colorVar: '--mc-line-previous', width: 4 },
    { id: 'mc-street-this-mission', colorVar: '--mc-line-this-mission', width: 5 },
  ];

  // Route start/finish flags reuse RouteBuilder's flag icons (the same ones shown on the Explore minimap), at its
  // rasterized size, planted at the pole base. Scaled by --ui-scale to match the rest of the (unscaled-map) modal UI.
  static #ROUTE_FLAG_SIZE_PX = 27;
  static #START_FLAG_SRC = '/assets/images/icons/routebuilder/flag-start.svg';
  static #FINISH_FLAG_SRC = '/assets/images/icons/routebuilder/flag-end.svg';

  // The explorer ("flag person") that walks the route start-to-finish, reusing RouteBuilder's explorer icon and its
  // walk duration so the finish celebration mirrors the RouteBuilder preview.
  static #EXPLORER_SRC = '/assets/images/icons/project_sidewalk_flag.png';
  static #EXPLORER_SIZE_PX = 40;
  static #EXPLORER_WALK_MS = 2500;
  static #EXPLORER_LINGER_MS = 700; // Pause at the finish before the explorer is removed.
  static #EMPTY_FC = { type: 'FeatureCollection', features: [] };

  /**
   * @param {string} mapContainerId HTML id of the element that holds the map.
   * @param {string} mapboxApiKey Mapbox API key.
   */
  constructor(mapContainerId, mapboxApiKey) {
    this.#mapPromise = this.#createMap(mapContainerId, mapboxApiKey);
  }

  /**
   * Creates the Mapbox map centered on the city and resolves once it has loaded.
   * @param {string} containerId HTML id of the map container.
   * @param {string} mapboxApiKey Mapbox API key.
   * @returns {Promise} Resolves with the loaded Mapbox map.
   */
  #createMap(containerId, mapboxApiKey) {
    return fetch('/cityMapParams', { headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((data) => {
        mapboxgl.accessToken = mapboxApiKey;
        const map = new mapboxgl.Map({
          container: containerId,
          style: 'mapbox://styles/mapbox/light-v11?optimize=true',
          center: [data.city_center.lng, data.city_center.lat],
          zoom: data.default_zoom,
          minZoom: 10,
          maxZoom: 19,
          maxBounds: [
            [data.southwest_boundary.lng, data.southwest_boundary.lat],
            [data.northeast_boundary.lng, data.northeast_boundary.lat],
          ],
        });
        map.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
        return new Promise((resolve) => {
          if (map.loaded()) resolve(map);
          else map.on('load', () => resolve(map));
        });
      });
  }

  /**
   * Draws the street tiers and mission labels, then frames the just-finished mission's streets.
   * @param {object} streetTiers GeoJSON FeatureCollections keyed by tier: { thisMission, previous, community }.
   * @param {object} labelData GeoJSON FeatureCollection of labels placed during the mission.
   */
  async update(streetTiers, labelData) {
    const map = await this.#mapPromise;
    this.#clearLayers(map);

    const tierData = {
      'mc-street-community': streetTiers.community,
      'mc-street-previous': streetTiers.previous,
      'mc-street-this-mission': streetTiers.thisMission,
    };
    for (const tier of ModalMissionCompleteMap.#STREET_TIERS) {
      const color = getComputedStyle(document.documentElement).getPropertyValue(tier.colorVar).trim();
      map.addSource(tier.id, { type: 'geojson', data: tierData[tier.id] });
      map.addLayer({
        id: tier.id,
        type: 'line',
        source: tier.id,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': tier.width, 'line-opacity': 1 },
      });
    }

    // Reuse PSMap's label rendering so the dots match the label map. Mark labels as unvalidated so the default
    // filter shows them, and skip the high-quality filter (no param) since these are the user's own fresh labels.
    const mapData = await addLabelsToMap(map, labelData, {});
    this.#labelLayerNames = Object.values(mapData.layerNames);

    this.#drawRouteFlags(map);
    this.#frameMission(map, streetTiers);
    await this.#drawRouteDirection(map);
  }

  /**
   * Plants start and finish flags at the route's endpoints (routes only), reusing RouteBuilder's flag-start/flag-end
   * icons — the same flags shown on the Explore minimap — so building, walking, and finishing a route read as one
   * experience. Endpoints come from TaskContainer.getRouteEndpoints (the walk-ordered origin/destination); each flag is
   * anchored at its pole base on the point. The flags are decorative reinforcement of the route already drawn as a
   * line, so their images are marked decorative (empty alt) for screen readers.
   * @param {mapboxgl.Map} map The modal's Mapbox map.
   */
  #drawRouteFlags(map) {
    if (!svl.neighborhoodModel.isRoute) return;
    const endpoints = svl.taskContainer.getRouteEndpoints();
    if (!endpoints) return;
    const size = Math.round(ModalMissionCompleteMap.#ROUTE_FLAG_SIZE_PX * util.uiScale());
    const plantFlag = (latLng, src) => {
      const el = document.createElement('img');
      el.src = src;
      el.alt = '';
      el.style.width = `${size}px`;
      this.#flagMarkers.push(new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([latLng.lng, latLng.lat])
        .addTo(map));
    };
    plantFlag(endpoints.start, ModalMissionCompleteMap.#START_FLAG_SRC);
    plantFlag(endpoints.finish, ModalMissionCompleteMap.#FINISH_FLAG_SRC);
  }

  /**
   * On a user-defined route, draws direction chevrons along the whole route and walks the explorer ("flag person")
   * from start to finish — the same playful arrival RouteBuilder previews when saving a route. No-op off routes, or if
   * the route path has fewer than two points.
   * @param {mapboxgl.Map} map The modal's Mapbox map.
   */
  async #drawRouteDirection(map) {
    if (!svl.neighborhoodModel.isRoute) return;
    const coords = svl.taskContainer.getRoutePathCoordinates();
    if (coords.length < 2) return;
    await this.#ensureRouteIcons(map);

    const scale = util.uiScale();
    // Direction chevrons spaced along the route's walking direction (the LineString is walk-ordered).
    map.addSource('mc-route-path', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    });
    map.addLayer({
      id: 'mc-route-arrows',
      type: 'symbol',
      source: 'mc-route-path',
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 44 * scale,
        'icon-image': 'mc-route-arrow',
        'icon-size': scale,
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    // The explorer's point source; the animation feeds it a fresh position each frame.
    map.addSource('mc-route-explorer', { type: 'geojson', data: ModalMissionCompleteMap.#EMPTY_FC });
    map.addLayer({
      id: 'mc-route-explorer',
      type: 'symbol',
      source: 'mc-route-explorer',
      layout: {
        'icon-image': 'mc-route-explorer-icon',
        'icon-anchor': 'bottom',
        'icon-size': scale,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    this.#animateExplorer(map, coords);
  }

  /**
   * Registers the map images the route-direction layers need — the explorer icon (rasterized from its PNG) and a
   * white-on-dark direction chevron drawn on a canvas — once per map. The images persist for the map's life, so this
   * is guarded to run a single time.
   * @param {mapboxgl.Map} map The modal's Mapbox map.
   */
  async #ensureRouteIcons(map) {
    if (this.#routeIconsReady) return;
    const explorer = await ModalMissionCompleteMap.#rasterizeIcon(
      ModalMissionCompleteMap.#EXPLORER_SRC, ModalMissionCompleteMap.#EXPLORER_SIZE_PX,
    );
    if (!map.hasImage('mc-route-explorer-icon')) {
      map.addImage('mc-route-explorer-icon', explorer.data, { pixelRatio: explorer.pixelRatio });
    }
    if (!map.hasImage('mc-route-arrow')) {
      map.addImage('mc-route-arrow', ModalMissionCompleteMap.#buildArrowImage(), { pixelRatio: 2 });
    }
    this.#routeIconsReady = true;
  }

  /**
   * Walks the explorer along the route from start to finish at a constant speed, then leaves it at the finish for a
   * beat before removing it. Interpolates over cumulative segment distance (not vertex count) so the pace is even
   * regardless of how the streets are subdivided.
   * @param {mapboxgl.Map} map The modal's Mapbox map.
   * @param {number[][]} coords The walk-ordered [lng, lat] route path.
   */
  #animateExplorer(map, coords) {
    const source = map.getSource('mc-route-explorer');
    if (!source) return;

    const cumDist = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDist.push(cumDist[i - 1] + turf.distance(turf.point(coords[i - 1]), turf.point(coords[i])));
    }
    const totalDist = cumDist[cumDist.length - 1];
    if (totalDist === 0) return;

    let startTime = null;
    const step = (now) => {
      if (startTime === null) startTime = now;
      const t = Math.min((now - startTime) / ModalMissionCompleteMap.#EXPLORER_WALK_MS, 1);
      const target = t * totalDist;
      let i = 1;
      while (i < cumDist.length - 1 && cumDist[i] < target) i++;
      const segT = (target - cumDist[i - 1]) / (cumDist[i] - cumDist[i - 1] || 1);
      const lng = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * segT;
      const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * segT;
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
      });
      if (t < 1) {
        this.#explorerRaf = requestAnimationFrame(step);
      } else {
        this.#explorerRaf = null;
        // Linger at the finish, then clear the explorer so the final frame is just the route and its flags.
        this.#explorerLingerTimeout = setTimeout(() => {
          if (map.getSource('mc-route-explorer')) source.setData(ModalMissionCompleteMap.#EMPTY_FC);
        }, ModalMissionCompleteMap.#EXPLORER_LINGER_MS);
      }
    };
    this.#explorerRaf = requestAnimationFrame(step);
  }

  /**
   * Draws a small right-pointing chevron (white fill over a dark casing so it reads on both the light basemap and the
   * route line) for use as the route's direction arrow. A line-placed symbol aligns its rightward axis with the line's
   * reading direction, so a rightward chevron points along the walk. Rendered at 2x for crisp high-DPI display.
   * @returns {ImageData} The chevron pixels, sized for a pixelRatio-2 map image.
   */
  static #buildArrowImage() {
    const ratio = 2;
    const base = 16;
    const size = base * ratio;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(5.5, 3.5);
      ctx.lineTo(10.5, 8);
      ctx.lineTo(5.5, 12.5);
    };
    trace();
    ctx.strokeStyle = 'rgba(36, 36, 36, 0.85)'; // --color-neutral-900 casing.
    ctx.lineWidth = 4;
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
  }

  /**
   * Rasterizes an icon file into pixel data for map.addImage (Mapbox's loadImage can't decode SVGs). Rendered at 2x,
   * preserving aspect ratio.
   * @param {string} url Same-origin image url (SVG or raster).
   * @param {number} heightPx Displayed height in CSS pixels; width follows the image's aspect ratio.
   * @returns {Promise<{data: ImageData, pixelRatio: number}>}
   */
  static async #rasterizeIcon(url, heightPx) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const h = heightPx * 2;
    const w = Math.round((img.naturalWidth / img.naturalHeight) * h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), pixelRatio: 2 };
  }

  /** Resizes the map to its container, needed because the map is created while the modal is hidden. */
  resize() {
    this.#mapPromise.then((map) => map.resize());
  }

  /** Removes the street and label layers/sources from a previous mission so they can be re-added. */
  #clearLayers(map) {
    const layerIds = ModalMissionCompleteMap.#STREET_TIERS.map((tier) => tier.id).concat(this.#labelLayerNames);
    for (const layerId of layerIds) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(layerId)) map.removeSource(layerId);
    }
    this.#labelLayerNames = [];
    for (const marker of this.#flagMarkers) marker.remove();
    this.#flagMarkers = [];

    // Stop any in-flight explorer walk and drop the route-direction layers/sources so update() can re-add them.
    if (this.#explorerRaf !== null) {
      cancelAnimationFrame(this.#explorerRaf);
      this.#explorerRaf = null;
    }
    if (this.#explorerLingerTimeout !== null) {
      clearTimeout(this.#explorerLingerTimeout);
      this.#explorerLingerTimeout = null;
    }
    for (const id of ['mc-route-arrows', 'mc-route-explorer']) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ['mc-route-path', 'mc-route-explorer']) {
      if (map.getSource(id)) map.removeSource(id);
    }
  }

  /**
   * Fits the map to the streets from the just-finished mission, leaving room for the overlay cards. Falls back to all
   * worked streets if the mission tier is somehow empty.
   */
  #frameMission(map, streetTiers) {
    const target = streetTiers.thisMission.features.length
      ? streetTiers.thisMission
      : { type: 'FeatureCollection', features: [...streetTiers.previous.features, ...streetTiers.community.features] };
    if (!target.features.length) return;

    const scale = util.uiScale();
    map.fitBounds(turf.bbox(target), {
      padding: { top: 60 * scale, bottom: 30 * scale, left: 210 * scale, right: 210 * scale },
      animate: false,
    });
  }
}
