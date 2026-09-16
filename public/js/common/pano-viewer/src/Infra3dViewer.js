/**
 * Infra3D implementation of the PanoViewer interface.
 * Docs: https://developers.infra3d.com/javascript-api/reference/classes/Viewer.Viewer.html
 */
class Infra3dViewer extends PanoViewer {
  /** The `pano_data.source` value, so code outside the viewer can name this source without holding the class. */
  static SOURCE = 'infra3d';

  /** How long initViewer gets; the SDK reports its failures by never resolving. */
  static INIT_TIMEOUT_MS = 10000;

  /** Lead time for the token renewal: wide enough to fit every TOKEN_REFRESH_RETRY_MS retry before expiry. */
  static TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;

  /** Waits between failed renewal attempts; the last one repeats until the token expires. */
  static TOKEN_REFRESH_RETRY_MS = [30 * 1000, 60 * 1000, 120 * 1000];

  /** sessionStorage flag: this tab already used its one reload for an initViewer timeout. */
  static #INIT_RELOADED_KEY = 'infra3dViewerInitReloaded';

  #refreshTimer;

  /** Consecutive failed renewal attempts. */
  #refreshAttempts = 0;

  /** Expiry of the token the SDK holds, in epoch ms; null when unreadable. */
  #tokenExpiryMs = null;

  constructor() {
    super();
    this.manager = undefined; // Kept for setTokens() when the access token is renewed.
    this.viewer = undefined;
    this.prevNode = null;
    this.currNode = null; // This becomes null while waiting to load subsequent panos.
    this.currPanoData = undefined; // This holds onto the data for the prior pano while we are loading the next one.
  }

