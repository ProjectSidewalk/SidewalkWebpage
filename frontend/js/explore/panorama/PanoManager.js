/**
 * Owns Explore's pano viewer: loads it at the session's start, moves it, keeps its view in bounds, and announces each
 * new pano (onPanoChanged) and view (onPovChanged) to whatever draws on top. Built synchronously with the load under
 * way: `ready` says when there is a viewer, so only what needs the first pano waits for it.
 */

import * as turf from '@turf/turf';
import i18next from 'i18next';
import { Gate } from '../../common/Gate.js';
import { GsvViewer } from '../../common/pano-viewer/GsvViewer.js';
import { MapillaryViewer } from '../../common/pano-viewer/MapillaryViewer.js';
import { NoImageryError } from '../../common/pano-viewer/NoImageryError.js';
import { createPanoViewerLogo } from '../../common/pano-viewer/PanoViewerLogo.js';
import { util } from '../../common/utilities.js';
import { StreetSweep } from '../navigation/StreetSweep.js';
import { NoImageryFlagGuard } from './NoImageryFlagGuard.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../alert/AlertController.js').AlertController} AlertController */
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../Main.js').StreetviewUi} StreetviewUi */
/** @typedef {import('../../common/pano-viewer/PanoData.js').PanoData} PanoData */
/** @typedef {import('../../common/pano-viewer/PanoStore.js').PanoStore} PanoStore */
/** @typedef {import('../../common/pano-viewer/PanoViewer.js').PanoViewer} PanoViewer */
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

/**
 * Where the viewer opens.
 * @typedef {object} PanoSeed
 * @property {string} [startPanoId] - A pano to try first; the lat/lng is its fallback.
 * @property {number} [startLat] - A starting latitude; the fallback if startPanoId fails to load.
 * @property {number} [startLng] - A starting longitude.
 * @property {{heading: number, pitch: number, zoom: number}} [startPov] - A POV to face after loading.
 */

export class PanoManager {
  // Closer than this (m), the seed's projection onto the street is the seed itself, not a new place to look.
  static #SAME_POINT_M = 1;

  // Set when a load gives up on its street, and read once by the load that follows. The reload destroys the alert
  // banner, so the explanation has to outlive it (#4918). Holds the given-up street's id because assignment picks at
  // random among the highest-priority streets and the reported one is still among them, so the follow-up load can
  // land back on it — and the toast about being moved elsewhere must only fire when the street actually changed.
  static #STREET_SKIPPED_KEY = 'sidewalk.streetSkippedOnLoad';

  #ui;
  #config;
  #panoStore;
  #tracker;
  #alertController;
  #panoCanvas;

  /** @type {?PanoViewer} The live viewer, once load() has it. */
  #panoViewer = null;

  /** @type {Array<(panoData: PanoData) => void>} */
  #panoChangedListeners = [];

  /** @type {Array<(heading: number) => void>} */
  #povChangedListeners = [];

  /**
   * Whether the labeler may turn the view: held by a move in flight and by a pop-up.
   * @type {Gate}
   */
  panning = new Gate();

  /**
   * Whether there is a viewer. False means no usable imagery was found and a message or a redirect has already been
   * arranged; nothing that needs the viewer should be built.
   * @type {Promise<boolean>}
   */
  ready;

  properties = {
    maxPitch: 0,
    minPitch: -35,
    minHeading: undefined,
    maxHeading: undefined,
  };

  #panoLinksClickable = false;
  #linksListener = null;
  #linksClearanceObserver = null;
  #mapillaryAttributionArrivalObserver = null;

