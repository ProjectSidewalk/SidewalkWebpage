/**
 * Panoramax implementation of the panorama viewer (#5185).
 *
 * Panoramax is the French open street-level imagery commons (IGN + OpenStreetMap France). Its pictures come through
 * a keyless STAC API, so unlike Mapillary and Infra3d there is no provider SDK to wrap: this class calls the API
 * itself and renders with Photo Sphere Viewer (the vendored bundle in public/vendor/photo-sphere-viewer/), whose
 * equirectangular-tiles adapter reads the tile pyramid every Panoramax picture publishes.
 *
 * API docs: https://docs.panoramax.fr/backend/api/api/
 * Viewer docs: https://photo-sphere-viewer.js.org/guide/
 *
 * Conventions verified against Panoramax's own viewer (see the Planning report for the spike):
 * - PSV yaw 0 is the centre of the image, which the camera's compass heading (`view:azimuth`) points at, so
 *   heading = azimuth + yaw. The sphere is never rotated by the heading; `sphereCorrection` only carries the
 *   camera's pitch and roll (`pers:pitch`/`pers:roll`), and Panoramax applies it only when both are non-zero.
 * - Tiles are addressed by the item's own URL template (`asset_templates.tiles`, `{TileCol}`/`{TileRow}`): the IGN
 *   instance serves them under `/tiled/`, OSM-France under `/tiles/`, so a hand-built path is wrong on one of them.
 * - The search API's `datetime` filter is ignored by the meta-catalog, so recency is scored client-side, the way
 *   MapillaryViewer already does for Mapillary.
 */
class PanoramaxViewer extends PanoViewer {
  /** The federated meta-catalog, which searches every Panoramax instance at once. */
  static API_BASE = 'https://api.panoramax.xyz/api';

  /**
   * How far from a requested location a picture may be and still count as "here", in meters. Mirrors Explore's
   * svl.STREETVIEW_MAX_DISTANCE, which isn't defined on the other pages this viewer serves (Validate, Gallery).
   */
  static #SEARCH_RADIUS_M = 25;

  /** How far a picture may be from the current one and still be offered as a navigation link, in meters. */
  static #LINK_RADIUS_M = 30;

  /**
   * How far a picture from another sequence must be to count as somewhere to go, in meters. Parallel sequences on
   * the same road (the other carriageway, a second pass) sit a few meters to the side; a link there is a sidestep, not
   * a move, and on a dense network every side would offer one.
   */
  static #MIN_CROSS_LINK_M = 8;

  /**
   * How far, in degrees, a picture from another sequence must be from the directions the current sequence already
   * covers before it earns its own arrow. Closer than this it is the same road seen from a neighbouring sequence.
   */
  static #CROSS_LINK_MIN_ANGLE = 50;

  /** Widest vertical field of view we render at, matching MapillaryViewer's clamp so zoom 1 looks the same. */
  static #MAX_VERTICAL_FOV = 90;