  /**
   * See PanoViewer.initialize().
   * @param {HTMLElement} canvasElem
   * @param {Record<string, any>} [panoOptions]
   * @returns {Promise<void>}
   */
  async initialize(canvasElem, panoOptions = {}) {
    this.manager = await infra3dapi.init(canvasElem.id, panoOptions.accessToken);

    // Each city has their own project_UID. Faster to hard code it rather than fetching projects in real time. A
    // project is one commissioned drive (a single campaign), so a city getting new imagery means a new project whose
    // id has to be swapped in here -- which is also why nothing polls Infra3d for imagery age (see
    // ImageryFreshnessService.pollImageryAges).
    const projectId = window.cityId === 'winterthur-infra3d'
      ? 'ab6045da-46b4-44d2-8123-e19c7cdbe7ea'
      : 'bd8196f8-dbe5-4e67-849f-977452fe7587';

    // Docs on Infra3D viewer options:
    // https://developers.infra3d.com/custom-content/reference/classes/Manager.Manager.html#initViewer
    const disableDefaultUi = 'disableDefaultUi' in panoOptions ? panoOptions.disableDefaultUi : true;
    let panoOpts = {
      project_uid: projectId,
      show_topbar: !disableDefaultUi,
      show_toolbar: !disableDefaultUi,
      show_mapWindow: !disableDefaultUi,
      map_expand: !disableDefaultUi, // Only used if show_mapWindow is true
      show_cockpit: !disableDefaultUi,

      defaultNavigation: false, // If true, we show infra3D viewer's navigation arrows
      zoomControl: true,
    };
    panoOpts = { ...panoOpts, ...panoOptions };

    // initViewer reports failure by never settling. A reload is the recovery (it also brings a fresh token, one
    // reason init fails), but a second timeout in the same tab means it didn't help, so that one is surfaced as an
    // ordinary failure and PanoManager shows its retry message instead of reloading forever.
    let initError;
    this.viewer = await Promise.race([
      this.manager.initViewer(panoOpts),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Infra3d initViewer did not finish within ${Infra3dViewer.INIT_TIMEOUT_MS} ms`)),
        Infra3dViewer.INIT_TIMEOUT_MS,
      )),
    ]).catch((err) => {
      initError = err;
    });
    if (!this.viewer) await Infra3dViewer.#recoverFromInitFailure(initError);
    Infra3dViewer.#setInitReloadFlag(false);

    // Handle a few other configs that need to be handled after initialization.
    if (panoOpts.defaultNavigation === false) {
      this.hideNavigationArrows();
    }
    if (panoOpts.zoomControl === false) {
      this.#disableUserZoom();
    }

    // Initialize pano at the desired location.
    await this._moveToInitialLocation(panoOpts);

    // Restrict all subsequent navigation to 360° imagery, since Infra3D datasets mix in flat mono/stereo photos.
    // The SDK is a mapillary-js fork, so this works like MapillaryViewer's spherical-only setFilter: flat images
    // are dropped from linked images (nav arrows) and position-based searches (setLocation) before we ever move.
    // Set after the initial move because the first image's metadata loads progressively, so the filter could
    // exclude every candidate during the initial search; #filterNonPanoramicImages stays as a backstop for the
    // initial image and for direct moveToKey calls, which ignore graph filters.
    await this.viewer._sdk_viewer.setFilter(['in', 'cameraType', 'calotte', 'cubemap']);

    // Prevent keyboard shortcuts from moving the pano.
    const preventShortcuts = (e) => {
      if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'].indexOf(e.code) > -1) {
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', preventShortcuts, { capture: true });

    // Set up event listeners. We hold a list and go through each listener ourselves to control their ordering.
    const panoChangeListener = async (e) => {
      for (const listener of this.panoChangedListeners) await listener(e);
    };
    const povChangeListener = async (e) => {
      for (const listener of this.povChangedListeners) await listener(e);
    };
    this.viewer._sdk_viewer.on('nodechanged', panoChangeListener);
    this.viewer.on('panorotationchanged', povChangeListener);

    this.#scheduleTokenRefresh(panoOptions.accessToken);

    // If defaultNavigation is enabled, we need a pano_changed listener to record the pano metadata after moving.
    if (panoOpts.defaultNavigation) {
      this.addListener('pano_changed', (node) => {
        return this.#finishRecordingMetadata(node);
      });
    }
  };

  /**
   * Reloads the page once for an initViewer that never came up, or throws if this tab already tried that. Logged via
   * webpage_activity because no viewer exists yet for a tracker; its synchronous default matters, a reload follows.
   * @param {*} err - What the init race rejected with.
   * @returns {Promise<never>} Either reloads the page or throws.
   */
  static async #recoverFromInitFailure(err) {
    const alreadyReloaded = Infra3dViewer.#readInitReloadFlag();
    window.logWebpageActivity?.(`PanoViewer_InitTimeout_source=infra3d_reloading=${!alreadyReloaded}`);
    if (alreadyReloaded) {
      Infra3dViewer.#setInitReloadFlag(false);
      throw err instanceof Error ? err : new Error(String(err));
    }
    Infra3dViewer.#setInitReloadFlag(true);
    window.location.reload();
    await new Promise(() => {}); // reload() doesn't halt the script, and nothing below can run without a viewer.
  }

  static #readInitReloadFlag() {
    try {
      return window.sessionStorage.getItem(Infra3dViewer.#INIT_RELOADED_KEY) === '1';
    } catch {
      return false;
    }
  }

  static #setInitReloadFlag(reloaded) {
    try {
      if (reloaded) window.sessionStorage.setItem(Infra3dViewer.#INIT_RELOADED_KEY, '1');
      else window.sessionStorage.removeItem(Infra3dViewer.#INIT_RELOADED_KEY);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); then every timeout reloads.
    }
  }

  /**
   * Schedules the background renewal of the SDK's access token. Cognito issues them for an hour and the SDK has no
   * refresh flow, so a session longer than that went black with nothing logged. The expiry is read from the token
   * itself; renewal runs TOKEN_REFRESH_LEAD_MS before it, or right away when the page arrived inside that window.
   * @param {string} token - The token the SDK currently holds.
   */
  #scheduleTokenRefresh(token) {
    clearTimeout(this.#refreshTimer);
    this.#refreshAttempts = 0;
    this.#tokenExpiryMs = util.pano.jwtExpiryMs(token);
    if (this.#tokenExpiryMs === null) {
      this._fireDiagnostic('TokenUnreadable');
      return;
    }
    const delay = Math.max(0, this.#tokenExpiryMs - Infra3dViewer.TOKEN_REFRESH_LEAD_MS - Date.now());
    this.#refreshTimer = setTimeout(() => this.#refreshToken(), delay);
  }

  /**
   * Renews the access token right now instead of at the scheduled time. A QA hook: the scheduled renewal is an hour
   * away on a fresh page, and this is what lets a console session prove the in-place swap works against real Infra3d.
   * @returns {Promise<void>} Resolves once the attempt has been logged, whether it succeeded or not.
   */
  refreshAccessTokenNow() {
    clearTimeout(this.#refreshTimer);
    return this.#refreshToken();
  }

  /**
   * Fetches a fresh access token and hands it to the SDK in place, retrying on failure until the old one expires.
   * manager.setTokens() is the SDK's own path: its wrapper pushes the token into the navigator's data provider and
   * the scene's image provider. The shape is the one the SDK builds in init(); the empty refresh_token is why it
   * can't renew alone. Past expiry the failure is final (TokenExpired) and Explore tells the user to reload.
   * @returns {Promise<void>}
   */
  async #refreshToken() {
    if (!this.canvasElem?.isConnected) return; // A closed popup's viewer has nothing to keep alive.
    try {
      const response = await fetch('/imageryAccessToken', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { token, expires_at: expiresAt } = await response.json();
      const expiryMs = util.pano.jwtExpiryMs(token) ?? Date.parse(expiresAt);
      const expiresInSec = Math.max(1, Math.round((expiryMs - Date.now()) / 1000));
      this.manager.setTokens({
        access_token: token, expires_in: expiresInSec, id_token: '', refresh_token: '', token_type: 'Bearer',
      });
      this._fireDiagnostic('TokenRefreshed', { remainingSec: expiresInSec, attempt: this.#refreshAttempts + 1 });
      this.#scheduleTokenRefresh(token);
    } catch (err) {
      this.#refreshAttempts += 1;
      this._fireDiagnostic('TokenRefreshFailed', { attempt: this.#refreshAttempts, reason: err?.message ?? err });
      if (Date.now() >= this.#tokenExpiryMs) {
        this._fireDiagnostic('TokenExpired', { attempts: this.#refreshAttempts });
        return;
      }
      const retries = Infra3dViewer.TOKEN_REFRESH_RETRY_MS;
      const wait = retries[Math.min(this.#refreshAttempts, retries.length) - 1];
      this.#refreshTimer = setTimeout(() => this.#refreshToken(), Math.min(wait, this.#tokenExpiryMs - Date.now()));
    }
  }

  getPanoId = () => {
    return this.currPanoData.getPanoId();
  };

  getPosition = () => {
    return { lat: this.currPanoData.getProperty('lat'), lng: this.currPanoData.getProperty('lng') };
  };

  setLocation = async (latLng, excludedPanos = new Set()) => {
    this.prevNode = this.currNode;
    this.currNode = null;

    // Convert from WGS84 to Web Mercator (EPSG:3857), which is what Infra3D uses.
    const wgs84 = 'EPSG:4326';
    const webMercator = 'EPSG:3857';
    const [easting, northing] = proj4(wgs84, webMercator, [latLng.lng, latLng.lat]);
    const newPosition = { easting, northing };

    // Using the internal function that returns a node, since the usual one in the API does not.
    // TODO We should be checking if the new location is within STREETVIEW_MAX_DISTANCE. But we always have imagery
    //      in the zurich test city, so this should never be a problem.
    const node = await this.viewer._sdk_viewer.movePosition(newPosition, 3857);
    const panoData = await this.#finishRecordingMetadata(node);
    await this.#filterNonPanoramicImages(node);
    return this.#filterExcludedPanos(panoData, excludedPanos);
  };

  // TODO This version includes non-panoramic imagery, but does not require loading images for excluded panos. We're
  //      waiting to hear back from Andreas on whether there's a way to do filtering. If so, use this method instead.
  // setLocation = async (latLng, excludedPanos = new Set()) => {
  //     // Use imagesByKNN$ to find the closest image to the lat/lng.
  //     const closestPano = new Promise((resolve, reject) => {
  //         this.viewer._sdk_viewer._navigator._api.imagesByKNN$(latLng.lng, latLng.lat, 4326).subscribe({
  //             next: (data) => {
  //                 if (excludedPanos.has(data.key)) reject(`Excluded pano: ${data.key}`);
  //                 else resolve(data.key);
  //                 },
  //             error: (err) => reject(err),
  //         });
  //     });
  //
  //     // TODO We should be checking if the new location is within STREETVIEW_MAX_DISTANCE. But we always have imagery
  //     //      in the zurich test city, so this should never be a problem. But can we get that info from the KNN data?
  //     return closestPano.then(this.setPano);
  // };

  setPano = async (panoId) => {
    this.prevNode = this.currNode;
    this.currNode = null;
    const node = await this.viewer._sdk_viewer.moveToKey(panoId);
    const panoData = await this.#finishRecordingMetadata(node);
    await this.#filterNonPanoramicImages(node);
    return panoData;
  };

  /**
   * See PanoViewer.lookupPanoPosition(). The SDK is a mapillary-js fork, so as there, every spatial-edge target is
   * already a node in its graph, position included. A key the graph doesn't hold answers null (a missing crumb; each
   * Infra3d city is one commissioned drive, so there is no cheap by-key fallback worth adding).
   */
  lookupPanoPosition = (panoId) => {
    let graph = null;
    try {
      const subscription = this.viewer._sdk_viewer._navigator.graphService._graph$.subscribe((g) => {
        graph = g;
      });
      subscription.unsubscribe();
    } catch {
      return Promise.resolve(null);
    }
    if (!graph || !graph.hasNode(panoId)) return Promise.resolve(null);
    const { lat, lon } = graph.getNode(panoId).latLon;
    return Promise.resolve({ lat, lng: lon });
  };

  supportsLocationSearch = () => true;

  /**
   * See PanoViewer.findPanoNear(). Uses the SDK's nearest-frame query (`imagesByKNN$`, the same HTTP request its
   * own movePosition$ starts from) rather than movePosition(), which setLocation() relies on and which moves the
   * viewer. The frame comes back with its position and camera type, so nothing is loaded.
   *
   * Two gaps against setLocation(), both in the safe direction (a missing crumb, never a wrong one): KNN returns the
   * single nearest frame of any camera type, so a flat mono/stereo photo nearest the point hides a pano frame a
   * metre behind it, and the query has no radius, so this applies the setLocation() radius the SDK never does.
   */
  findPanoNear = async (latLng, excludedPanos = new Set()) => {
    const nearest = await PanoViewer._withTimeout(
      new Promise((resolve, reject) => {
        this.viewer._sdk_viewer._navigator._api.imagesByKNN$(latLng.lng, latLng.lat, 4326)
          .subscribe({ next: resolve, error: reject });
      }),
      PanoViewer.FIND_PANO_TIMEOUT_MS, `Infra3d nearest frame to ${latLng.lat},${latLng.lng}`,
    ).catch((err) => {
      // The SDK rejects an empty neighbourhood with a bare string, not an Error; that one is an answer.
      if (err === 'No frame found') return null;
      throw err instanceof Error ? err : new Error(String(err));
    });
    if (!nearest) return null;
    // Mirror #filterNonPanoramicImages: only 360° frames are places Explore can stand.
    if (!['calotte', 'cubemap'].includes(nearest.camera_projection_type)) return null;
    const { lat, lon: lng } = nearest.l;
    const metersAway = turf.distance(
      turf.point([latLng.lng, latLng.lat]), turf.point([lng, lat]), { units: 'meters' },
    );
    if (metersAway > svl.STREETVIEW_MAX_DISTANCE) return null;
    if ([...excludedPanos].some((pano) => pano.getPanoId() === nearest.key)) return null;
    return { panoId: nearest.key, lat, lng };
  };

  /**
   * If the image we arrived at isn't a 360° pano, move back to the previous pano and throw an error.
   *
   * Infra3D datasets mix panoramic imagery ('calotte'/'cubemap' stream types) with flat perspective photos
   * ('mono'/'stereo'), which the viewer renders as a 2D pan/zoom image. Our POV math assumes a 360° pano (e.g.
   * getCameraView() returns {zoom, panX, panY} instead of {lat, lon, fov} on flat images), so we treat flat images
   * like excluded panos: bounce back and reject so that callers retry elsewhere.
   *
   * Only a rejection backed by a real cameraType is a NoImageryError, since that is what lets a sweep conclude the
   * street is out of imagery rather than report a provider failure (#4918). The guessed case stays an ordinary Error:
   * this runs on the page's seed image, where a wrong guess would condemn a street with good imagery and reload.
   * @param {Record<string, any>} node - Infra3d's internal node object for the image we just moved to
   * @returns {Promise<void>} Rejects if the image isn't panoramic; resolves otherwise
   */
  #filterNonPanoramicImages = async (node) => {
    // cameraType can be missing on the first image loaded on a page (its metadata loads progressively); in that
    // case, decide based on the camera mode that the scene chose for the rendered image (pano vs flat pan/zoom).
    const cameraTypeKnown = node.cameraType !== undefined;
    const isPanoramic = cameraTypeKnown
      ? ['calotte', 'cubemap'].includes(node.cameraType)
      : this.viewer.getCameraView().type === 'pano';
    if (isPanoramic) return;

    // The viewer is already displaying the flat image, so move the display back to the previous pano. Using the raw
    // moveToKey rather than setPano() so that we don't re-run this filter or shuffle prevNode mid-recovery.
    if (this.prevNode) {
      const prevNode = await this.viewer._sdk_viewer.moveToKey(this.prevNode.frame.id);
      await this.#finishRecordingMetadata(prevNode);
    }
    const message = `Non-panoramic image: ${node.frame.id}`;
    throw cameraTypeKnown ? new NoImageryError(message) : new Error(message);
  };

  /**
   * If the new pano we arrived at is in the excluded list, go back to the previous one and throw an error.
   *
   * NoImageryError, matching GsvViewer: the search succeeded and there is nothing here the caller can use, so a
   * dead end whose last panos the user already stood on stays recognizable as one (#4918).
   * @param {PanoData} newPanoData - The pano data for the new panorama
   * @param {Set<PanoData>} [excludedPanos=new Set()] - Set of PanoData objects that are not valid images to move to
   * @returns {Promise<PanoData>} The pano data, or a rejection with NoImageryError if the pano is excluded.
   */
  #filterExcludedPanos = (newPanoData, excludedPanos) => {
    // If the pano given is in the excluded list, treat it as if the API call itself had returned nothing.
    const excludedPanoIds = new Set([...excludedPanos].map((p) => p.getPanoId()));
    if (excludedPanoIds.has(newPanoData.getPanoId())) {
      return this.setPano(this.prevNode.frame.id).then(() => {
        throw new NoImageryError(`Excluded pano: ${newPanoData.getPanoId()}`);
      });
    } else {
      return Promise.resolve(newPanoData);
    }
  };

  /**
   * Ensures that all image metadata has been saved before letting setPano or setLocation resolve.
   *
   * @param {Record<string, any>} node - Infra3d's internal node object.
   * @returns {Promise<PanoData>}
   */
  #finishRecordingMetadata = async (node) => {
    this.currNode = node;
    // Make sure that the node has the linked panos initialized (in node.spatialEdges.edges).
    await new Promise((resolve) => {
      // Links should be initialized always, except for the first pano. So we can just use them.
      if (node.spatialEdges.cached) {
        resolve(undefined);
      } else {
        // Listen for the event that fires when the links are updated. Only needed when loading first image.
        // NOTE the subscribe architecture is coming from RxJS.
        const linksListener = node.spatialEdges$.subscribe((spatialEdges) => {
          if (spatialEdges.cached) {
            linksListener.unsubscribe(); // One-shot listener: only needed until the links are cached.
            resolve(undefined);
          }
        });
      }
    });

    const linkedPanos = node.spatialEdges.edges
      .filter((link) => link.data.direction === 9) // Filters out link to camera on back of car for now.
      .map((link) => {
        // The worldMotionAzimuth is defined as "the counter-clockwise horizontal rotation angle from the
        // X-axis in a spherical coordinate system", so we need to adjust it to be like a compass heading.
        return {
          panoId: link.to,
          heading: util.math.toDegrees((Math.PI / 2 - link.data.worldMotionAzimuth) % (2 * Math.PI)),
        };
      });

    // Now that all the data is available, we can fill the currPanoData object and say that the pano has loaded.
    const panoDataParams = {
      panoId: node.frame.id,
      source: this.getViewerType(),
      captureDate: moment(node.frame.timestamp),
      width: 4 * node.frame.framedatameta.imagewidth, // width/height are for only one side of the cube map
      height: 2 * node.frame.framedatameta.imageheight,
      tileWidth: node.frame.framedatameta.tilesize,
      tileHeight: node.frame.framedatameta.tilesize,
      lat: node.frame.latitude,
      lng: node.frame.longitude,
      cameraHeading: this._getHeading(node.frame.omega, node.frame.phi),
      cameraPitch: this._getPitch(node.frame.omega, node.frame.phi),
      // TODO can we find a camera roll?
      copyright: 'City of Zurich and iNovitas AG',
      history: [], // No history to pull from for Infra3D right now.
      linkedPanos,
    };

    this.currPanoData = new PanoData(panoDataParams);
    return this.currPanoData;
  };

  getLinkedPanos = () => {
    return this.currPanoData.getProperty('linkedPanos');
  };

  getPov = () => {
    const currentView = this.viewer.getCameraView();
    const node = this.currNode || this.prevNode;

    // Calculate the orientation of the camera.
    const horizontalOrientation = this._getHeading(node.frame.omega, node.frame.phi);
    const verticalOrientation = this._getPitch(node.frame.omega, node.frame.phi);

    // Add the orientation of the image to the camera.
    const horizontalAzimuth = (horizontalOrientation + currentView.lon) % 360;
    const verticalAzimuth = (verticalOrientation + currentView.lat) % 360;

    // Convert from vertical fov to horizontal fov, then convert to a zoom level that you'd see in GSV.
    // Unlike Mapillary this reads the DOM on a hot path (getPov runs on every pov_changed): Infra3D's SDK has no
    // render camera to cache an aspect from. The read lands in the same layout batch as PanoMarker.draw()'s own
    // container measurement, so it forces no extra reflow; if that changes, cache it and refresh on resize.
    const horizontalFov = util.pano.vFovToHFov(currentView.fov, this._viewportAspect());
    const zoom = util.pano.fovToZoom(horizontalFov);

    return { heading: horizontalAzimuth, pitch: verticalAzimuth, zoom };
  };

  setPov = (pov) => {
    const node = this.currNode || this.prevNode;

    // Calculate the base orientation from the node's position.
    const baseHeading = this._getHeading(node.frame.omega, node.frame.phi);
    const basePitch = this._getPitch(node.frame.omega, node.frame.phi);

    // Calculate the required camera adjustment to reach target orientation.
    // Since: target = base + cameraAdjustment, therefore: cameraAdjustment = target - base.
    const requiredLng = (pov.heading - baseHeading + 360) % 360;
    const requiredLat = (pov.pitch - basePitch + 360) % 360;

    // Convert to the range expected by setCameraView (typically -180 to 180).
    const viewLng = requiredLng > 180 ? requiredLng - 360 : requiredLng;
    const viewLat = requiredLat > 180 ? requiredLat - 360 : requiredLat;

    // If zoom was provided, convert to a horizontal fov, and then convert to the vertical fov used by Infra3D.
    let verticalFov;
    if (pov.zoom) {
      const horizontalFov = util.pano.zoomToFov(pov.zoom);
      verticalFov = util.pano.hFovToVFov(horizontalFov, this._viewportAspect());
    } else {
      verticalFov = this.viewer.getCameraView().fov;
    }

    // Set the camera view, smooth panning=false.
    this.viewer.setCameraView({
      type: 'pano',
      lat: viewLat,
      lon: viewLng,
      fov: verticalFov,
    }, false);
  };

  // Called getHorizontalOrientation in the code we were sent.
  _getHeading(omegaDeg, phiDeg) {
    const omega = (omegaDeg * Math.PI) / 180;
    const phi = (phiDeg * Math.PI) / 180;
    const x = -1 * Math.sin(phi);
    const y = Math.sin(omega) * Math.cos(phi);

    let azi = 0;

    if (x > 0 && y > 0) {
      azi = (Math.atan(x / y) * 180) / Math.PI;
    } else if (x > 0 && y < 0) {
      azi = ((Math.atan(x / y) + Math.PI) * 180) / Math.PI;
    } else if (x < 0 && y < 0) {
      azi = ((Math.atan(x / y) + Math.PI) * 180) / Math.PI;
    } else if (x < 0 && y > 0) {
      azi = ((Math.atan(x / y) + 2 * Math.PI) * 180) / Math.PI;
    }

    return azi;
  };

  // Called getVerticalOrientation in the code we were sent.
  _getPitch(omegaDeg, phiDeg) {
    const omega = (omegaDeg * Math.PI) / 180;
    const phi = (phiDeg * Math.PI) / 180;
    const x = -1 * Math.sin(phi);
    const y = Math.sin(omega) * Math.cos(phi);
    const z = Math.cos(omega) * Math.cos(phi);

    return (Math.atan(z / Math.sqrt(x * x + y * y)) * 180) / Math.PI;
  };

  #disableUserZoom = () => {
    this.viewer.setUserInteraction(true, false); // first option is panning, second is zooming
  };

  hideNavigationArrows = () => {
    this.viewer._sdk_viewer.deactivateComponent('direction');
  };

  showNavigationArrows = () => {
    this.viewer._sdk_viewer.activateComponent('direction');
  };

  resize = () => {
    // The SDK's own wrapper watches the container with a *debounced* ResizeObserver, but the PanoViewer contract
    // promises an immediate re-measure (rotation and viewer-swap paths call this expecting the next frame to be
    // right), so delegate to the mapillary-js-fork viewer's resize directly rather than waiting out the debounce.
    this.viewer._sdk_viewer.resize();
  };
}