  /**
   * Starts loading the viewer at the seed (`ready` says when it is there) and has the tracker stamp each action with
   * the pano on screen from here on.
   * @param {StreetviewUi} ui - The pano area's elements.
   * @param {ExploreConfig} config - Names the viewer class and the token it loads imagery with.
   * @param {PanoStore} panoStore - Keeps the metadata of every pano seen.
   * @param {Tracker} tracker
   * @param {AlertController} alertController - Tells the labeler when imagery fails to load.
   * @param {PanoSeed} seed - Where to open. A pano seed is tried first; the lat/lng (plus backups sampled along the
   *   street) doubles as its fallback, so a dead pano isn't misreported as a street with no imagery (#4635).
   * @param {{task: Task, missionId: number}} errorParams - The street and mission, in case the start has no imagery.
   */
  constructor(ui, config, panoStore, tracker, alertController, seed, errorParams) {
    this.#ui = ui;
    this.#config = config;
    this.#panoStore = panoStore;
    this.#tracker = tracker;
    this.#alertController = alertController;
    this.#panoCanvas = ui.pano;
    tracker.trackPano(this);
    this.ready = this.#load(seed, errorParams);
  }

  /** @returns {?PanoViewer} The live viewer, or null until load() has one. */
  get panoViewer() {
    return this.#panoViewer;
  }

  /** @returns {{heading: number, pitch: number, zoom: number}} The viewer's current point of view. */
  getPov() {
    return this.#panoViewer.getPov();
  }

  /** @returns {{lat: number, lng: number}} Where the viewer stands. */
  getPosition() {
    return this.#panoViewer.getPosition();
  }

  /** @returns {string} The pano on screen. */
  getPanoId() {
    return this.#panoViewer.getPanoId();
  }

  /**
   * Told each time a pano has loaded, with its metadata.
   * @param {(panoData: PanoData) => void} listener
   */
  onPanoChanged(listener) {
    this.#panoChangedListeners.push(listener);
  }

  /**
   * Told each time the view changes, with its heading. Also right after each pano change.
   * @param {(heading: number) => void} listener
   */
  onPovChanged(listener) {
    this.#povChangedListeners.push(listener);
  }

  /**
   * Backup starting points for when the seed has no usable imagery, nearest the seed first.
   *
   * The seed isn't always on the street. An address drop-in (#4451) passes the searched point, which can sit up to
   * `exploreAddressMaxDistM` off it, and a label card's "Explore here" passes the label's own position. So the first
   * backup is the seed's projection onto the street, and the rest of the street is then sampled outward from there.
   * Otherwise a seed rejected for having no imagery within the radius, or a pano beyond it (#5114), would send the
   * user to whichever end of the street the samples started from, however far that is from where they asked to go.
   * Points are spaced at moveForward()'s increment and include the street's endpoint, so the whole street is checked
   * before we give up and report it as having no imagery; with a seed at the street's start, that is start to end.
   *
   * @param {GeoJSON.Feature<GeoJSON.LineString>} street - The street geometry, oriented start to end.
   * @param {{lat: number, lng: number}} end - The street's end coordinate, sampled last among equals.
   * @param {{lat: number, lng: number}} [seed] - Where the load was asked to start; omitted, the order is start to end.
   * @returns {Array<{lat: number, lng: number}>} Points on the street, nearest the seed (along the street) first.
   */
  static backupPointsAlongStreet(street, end, seed) {
    const streetLength = turf.length(street); // km
    const samples = [];
    for (let dist = StreetSweep.DIST_INCREMENT; dist < streetLength; dist += StreetSweep.DIST_INCREMENT) {
      const point = turf.along(street, dist);
      samples.push({ km: dist, latLng: { lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] } });
    }
    samples.push({ km: streetLength, latLng: end });
    if (!seed) return samples.map((sample) => sample.latLng);