  /** The licence identifiers Panoramax uses, mapped to the display name and link our attribution overlay shows. */
  static #LICENSES = {
    'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    'etalab-2.0': { name: 'Licence Ouverte 2.0', url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/' },
  };

  /** @type {object} The underlying Photo Sphere Viewer instance. */
  #viewer = undefined;

  /** @type {object|undefined} The STAC item (GeoJSON feature) of the picture being shown. */
  #item = undefined;

  /** @type {Map<string, object>} STAC items by picture id, so a search result never has to be fetched twice. */
  #items = new Map();

  /** @type {{yaw: number, pitch: number}} The live view direction in radians, cached so getPov() is synchronous. */
  #position = { yaw: 0, pitch: 0 };

  /** @type {number|undefined} The live vertical field of view in degrees, cached from zoom-updated. */
  #verticalFov = undefined;

  /**
   * Whether the current picture is rendered with its camera pitch/roll corrected out. When it is, PSV's pitch is
   * the true pitch; when it isn't, the camera's own pitch has to be added, as PannellumViewer does.
   * @type {boolean}
   */
  #correctionApplied = false;

  /** @type {{show: Function, hide: Function}|undefined} The producer + licence line the licences oblige us to show. */
  #attribution = undefined;

  /**
   * Prefetched search results, keyed by location: { centerPoint, promise: Promise<Array<object>> }. Same contract
   * as MapillaryViewer's, so NavigationService can warm them as it walks a street.
   * @type {Array<{centerPoint: object, promise: Promise<Array<object>>}>}
   */
  #prefetchedSearches = [];

  constructor() {
    super();
    this.currPanoData = undefined;
  }

  /**
   * @param {Element} canvasElem Container element to mount the viewer into.
   * @param {object} panoOptions
   * @param {string} [panoOptions.startPanoId] Picture to start at; either this or startLatLng is required.
   * @param {{lat: number, lng: number}} [panoOptions.startLatLng] Starting location.
   * @param {Array<{lat: number, lng: number}>} [panoOptions.backupLatLngs] Fallback locations, tried in order.
   * @param {boolean} [panoOptions.zoomControl=true] Whether mouse-wheel zoom is enabled (`scrollwheel` also works).
   * @returns {Promise<void>}
   */
  async initialize(canvasElem, panoOptions = {}) {
    const { Viewer, EquirectangularTilesAdapter } = PhotoSphereViewer;
    // Validate and the label popup pass GSV's `scrollwheel` name for the same switch.
    let wheelZoom = true;
    if ('zoomControl' in panoOptions) wheelZoom = panoOptions.zoomControl;
    else if ('scrollwheel' in panoOptions) wheelZoom = panoOptions.scrollwheel;

    const fovs = this.#fovLimits();
    this.#viewer = new Viewer({
      container: canvasElem,
      adapter: EquirectangularTilesAdapter,
      navbar: false,
      keyboard: false, // Explore and Validate own the arrow keys.
      mousewheel: wheelZoom,
      touchmoveTwoFingers: false,
      loadingTxt: '',
      minFov: fovs.min,
      maxFov: fovs.max,
      defaultZoomLvl: 0, // Widest view, i.e. our zoom 1.
      moveInertia: false,
      // Keep the frame buffer between draws so Canvas.js can screenshot the WebGL canvas for label crops.
      rendererParameters: { preserveDrawingBuffer: true },
    });
    this.#attribution = createPanoAttribution(canvasElem);

    // Set up event listeners. We hold a list and go through each listener ourselves to control their ordering.
    // Changing zoom fires zoom-updated but not position-updated; we consider both a pov change.
    const povChangeListener = async (e) => {
      for (const listener of this.povChangedListeners) await listener(e);
    };
    this.#viewer.addEventListener('position-updated', (e) => {
      this.#position = { yaw: e.position.yaw, pitch: e.position.pitch };
      povChangeListener(e);
    });
    this.#viewer.addEventListener('zoom-updated', (e) => {
      this.#verticalFov = this.#viewer.state.vFov;
      povChangeListener(e);
    });

    // Initialize pano at the desired location.
    await this._moveToInitialLocation(panoOptions);
  }

  getPanoId = () => {
    return this.currPanoData.getPanoId();
  };

  getPosition = () => {
    return { lat: this.currPanoData.getProperty('lat'), lng: this.currPanoData.getProperty('lng') };
  };

  setLocation = async (latLng, excludedPanos = new Set()) => {
    const center = turf.point([latLng.lng, latLng.lat]);
    const best = await this.#searchAndSelectPano(center, excludedPanos);
    if (!best) {
      // The search ran and came back with nothing the caller can use — either the location is genuinely empty or
      // its only pictures are ones already excluded. Both are answers, so both are NoImageryError; a failure to
      // reach the API at all propagates untyped from the calls above instead (#4918).
      throw new NoImageryError(
        `No usable Panoramax picture within ${PanoramaxViewer.#SEARCH_RADIUS_M}m of ${latLng.lat},${latLng.lng}.`,
      );
    }
    return this.setPano(best.id);
  };

  setPano = async (panoId) => {
    const item = await this.#fetchItem(panoId);
    const oldPov = this.currPanoData ? this.getPov() : null; // Keep the same view across the move, like Mapillary.

    const props = item.properties;
    const pitch = props['pers:pitch'] || 0;
    const roll = props['pers:roll'] || 0;
    // Panoramax's viewer corrects a 360° picture's sphere only when both angles are present, treating a lone value
    // as untrustworthy metadata; mirror that so we render what their contributors see when they check their uploads.
    this.#correctionApplied = pitch !== 0 && roll !== 0;

    const sphereCorrection = this.#correctionApplied
      ? { pan: 0, tilt: -util.math.toRadians(pitch), roll: -util.math.toRadians(roll) }
      : { pan: 0, tilt: 0, roll: 0 };
    const load = this.#viewer.setPanorama(PanoramaxViewer.#panoramaConfig(item), {
      transition: false,
      showLoader: !this.currPanoData, // Only the very first picture gets PSV's spinner; moves keep the old frame.
      sphereCorrection,
    });
    // Say that it failed if it doesn't work after 12 seconds, the budget MapillaryViewer gives a move. The timer is
    // cleared either way, so a page that moves often doesn't carry a pending timeout per move.
    let timer;
    const loaded = await Promise.race([
      load,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out')), 12000);
      }),
    ]).catch((err) => {
      console.error('Failed to load pano: ', panoId, err);
      throw new Error(`Failed to load pano: ${panoId}`);
    }).finally(() => clearTimeout(timer));
    // PSV resolves false when the load was superseded by a newer setPanorama call; the newer call reports for both.
    if (loaded === false) throw new Error(`Load of pano ${panoId} was superseded`);

    this.#item = item;
    this.#position = this.#viewer.getPosition();
    this.#verticalFov = this.#viewer.state.vFov;
    this.currPanoData = new PanoData(this.#panoDataParams(item));
    this.#attribution.show(this.#attributionFor(item));
    if (oldPov) this.setPov(oldPov);

    // Links are a second request, so the move resolves first and the arrows follow.
    this.currPanoData.setProperty('linkedPanos', await this.#findLinkedPanos(item));

    for (const listener of this.panoChangedListeners) await listener();
    return this.currPanoData;
  };

  getLinkedPanos = () => {
    return this.currPanoData.getProperty('linkedPanos');
  };

  getPov = () => {
    const heading = this.#yawToHeading(this.#position.yaw);
    const pitch = util.math.toDegrees(this.#position.pitch) + (this.#correctionApplied ? 0 : this.#cameraPitch());
    const horizontalFov = util.pano.vFovToHFov(this.#verticalFov ?? this.#viewer.state.vFov, this.#aspect());
    return { heading, pitch, zoom: util.pano.fovToZoom(horizontalFov) };
  };

  setPov = (pov) => {
    const pitchDeg = pov.pitch - (this.#correctionApplied ? 0 : this.#cameraPitch());
    this.#viewer.rotate({ yaw: this.#headingToYaw(pov.heading), pitch: util.math.toRadians(pitchDeg) });
    this.#position = this.#viewer.getPosition();

    // Convert zoom to a horizontal fov, then to the vertical fov PSV's zoom level is defined on.
    const zoom = pov.zoom || this.getPov().zoom || 1;
    const verticalFov = util.pano.hFovToVFov(util.pano.zoomToFov(zoom), this.#aspect());
    this.#viewer.zoom(this.#viewer.dataHelper.fovToZoomLevel(verticalFov));
    this.#verticalFov = this.#viewer.state.vFov;
  };

  // Navigation arrows are drawn by the apps from getLinkedPanos(); Photo Sphere Viewer has none of its own.
  hideNavigationArrows = () => {};
  showNavigationArrows = () => {};

  resize = () => {
    if (!this.#viewer) return;
    this.#viewer.autoSize();
    // The zoom-1 and zoom-3 field-of-view bounds are defined horizontally, so a new aspect ratio moves them.
    const fovs = this.#fovLimits();
    this.#viewer.setOptions({ minFov: fovs.min, maxFov: fovs.max });
  };

  /**
   * Prefetches pictures near a location so that a subsequent setLocation() call can skip the API round-trip.
   * Safe to call multiple times — skips the fetch if a nearby prefetch already exists.
   * @param {{lat: number, lng: number}} latLng The location to prefetch pictures for.
   */
  prefetchLocation = (latLng) => {
    const centerPoint = turf.point([latLng.lng, latLng.lat]);
    if (!this.#findNearestPrefetch(centerPoint)) this.#storePrefetch(centerPoint);
  };

  clearPrefetchCache = () => {
    this.#prefetchedSearches = [];
    // The item cache holds every STAC item every search returned, so it grows for the life of the page unless it is
    // dropped with the searches that filled it. The current picture stays, since setPano() re-reads it on a move.
    this.#items = new Map(this.#item ? [[this.#item.id, this.#item]] : []);
  };

  /**
   * Pre-downloads the picture that setLocation() would pick so a subsequent move there doesn't wait on the network:
   * runs the same search + scoring, then warms the browser cache with its base image, which is what PSV shows first.
   * @param {{lat: number, lng: number}} latLng The location the next move is expected to target.
   * @param {Set<PanoData>} [excludedPanos] Panos the next move is expected to exclude.
   * @returns {Promise<void>}
   */
  preloadPanoNear = async (latLng, excludedPanos = new Set()) => {
    try {
      const best = await this.#searchAndSelectPano(turf.point([latLng.lng, latLng.lat]), excludedPanos);
      if (best?.assets?.sd) new Image().src = best.assets.sd.href;
    } catch (err) {
      console.warn('Failed to preload pano near', latLng, err);
    }
  };

  /**
   * See PanoViewer.publicViewerLink(). Panoramax's `xyz` is heading/pitch/zoom, with zoom on its own 0–100 scale
   * (30 is its default view). `LabelDataForApi.panoUrl` builds the same URL server-side for the v3 API's `pano_url`
   * and can't share this code across the language line — change one and change the other.
   */
  publicViewerLink(panoId, { heading = 0, pitch = 0 } = {}) {
    return {
      url: `https://api.panoramax.xyz/#focus=pic&pic=${panoId}&xyz=${heading.toFixed(2)}/${pitch.toFixed(2)}/30`,
      i18nKey: 'common:pano-info.view-in-panoramax',
    };
  }

  // ---- Search and selection ---------------------------------------------------------------------------------------

  /**
   * Searches for 360° pictures near a point and picks the best viable candidate. Uses a prefetched search if one
   * exists near the location, otherwise fetches and caches it. If a prefetched search yields no viable candidate
   * (e.g. all excluded), falls back to a fresh search centered exactly on the target.
   *
   * @param {object} center The target location as a turf point.
   * @param {Set<PanoData>} excludedPanos Panos that are not viable candidates.
   * @returns {Promise<object|null>} The best candidate's STAC item, or null if none are viable.
   */
  #searchAndSelectPano = async (center, excludedPanos) => {
    const excludedIds = new Set([...excludedPanos].map((p) => p.getPanoId()));
    const prefetch = this.#findNearestPrefetch(center);
    let items = await (prefetch ?? this.#storePrefetch(center)).promise;
    let best = this.#selectBestPano(items, excludedIds, center);
    if (!best && prefetch) {
      items = await this.#storePrefetch(center).promise;
      best = this.#selectBestPano(items, excludedIds, center);
    }
    return best;
  };

  /**
   * Scores a candidate picture for selection, balancing the same factors with the same weights as
   * MapillaryViewer.#scorePano so the two providers pick comparably.
   *
   * @param {object} item The picture's STAC item.
   * @param {object} centerPoint The target location as a turf point.
   * @returns {number} A score between 0 and 1 where higher is better.
   */
  #scorePano = (item, centerPoint) => {
    const distToTarget = turf.distance(centerPoint, turf.point(item.geometry.coordinates), { units: 'meters' });
    const distanceScore = Math.exp(-distToTarget / 10); // 0m → 1.0, 10m → 0.37, 25m → 0.08.

    // Resolution: linear in width, capped at the 12288px professional rigs. GoPro Max 5760 → 0.47, Max2 7680 → 0.63.
    const width = item.properties['pers:interior_orientation']?.sensor_array_dimensions?.[0] || 0;
    const resolutionScore = Math.min(width / 12288, 1);

    // Recency: exponential decay by age in years, 5-year scale. Fresh → 1.0, 3yr → 0.55, 8yr → 0.20. A picture whose
    // datetime won't parse scores as if it were 3 years old rather than NaN, which loses every `>` comparison and so
    // could make a box full of such pictures look like a street with no imagery at all.
    const ageYears = (Date.now() - Date.parse(item.properties.datetime)) / (365.25 * 24 * 3600 * 1000);
    const recencyScore = Number.isFinite(ageYears) ? Math.exp(-ageYears / 5) : Math.exp(-3 / 5);

    // Sequence continuity: prefer staying in the current sequence (STAC collection) for smoother navigation.
    const sequenceScore = this.#item && item.collection === this.#item.collection ? 1 : 0;

    return 0.45 * distanceScore + 0.25 * resolutionScore + 0.25 * recencyScore + 0.05 * sequenceScore;
  };

  /**
   * Filters and scores candidate pictures, returning the best one (or null if none are viable).
   * @param {Array<object>} items STAC items from a search.
   * @param {Set<string>} excludedIds Picture ids to exclude.
   * @param {object} centerPoint The target location as a turf point.
   * @returns {object|null}
   */
  #selectBestPano = (items, excludedIds, centerPoint) => {
    let best = null;
    let bestScore = -1;
    for (const item of items) {
      if (excludedIds.has(item.id)) continue;
      const score = this.#scorePano(item, centerPoint);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  };

  /**
   * Fetches the 360° pictures inside a box around a point.
   * @param {object} centerPoint The center of the search area as a turf point.
   * @param {number} radiusM Half the box's side, in meters.
   * @returns {Promise<Array<object>>} STAC items, each also stored in the id cache.
   */
  #searchNear = async (centerPoint, radiusM) => {
    const km = radiusM / 1000;
    const bbox = [
      turf.destination(centerPoint, km, 270).geometry.coordinates[0], // West
      turf.destination(centerPoint, km, 180).geometry.coordinates[1], // South
      turf.destination(centerPoint, km, 90).geometry.coordinates[0], // East
      turf.destination(centerPoint, km, 0).geometry.coordinates[1], // North
    ];
    // Newest first, so if the box holds more pictures than the limit, the ones dropped are the oldest.
    const params = new URLSearchParams({
      bbox: bbox.join(','), filter: 'field_of_view=360', sortby: '-ts', limit: '100',
    });
    const response = await fetch(`${PanoramaxViewer.API_BASE}/search?${params}`);
    if (!response.ok) throw new Error(`Panoramax search failed: HTTP ${response.status}`);
    const items = (await response.json()).features ?? [];
    for (const item of items) this.#rememberItem(item);
    return items;
  };

  #storePrefetch = (centerPoint) => {
    const entry = { centerPoint, promise: this.#searchNear(centerPoint, PanoramaxViewer.#SEARCH_RADIUS_M) };
    this.#prefetchedSearches.push(entry);
    return entry;
  };

  /**
   * Finds the nearest prefetched search to the given point, if one is close enough (within 5 m) to be useful.
   * @param {object} centerPoint The target location as a turf point.
   * @returns {{centerPoint: object, promise: Promise<Array<object>>}|null}
   */
  #findNearestPrefetch = (centerPoint) => {
    let nearest = null;
    let nearestDist = Infinity;
    for (const entry of this.#prefetchedSearches) {
      const dist = turf.distance(centerPoint, entry.centerPoint, { units: 'meters' });
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = entry;
      }
    }
    return nearestDist < 5 ? nearest : null;
  };

  // ---- Items and metadata -----------------------------------------------------------------------------------------

  /**
   * Caches a STAC item by id. Search results carry everything a move needs (assets, tile matrix, URL template,
   * sequence links), so a picture found by search is never fetched again.
   * @param {object} item
   */
  #rememberItem = (item) => {
    this.#items.set(item.id, item);
  };

  /**
   * Returns the STAC item for a picture, from the cache when a search already returned it.
   * @param {string} panoId
   * @returns {Promise<object>} Rejects with NoImageryError when the API answers 404 for the picture.
   */
  #fetchItem = async (panoId) => {
    const cached = this.#items.get(panoId);
    if (cached) return cached;
    const response = await fetch(`${PanoramaxViewer.API_BASE}/pictures/${panoId}`);
    if (response.status === 404) throw new NoImageryError(`Panoramax picture ${panoId} no longer exists.`);
    if (!response.ok) throw new Error(`Panoramax picture fetch failed: HTTP ${response.status}`);
    const item = await response.json();
    this.#rememberItem(item);
    return item;
  };

  /**
   * The tile pyramid a 360° picture publishes, which is what the renderer reads. Only the search filters pictures to
   * `field_of_view=360`; `/api/pictures/:id` doesn't, so a stored label id can name a picture with no pyramid, and
   * that has to fail the way a missing picture does rather than as a TypeError the seed fallback can't classify.
   *
   * @param {object} item The picture's STAC item.
   * @returns {object} Its first tile matrix.
   * @throws {NoImageryError} When the picture has no pyramid, tile template, or base image.
   */
  static #tileMatrix(item) {
    // Keyed by tile-matrix-set name — `geovisio` on every instance today, but read positionally so a rename or a
    // second set doesn't blank the viewer.
    const sets = item.properties?.['tiles:tile_matrix_sets'];
    const matrix = sets && Object.values(sets)[0]?.tileMatrix?.[0];
    if (!matrix || !item.asset_templates?.tiles?.href || !item.assets?.sd?.href) {
      throw new NoImageryError(`Panoramax picture ${item.id} publishes no 360° tile pyramid.`);
    }
    return matrix;
  }

  /**
   * Builds the tiles-adapter config from a STAC item, the way Panoramax's own viewer does (apiFeatureToPSVNode):
   * the SD picture as the base image, and the tile matrix + URL template for the pyramid.
   * @param {object} item
   * @returns {{baseUrl: string, width: number, cols: number, rows: number, tileUrl: Function}}
   */
  static #panoramaConfig(item) {
    const matrix = PanoramaxViewer.#tileMatrix(item);
    const template = item.asset_templates.tiles.href;
    return {
      baseUrl: item.assets.sd.href,
      width: matrix.matrixWidth * matrix.tileWidth,
      cols: matrix.matrixWidth,
      rows: matrix.matrixHeight,
      tileUrl: (col, row) => template.replace('{TileCol}', col).replace('{TileRow}', row),
    };
  }

  /**
   * The PanoData constructor params for a picture. Width/height come from the sensor when the item reports it,
   * else from the tile matrix, which spans the full sphere.
   * @param {object} item
   * @returns {object}
   */
  #panoDataParams = (item) => {
    const props = item.properties;
    const matrix = PanoramaxViewer.#tileMatrix(item);
    const dims = props['pers:interior_orientation']?.sensor_array_dimensions;
    const width = dims?.[0] || matrix.matrixWidth * matrix.tileWidth;
    return {
      panoId: item.id,
      source: this.getViewerType(),
      // parseZone keeps the capture's own offset: `datetime` is normalised to UTC, so a plain moment() would render
      // it in the reader's timezone and an evening capture would show a different day in Paris than in Seattle.
      captureDate: moment.parseZone(props.datetimetz || props.datetime),
      width,
      height: dims?.[1] || Math.round(width / 2),
      tileWidth: matrix.tileWidth,
      tileHeight: matrix.tileHeight,
      lat: item.geometry.coordinates[1],
      lng: item.geometry.coordinates[0],
      cameraHeading: props['view:azimuth'] || 0,
      cameraPitch: props['pers:pitch'] || 0,
      cameraRoll: props['pers:roll'] ?? undefined,
      copyright: props['geovisio:producer'],
      linkedPanos: [],
      history: [],
    };
  };

  /**
   * The attribution line a picture's licence obliges us to show: producer, provider, and the licence linked.
   * @param {object} item
   * @returns {{holder: string, provider: string, license: string, license_url: ?string}}
   */
  #attributionFor = (item) => {
    const id = item.properties.license;
    const known = PanoramaxViewer.#LICENSES[id];
    const licenseLink = item.links?.find((l) => l.rel === 'license')?.href;
    return {
      holder: item.properties['geovisio:producer'] || 'Panoramax contributor',
      provider: 'Panoramax',
      license: known?.name || id || 'open licence',
      license_url: licenseLink || known?.url || null,
    };
  };

  /**
   * The pictures a navigation arrow can lead to. Panoramax has no link graph of its own, so this is assembled from a
   * search around the picture to look like Street View's: the sequence neighbours (the STAC `next`/`prev` links) are
   * the road ahead and behind at whatever distance the sequence puts them, and a picture from another sequence adds
   * an arrow only when it opens a genuinely different direction — a cross street — rather than the same road from a
   * parallel pass. Without that filter a dense network (Bayonne: a picture every few meters, several sequences per
   * road) fills all eight compass sectors and the user faces a star of arrows.
   * @param {object} item The current picture.
   * @returns {Promise<Array<{panoId: string, heading: number}>>}
   */
  #findLinkedPanos = async (item) => {
    const here = turf.point(item.geometry.coordinates);
    let nearby;
    try {
      nearby = await this.#searchNear(here, PanoramaxViewer.#LINK_RADIUS_M);
    } catch (err) {
      console.warn('Panoramax link search failed:', err);
      return [];
    }
    const sequenceNeighbors = new Set(
      item.links.filter((l) => l.rel === 'next' || l.rel === 'prev').map((l) => l.href.split('/').pop()),
    );
    // A sequence neighbour the search didn't return is fetched by id, so the road ahead always has an arrow: it goes
    // missing otherwise whenever the sequence has a gap wider than the link radius, or the box is dense enough that
    // newer pictures from other sequences fill the search's page limit ahead of it.
    const searched = new Set(nearby.map((n) => n.id));
    const missing = [...sequenceNeighbors].filter((id) => !searched.has(id));
    const fetched = await Promise.all(missing.map((id) => this.#fetchItem(id).catch(() => null)));
    const candidates = [];
    for (const candidate of [...nearby, ...fetched.filter(Boolean)]) {
      if (candidate.id === item.id) continue;
      const there = turf.point(candidate.geometry.coordinates);
      const dist = turf.distance(here, there, { units: 'meters' });
      const inSequence = sequenceNeighbors.has(candidate.id);
      // Co-located pictures aren't a move; past the link radius only the road itself is still somewhere to go.
      if (dist < 2 || (dist > PanoramaxViewer.#LINK_RADIUS_M && !inSequence)) continue;
      const heading = (turf.bearing(here, there) + 360) % 360;
      candidates.push({ panoId: candidate.id, heading, dist, item: candidate, inSequence });
    }
    const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

    // The road itself: the previous and next pictures of this sequence, whatever their distance.
    const links = candidates.filter((c) => c.inSequence);
    // Cross streets: one picture per 90° sector among those far enough away and off the road's own axis, chosen
    // with the picker's own score so the arrow lands on the freshest, sharpest nearby picture rather than merely the
    // closest — the same recency-over-proximity preference the Mapillary picker applies.
    const bySector = new Map();
    for (const candidate of candidates) {
      if (candidate.inSequence || candidate.dist < PanoramaxViewer.#MIN_CROSS_LINK_M) continue;
      if (links.some((l) => angleBetween(l.heading, candidate.heading) < PanoramaxViewer.#CROSS_LINK_MIN_ANGLE)) {
        continue;
      }
      const sector = Math.floor(candidate.heading / 90);
      const score = this.#scorePano(candidate.item, here);
      const current = bySector.get(sector);
      if (!current || score > current.score) bySector.set(sector, { ...candidate, score });
    }
    return [...links, ...bySector.values()].map(({ panoId, heading }) => ({ panoId, heading }));
  };

  // ---- Angles -----------------------------------------------------------------------------------------------------

  /** The camera's compass heading for the current picture, in degrees. */
  #azimuth = () => this.#item?.properties['view:azimuth'] || 0;

  /** The camera's pitch for the current picture, in degrees. */
  #cameraPitch = () => this.#item?.properties['pers:pitch'] || 0;

  /**
   * Converts a heading (0 = true north, clockwise) to PSV's yaw in radians, whose 0 is the image centre.
   * @param {number} heading
   * @returns {number}
   */
  #headingToYaw = (heading) => util.math.toRadians(((heading - this.#azimuth() + 540) % 360) - 180);

  /**
   * Inverse of #headingToYaw — converts PSV yaw in radians to a true-north heading in [0, 360).
   * @param {number} yaw
   * @returns {number}
   */
  #yawToHeading = (yaw) => (this.#azimuth() + util.math.toDegrees(yaw) + 360) % 360;

  /** The live width:height ratio PSV renders at, falling back to the container's until the first render. */
  #aspect = () => this.#viewer?.state?.aspect || this._viewportAspect();

  /**
   * PSV's zoom range is defined on the vertical field of view, while our zoom levels are horizontal-fov terms, so
   * the bounds depend on the viewport's aspect ratio: zoom 3 at the narrow end, zoom 1 (clamped to 90°) at the wide.
   * @returns {{min: number, max: number}} Vertical fovs in degrees.
   */
  #fovLimits = () => {
    const aspect = this.#aspect();
    return {
      min: util.pano.hFovToVFov(util.pano.zoomToFov(3), aspect),
      max: Math.min(util.pano.hFovToVFov(util.pano.zoomToFov(1), aspect), PanoramaxViewer.#MAX_VERTICAL_FOV),
    };
  };
}