    const seedPoint = turf.point([seed.lng, seed.lat]);
    const projection = turf.nearestPointOnLine(street, seedPoint);
    const seedKm = projection.properties.location;
    // Array.prototype.sort is stable, so equidistant samples keep their start-to-end order.
    const ordered = samples.sort((a, b) => Math.abs(a.km - seedKm) - Math.abs(b.km - seedKm));
    // A seed already on the street was just tried at that very spot, so asking there again would be a wasted request.
    if (turf.distance(seedPoint, projection, { units: 'meters' }) < PanoManager.#SAME_POINT_M) {
      return ordered.map((sample) => sample.latLng);
    }
    // The projection leads; a grid point on top of it would only repeat that request.
    const sameSpotKm = PanoManager.#SAME_POINT_M / 1000;
    const [lng, lat] = projection.geometry.coordinates;
    return [{ lat, lng }, ...ordered.filter((s) => Math.abs(s.km - seedKm) >= sameSpotKm).map((s) => s.latLng)];
  }

  /**
   * Records the street this load gave up on, so the next one can explain what happened.
   * @param {number} streetEdgeId - The street the failed load was assigned.
   */
  static #rememberStreetSkipped(streetEdgeId) {
    try {
      window.sessionStorage?.setItem(PanoManager.#STREET_SKIPPED_KEY, String(streetEdgeId));
    } catch {
      // An unwritable store costs the labeler an explanation, which is not worth failing the skip over.
    }
  }

  /**
   * The street the load before this one gave up on, if any.
   *
   * Reading clears the notice, so the explanation appears once, on arrival, rather than on every later load.
   *
   * @returns {number|null} The given-up street's id, or null when the preceding load ended normally.
   */
  static consumeStreetSkippedNotice() {
    try {
      const stored = Number.parseInt(window.sessionStorage?.getItem(PanoManager.#STREET_SKIPPED_KEY) ?? '', 10);
      window.sessionStorage?.removeItem(PanoManager.#STREET_SKIPPED_KEY);
      return Number.isFinite(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  /**
   * Makes a message readable on a load that ends without a panorama.
   *
   * Explore's chrome — the alert banner included — sits inside `.tool-ui`, which stays `visibility: hidden` until
   * Main finishes revealing it, and Main stops as soon as there is no viewer. So a message shown from here would
   * otherwise render inside a hidden container, behind a loading animation that never goes away: the labeler sees a
   * page that looks stuck forever and is told nothing (#4918).
   *
   * Only the banner is un-hidden, not the whole tool: `visibility` is the one property a descendant can override
   * against an inherited `hidden`, and revealing the rest would show a half-initialized UI whose controls are wired
   * to a viewer that does not exist. The navbar is outside `.tool-ui`, so the labeler still has somewhere to go.
   */
  static #revealMessageOnStoppedLoad() {
    document.getElementById('page-loading')?.style.setProperty('visibility', 'hidden');
    document.getElementById('alert-holder')?.style.setProperty('visibility', 'visible');
  }

  /**
   * Decides what a failure to seed the viewer is allowed to say about the assigned street, and acts on it.
   *
   * Three outcomes, in increasing order of what we let ourselves write down (#4918):
   * - the provider never answered — an SDK, network, quota, or maps-library failure — so the street's imagery is
   *   unknown and nothing at all is recorded;
   * - the provider answered "nothing here", but this session has already hit its flag limit, so we treat the run as
   *   a broken session rather than a run of empty streets and still record nothing;
   * - otherwise the street really does look imagery-less, so it is reported — as evidence only, leaving the task
   *   incomplete and the street in the pool for the offline checker to settle (#4922) — and the page reloads. The
   *   reload lands somewhere else: /explore declines to resume a task whose street this labeler just reported, or
   *   they would be handed the same unloadable street again on this load and every one after it.
   *
   * The first two both leave the user on a page with no panorama, so they get told rather than silently stranded.
   *
   * @param {Error} err - Whatever `create()` rejected with.
   * @param {{task: Task, missionId: number}} errorParams - The street and mission the failure happened on.
   * @returns {Promise<void>} Resolves once any report has been sent. The reload itself never resolves.
   */
  async #handleViewerCreationFailure(err, errorParams) {
    // Surface the error either way: it is the only record of a transient failure, since nothing is written to the db.
    console.error('Pano viewer creation failed at the starting location.', err);
    const streetLooksEmpty = err instanceof NoImageryError;

    if (!streetLooksEmpty || !NoImageryFlagGuard.canFlag()) {
      this.#tracker.push(streetLooksEmpty ? 'NoImageryFlagLimitReached' : 'PanoViewerCreateFailed');
      // Two different things to say. A provider that never answered is a transient failure worth retrying; a run of
      // streets that all answered "nothing here" is us having stopped trusting the answers, which waiting won't
      // change (#4918).
      const message = streetLooksEmpty ? 'popup.imagery-skip-limit' : 'popup.imagery-load-failed';
      const type = streetLooksEmpty ? 'imagerySkipLimit' : 'imageryLoadFailed';
      // Ending the run also hands the budget back, which is what makes the message's advice to reload true. The guard
      // bounds runs that Explore drives on its own; a labeler who reads this and chooses to reload is not that loop,
      // and the per-user server limit is what bounds the writing whatever they choose (#4918).
      if (streetLooksEmpty) NoImageryFlagGuard.reset();
      PanoManager.#revealMessageOnStoppedLoad();
      this.#alertController.showAlert(i18next.t(message), type, false);
      return;
    }

    NoImageryFlagGuard.recordStreetGivenUp();
    await util.misc.reportNoImagery(errorParams.task, errorParams.missionId);
    PanoManager.#rememberStreetSkipped(errorParams.task.getStreetEdgeId());
    window.location.replace('/explore');
  }

  /**
   * Loads the viewer at the session's starting point and sets it up.
   * @param {PanoSeed} seed
   * @param {{task: Task, missionId: number}} errorParams
   * @returns {Promise<boolean>} What `ready` resolves with.
   */
  async #load(seed, errorParams) {
    const panoOptions = {
      accessToken: this.#config.viewerAccessToken,
      defaultNavigation: false, // We create our own navigation arrows.
      preloadNeighbors: true, // Pre-download linked panos so walking down the street doesn't wait on the network.
    };

    if (seed.startPanoId) {
      panoOptions.startPanoId = seed.startPanoId;
    }
    if (Number.isFinite(seed.startLat) && Number.isFinite(seed.startLng)) {
      panoOptions.startLatLng = { lat: seed.startLat, lng: seed.startLng };
      const { task } = errorParams;
      panoOptions.backupLatLngs = PanoManager.backupPointsAlongStreet(
        task.getFeature(), task.getEndCoordinate(), panoOptions.startLatLng,
      );
    }

    const panoViewerType = this.#config.viewerType;
    try {
      this.#panoViewer = await panoViewerType.create(this.#panoCanvas, panoOptions);
    } catch (err) {
      // window.location.replace() doesn't halt execution, and neither does the give-up path, so bail out before the
      // code below dereferences the missing viewer.
      await this.#handleViewerCreationFailure(err, errorParams);
      return false;
    }
    const panoViewer = this.#panoViewer;
    // Reaching a pano ends any run of failures, restoring the session's full flag allowance (#4918).
    NoImageryFlagGuard.reset();

    // Viewer-internal failures land in the interaction log so a "the image went black" report can be read from the
    // database. A lost token is the one case the viewer can't heal on its own, so it's the one the labeler hears about.
    panoViewer.addListener('diagnostic', (name, details) => {
      this.#tracker.push(`PanoViewer_${name}`, details);
      if (name === 'TokenExpired') {
        this.#alertController.showAlert(i18next.t('popup.imagery-session-expired'), 'imagerySessionExpired', false);
      }
    });

    // If we started from a lat/lng and used a backup point closer to the end of the street, reverse the street
    // direction. An explicitly requested pano that loaded isn't a "couldn't start at the start" signal, so it
    // doesn't reverse anything.
    if (panoViewer.initialSeed === 'latLng' && panoOptions.backupLatLngs) {
      const start = turf.point([seed.startLng, seed.startLat]);
      const end = turf.point([errorParams.task.getEndCoordinate().lng, errorParams.task.getEndCoordinate().lat]);
      const curr = turf.point([panoViewer.getPosition().lng, panoViewer.getPosition().lat]);
      if (turf.distance(curr, end) < turf.distance(curr, start)) {
        errorParams.task.reverseStreetDirection();
      }
    }

    await this.#panoSuccessCallback(panoViewer.currPanoData);

    // Make sure that we are set to a legal zoom level to start.
    this.setZoom(1);

    // Face the seeded POV (e.g. a label's stored point of view from the label card, #4637). A stored POV is only
    // meaningful from the camera it was recorded at, so when the pano seed fell back to coordinates we instead face
    // the seed location itself (where the thing the user clicked on is).
    if (seed.startPov && panoViewer.initialSeed === 'pano') {
      panoViewer.setPov({
        heading: seed.startPov.heading,
        pitch: seed.startPov.pitch ?? 0,
        zoom: Math.min(3, Math.max(1, seed.startPov.zoom ?? 1)),
      });
    } else if (seed.startPov && panoOptions.startLatLng) {
      const position = panoViewer.getPosition();
      const bearing = turf.bearing(
        turf.point([position.lng, position.lat]),
        turf.point([panoOptions.startLatLng.lng, panoOptions.startLatLng.lat]),
      );
      panoViewer.setPov({ heading: (bearing + 360) % 360, pitch: 0, zoom: 1 });
    }

    const panoViewerLogo = createPanoViewerLogo(this.#panoCanvas.parentElement, panoViewerType.SOURCE);
    panoViewerLogo.showPrimaryLogo();

    if (panoViewerType === GsvViewer) {
      this.#makeGsvAttributionClickable();
      const gsvPano = /** @type {GsvViewer} */ (panoViewer).gsvPano;
      this.#linksListener = gsvPano.addListener('links_changed', this.#makeGsvAttributionClickable);
    } else if (panoViewerType === MapillaryViewer) {
      this.#liftAboveMapillaryAttribution();
    }
    return true;
  }

  /**
   * Keeps the new pano's metadata, tells the listeners, and then treats the view as changed too.
   * @param {PanoData} panoData - The PanoData extracted from the PanoViewer when loading the pano
   * @returns {Promise<PanoData>}
   */
  #panoSuccessCallback = (panoData) => {
    const panoId = panoData.getPanoId();

    this.#panoStore.addPanoMetadata(panoId, panoData);
    this.#panoChangedListeners.forEach((listener) => listener(panoData));

    this.#tracker.push('PanoId_Changed', {
      panoId,
      lat: panoData.getProperty('lat'),
      lng: panoData.getProperty('lng'),
      cameraHeading: panoData.getProperty('cameraHeading'),
      cameraPitch: panoData.getProperty('cameraPitch'),
    });

    this.#handlePovChange();

    return Promise.resolve(panoData);
  };

  /**
   * Log an error if the pano isn't found. This shouldn't really happen since we only go to connected panos.
   * @param {Error} error
   * @param {string} panoId
   * @returns {Promise<never>} Always rejects with the error.
   */
  #setPanoFailureCallback = (error, panoId) => {
    this.#tracker.push('PanoId_NotFound', { TargetPanoId: panoId });
    console.error(`failed to load pano ${panoId}!`, error);
    return Promise.reject(error);
  };

  /**
   * Moves the GSV pano's bottom links to the top layer once Google has injected them, then stops listening.
   *
   * Google injects the .gm-style-cc links asynchronously after the pano renders, so this runs on each pano change
   * until they are there.
   */
  #makeGsvAttributionClickable = () => {
    this.#makePanoLinksClickable();
    if (this.#panoLinksClickable) google.maps.event.removeListener(this.#linksListener);
  };

  /**
   * Moves the GSV pano's bottom links to the top layer so they are clickable.
   */
  #makePanoLinksClickable = () => {
    const panoLinks = this.#panoCanvas.querySelectorAll('.gm-style-cc');
    if (!this.#panoLinksClickable && panoLinks.length > 3) {
      this.#panoLinksClickable = true;

      // Without its first child each link reads better.
      panoLinks.forEach((el) => el.firstElementChild && el.firstElementChild.remove());

      panoLinks[0].remove(); // Remove GSV keyboard shortcuts link.
      const gsvLinksBar = panoLinks[1].parentElement.parentElement;
      this.#ui.viewControlLayer.append(gsvLinksBar);
      this.#liftBottomLeftAboveLinks(gsvLinksBar);
    }
  };

  /**
   * Hands Mapillary's attribution pill to #liftBottomLeftAboveLinks, so the bottom-left overlays sit above it.
   *
   * The pill is left inside the SDK's DOM, where the SDK patches its creator and date per image, and svl.css positions
   * it there (#5600). The SDK only renders it once the first image is up, which may be after this runs, so a
   * MutationObserver waits for it. One sighting is enough: the SDK creates the container once and patches it in place
   * from then on, even for the compact flip, and the ResizeObserver in #liftBottomLeftAboveLinks follows its height
   * through that.
   */
  #liftAboveMapillaryAttribution = () => {
    const handOff = () => {
      const attributionContainer = this.#panoCanvas.querySelector('.mapillary-attribution-container');
      if (!attributionContainer) return false;
      this.#liftBottomLeftAboveLinks(attributionContainer);
      return true;
    };

    if (this.#mapillaryAttributionArrivalObserver) this.#mapillaryAttributionArrivalObserver.disconnect();
    this.#mapillaryAttributionArrivalObserver = null;
    if (handOff()) return;

    this.#mapillaryAttributionArrivalObserver = new MutationObserver(() => {
      if (!handOff()) return;
      this.#mapillaryAttributionArrivalObserver.disconnect();
      this.#mapillaryAttributionArrivalObserver = null;
    });
    this.#mapillaryAttributionArrivalObserver.observe(this.#panoCanvas, { childList: true, subtree: true });
  };

  /**
   * Lifts the bottom-left pano overlays (the pano date, info button, speed-limit, and logo) attribution links.
   *
   * Publishes the links bar's height as the --bottom-left-links-clearance CSS variable, which those overlays add
   * to their bottom offset. Default position is kept for viewers without a bottom-left links bar.
   * @param {HTMLElement} linksBar - The links container now anchored at the bottom-left of the pano.
   */
  #liftBottomLeftAboveLinks = (linksBar) => {
    const root = document.querySelector('.tool-ui');
    if (!root || !linksBar) return;

    const publishClearance = () => {
      // offsetHeight is the layout (pre-transform) height; the overlays multiply it by --ui-scale themselves.
      const height = linksBar.offsetHeight;
      if (height > 0) root.style.setProperty('--bottom-left-links-clearance', `${height}px`);
    };
    publishClearance();

    if (this.#linksClearanceObserver) this.#linksClearanceObserver.disconnect();
    this.#linksClearanceObserver = new ResizeObserver(publishClearance);
    this.#linksClearanceObserver.observe(linksBar);
  };

  /**
   * Tells the listeners the view changed. Also logged, since the view is what the interaction log is read against.
   */
  #handlePovChange = () => {
    const heading = this.#panoViewer.getPov().heading;
    this.#povChangedListeners.forEach((listener) => listener(heading));
    this.#tracker.push('POV_Changed');
  };

  /**
   * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
   * @param {string} panoId - String representation of the Panorama ID
   * @returns {Promise<PanoData>}
   */
  setPanorama(panoId) {
    return this.#panoViewer.setPano(panoId)
      .then(this.#panoSuccessCallback, (err) => this.#setPanoFailureCallback(err, panoId));
  }

  /**
   * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
   * @param {{lat: number, lng: number}} latLng - The desired location to move to.
   * @param {Set<PanoData>} [excludedPanos=new Set()] - Set of PanoData objects that are not valid images to move to.
   * @returns {Promise<PanoData>}
   */
  setLocation(latLng, excludedPanos = new Set()) {
    return this.#panoViewer.setLocation(latLng, excludedPanos).then(this.#panoSuccessCallback);
  }

  /**
   * Sets the zoom level for this panorama.
   * @param {number} zoom - Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
   * @returns {void}
   */
  setZoom(zoom) {
    const currPov = this.#panoViewer.getPov();
    currPov.zoom = zoom;
    this.setPov(currPov);
  }

  /**
   * Turns the view to a heading, keeping its pitch and zoom.
   * @param {number} heading - Degrees clockwise from true north.
   * @param {number} [durationMs] - Transition duration in milliseconds, happens immediately if undefined.
   */
  turnTo(heading, durationMs) {
    const pov = this.#panoViewer.getPov();
    this.setPov({ heading: Math.round(heading + 360) % 360, pitch: pov.pitch, zoom: pov.zoom }, durationMs);
  }

  /**
   * Prevents users from looking at the sky or straight to the ground. Restrict heading angle if specified in props.
   * @param {{heading: number, pitch: number, zoom: number}} pov - Target pov
   * @returns {{heading: number, pitch: number, zoom: number}} The input pov restricted within min/max pitch/heading
   */
  #restrictViewport(pov) {
    if (pov.pitch > this.properties.maxPitch) {
      pov.pitch = this.properties.maxPitch;
    } else if (pov.pitch < this.properties.minPitch) {
      pov.pitch = this.properties.minPitch;
    }
    if (this.properties.minHeading && this.properties.maxHeading) {
      if (this.properties.minHeading <= this.properties.maxHeading) {
        if (pov.heading > this.properties.maxHeading) {
          pov.heading = this.properties.maxHeading;
        } else if (pov.heading < this.properties.minHeading) {
          pov.heading = this.properties.minHeading;
        }
      } else if (pov.heading < this.properties.minHeading
        && pov.heading > this.properties.maxHeading) {
        if (Math.abs(pov.heading - this.properties.maxHeading) < Math.abs(pov.heading - this.properties.minHeading)) {
          pov.heading = this.properties.maxHeading;
        } else {
          pov.heading = this.properties.minHeading;
        }
      }
    }
    return pov;
  }

  /**
   * Update POV of the image as a user drags their mouse cursor.
   * @param {number} dx
   * @param {number} dy
   * @returns {void}
   */
  updatePov(dx, dy) {
    let pov = this.#panoViewer.getPov();
    if (!pov) return; // Drag events can fire before the first pano has loaded.
    const viewerScaling = 0.375;
    pov.heading -= dx * viewerScaling;
    pov.pitch += dy * viewerScaling;
    pov = this.#restrictViewport(pov);
    this.setPov(pov);
  }

  /**
   * Changes the image pov. If a transition duration is given, smoothly updates the pov over that time.
   * @param {{heading: number, pitch: number, zoom: number}} pov - Target pov
   * @param {number} [durationMs] - Transition duration in milliseconds, happens immediately if undefined
   * @param {Function} [callback] - Optional callback function executed after updating pov.
   * @returns {void}
   */
  setPov(pov, durationMs, callback) {
    const currentPov = this.#panoViewer.getPov();
    let interval;

    // Pov restriction.
    pov = this.#restrictViewport(pov);

    // Animating needs a current POV to interpolate from; before the first pano loads there is none, so fall
    // through to an immediate set.
    if (durationMs && currentPov) {
      const timeSegment = 25; // 25 milliseconds.

      // Get how much angle you change over timeSegment of time.
      const cw = (pov.heading - currentPov.heading + 360) % 360;
      const ccw = 360 - cw;
      let headingIncrement;
      if (cw < ccw) {
        headingIncrement = cw * (timeSegment / durationMs);
      } else {
        headingIncrement = (-ccw) * (timeSegment / durationMs);
      }

      const pitchDelta = pov.pitch - currentPov.pitch;
      const pitchIncrement = pitchDelta * (timeSegment / durationMs);

      interval = window.setInterval(() => {
        const headingDelta = (pov.heading - currentPov.heading + 360) % 360;
        if (headingDelta > 1 && headingDelta < 359) {
          // Update heading angle and pitch angle.
          currentPov.heading += headingIncrement;
          currentPov.pitch += pitchIncrement;
          currentPov.heading = (currentPov.heading + 360) % 360;
          this.#panoViewer.setPov(currentPov);
          this.#handlePovChange();
        } else {
          // The last step lands exactly on the target, zoom included.
          if (!pov.zoom) {
            pov.zoom = 1;
          }

          this.#panoViewer.setPov(pov);
          this.#handlePovChange();
          window.clearInterval(interval);
          if (callback) {
            callback();
          }
        }
      }, timeSegment);
    } else {
      this.#panoViewer.setPov(pov);
      this.#handlePovChange();
    }
  }

  /**
   * Set the minimum and maximum heading angle that users can adjust the Street View camera.
   * @param {{min: number, max: number}} range - The acceptable heading range
   * @returns {void}
   */
  setHeadingRange(range) {
    this.properties.minHeading = range.min;
    this.properties.maxHeading = range.max;
  }
}
