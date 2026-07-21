/**
 * Handles interfacing with the PanoViewer with functionality that is specific to the Explore page.
 */
class PanoManager {
  constructor() {
    this.panoCanvas = document.getElementById('pano');
    this.status = {
      panoLinksClickable: false,
      minimapLinksClickable: false,
      disablePanning: false,
      lockDisablePanning: false,
      lockShowingNavArrows: false,
    };
    this.properties = {
      maxPitch: 0,
      minPitch: -35,
      minHeading: undefined,
      maxHeading: undefined,
    };
    this.linksListener = null;
    this.linksClearanceObserver = null;
    this.mapillaryAttributionObserver = null;
  }

  /**
   * Factory function that creates a PanoManager and svl.panoViewer.
   *
   * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
   * @param {string} viewerAccessToken An access token used to request images for the pano viewer
   * @param {object} params Parameters that affect the initialization of the panorama viewer
   * @param {string} [params.startPanoId] Optional starting pano, tried before the lat/lng
   * @param {number} [params.startLat] Optional starting latitude; the fallback if startPanoId fails to load
   * @param {number} [params.startLng] Optional starting longitude; the fallback if startPanoId fails to load
   * @param {{heading: number, pitch: number, zoom: number}} [params.startPov] Optional POV to face after loading
   * @param {object} errorParams Params necessary in case loading the initial location fails
   * @param {Task} errorParams.task The assigned Task; used if no imagery is found to record the street
   * @param {number} errorParams.missionId The current mission ID; used if no imagery is found
   * @returns {Promise<PanoManager>} The PanoManager instance
   * @constructor
   */
  static async create(panoViewerType, viewerAccessToken, params = {}, errorParams) {
    const newPanoManager = new this();
    await newPanoManager.#init(panoViewerType, viewerAccessToken, params, errorParams);
    return newPanoManager;
  }

  /**
   * Samples backup starting points along the street, used when the street's start has no usable imagery. Points are
   * spaced at the same increment as moveForward()'s imagery search, ending with the street's endpoint, so the whole
   * street is checked before we give up and report the street as having no imagery.
   * @param {Task} task The assigned Task, used for the street geometry
   * @returns {Array<{lat: number, lng: number}>} Points along the street, ordered from start to end
   */
  static #backupPointsAlongStreet(task) {
    const street = task.getFeature();
    const streetLength = turf.length(street); // km
    const points = [];
    for (let dist = NavigationService.DIST_INCREMENT; dist < streetLength; dist += NavigationService.DIST_INCREMENT) {
      const point = turf.along(street, dist);
      points.push({ lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] });
    }
    points.push(task.getEndCoordinate());
    return points;
  }

  /**
   * Initializes panoViewer on the Explore page, sets it to the starting location, and sets up listeners.
   * @returns {Promise<void>}
   * @private
   */
  async #init(panoViewerType, viewerAccessToken, params = {}, errorParams) {
    const panoOptions = {
      accessToken: viewerAccessToken,
      defaultNavigation: false, // We create our own navigation arrows.
    };

    // Add the starting location to panoOptions. A pano seed is tried first; the lat/lng (plus backups sampled along
    // the street) doubles as its fallback, so a dead pano isn't misreported as a street with no imagery (#4635).
    if (params.startPanoId) {
      panoOptions.startPanoId = params.startPanoId;
    }
    if (Number.isFinite(params.startLat) && Number.isFinite(params.startLng)) {
      panoOptions.startLatLng = { lat: params.startLat, lng: params.startLng };
      panoOptions.backupLatLngs = PanoManager.#backupPointsAlongStreet(errorParams.task);
    }

    // Load the pano viewer.
    try {
      svl.panoViewer = await panoViewerType.create(this.panoCanvas, panoOptions);
    } catch (err) {
      // Surface the error: creation can also fail for reasons beyond missing imagery (e.g. the maps library failing
      // to load), and the redirect below would otherwise bury it.
      console.error('Pano viewer creation failed at the starting location.', err);
      // Record the street as having no usable imagery and refresh the page to get a new street.
      await util.misc.reportNoImagery(errorParams.task, errorParams.missionId);
      // window.location.replace() doesn't halt execution, so bail out before the code below dereferences the
      // missing viewer. Main.js sees the undefined svl.panoViewer and stops its own init the same way.
      window.location.replace('/explore');
      return;
    }

    // If we started from a lat/lng and used a backup point closer to the end of the street, reverse the street
    // direction. An explicitly requested pano that loaded isn't a "couldn't start at the start" signal, so it
    // doesn't reverse anything.
    if (svl.panoViewer.initialSeed === 'latLng' && panoOptions.backupLatLngs) {
      const start = turf.point([params.startLng, params.startLat]);
      const end = turf.point([errorParams.task.getEndCoordinate().lng, errorParams.task.getEndCoordinate().lat]);
      const curr = turf.point([svl.panoViewer.getPosition().lng, svl.panoViewer.getPosition().lat]);
      if (turf.distance(curr, end) < turf.distance(curr, start)) {
        errorParams.task.reverseStreetDirection();
      }
    }

    await this.#panoSuccessCallback(svl.panoViewer.currPanoData);

    // Make sure that we are set to a legal zoom level to start.
    this.setZoom(1);

    // Face the seeded POV (e.g. a label's stored point of view from the label card, #4637). A stored POV is only
    // meaningful from the camera it was recorded at, so when the pano seed fell back to coordinates we instead face
    // the seed location itself (where the thing the user clicked on is).
    if (params.startPov && svl.panoViewer.initialSeed === 'pano') {
      svl.panoViewer.setPov({
        heading: params.startPov.heading,
        pitch: params.startPov.pitch ?? 0,
        zoom: Math.min(3, Math.max(1, params.startPov.zoom ?? 1)),
      });
    } else if (params.startPov && panoOptions.startLatLng) {
      const position = svl.panoViewer.getPosition();
      const bearing = turf.bearing(
        turf.point([position.lng, position.lat]),
        turf.point([panoOptions.startLatLng.lng, panoOptions.startLatLng.lat]),
      );
      svl.panoViewer.setPov({ heading: (bearing + 360) % 360, pitch: 0, zoom: 1 });
    }

    // Adds event listeners to the navigation arrows.
    svl.ui.streetview.navArrows.on('click', (event) => {
      event.stopPropagation();
      const targetPanoId = event.target.getAttribute('pano-id');
      if (targetPanoId) svl.navigationService.moveToPano(event.target.getAttribute('pano-id'));
    });

    const panoViewerLogo = createPanoViewerLogo(this.panoCanvas.parentElement, panoViewerType);
    panoViewerLogo.showPrimaryLogo();

    if (panoViewerType === GsvViewer) {
      this.#makeGsvAttributionClickable();
      this.linksListener = svl.panoViewer.gsvPano.addListener('links_changed', this.#makeGsvAttributionClickable);
    } else if (panoViewerType === MapillaryViewer) {
      this.#makeMapillaryAttributionClickable();
    }

    this.resetNavArrows();

    // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
    // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
    // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
    $(window).on('resize', () => {
      this.updatePov(0.0025, 0.0025);
    });
  }

  /**
   * Refreshes all views for the new pano and saves historic pano metadata.
   * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
   * @returns {Promise<PanoData>}
   * @private
   */
  #panoSuccessCallback = (panoData) => {
    const panoId = panoData.getPanoId();
    const panoLatLng = { lat: panoData.getProperty('lat'), lng: panoData.getProperty('lng') };

    // Store the returned pano metadata.
    svl.panoStore.addPanoMetadata(panoId, panoData);

    // Add the capture date of the image to the bottom-right corner of the UI.
    svl.ui.streetview.date.text(panoData.getProperty('captureDate').format('MMM YYYY'));

    // Mark that we visited this pano so that we can tell if they've gotten stuck.
    svl.stuckAlert.panoVisited(panoId);

    // Updates peg location on minimap to match current panorama location.
    if (svl.minimap) svl.minimap.setMinimapLocation(panoLatLng);
    if (svl.peg) svl.peg.setLocation(panoLatLng);

    // Rerender the canvas.
    if (svl.canvas) {
      svl.canvas.clear();
      svl.canvas.setOnlyLabelsOnPanoAsVisible(panoId);
      svl.canvas.render();
    }

    svl.tracker.push('PanoId_Changed', {
      panoId,
      lat: panoData.getProperty('lat'),
      lng: panoData.getProperty('lng'),
      cameraHeading: panoData.getProperty('cameraHeading'),
      cameraPitch: panoData.getProperty('cameraPitch'),
    });

    // Update various views since the POV has changed.
    this.#handlePovChange();

    return Promise.resolve(panoData);
  };

  /**
   * Log an error if the pano isn't found. This shouldn't really happen since we only go to connected panos.
   * @param {Error} error
   * @param {string} panoId
   * @returns {Promise<void>}
   * @private
   */
  #setPanoFailureCallback = (error, panoId) => {
    svl.tracker.push('PanoId_NotFound', { TargetPanoId: panoId });
    console.error(`failed to load pano ${panoId}!`, error);
    return Promise.reject(error);
  };

  /**
   * Moves the GSV and minimap bottom links to the top layer so they are clickable.
   *
   * Google injects the .gm-style-cc links asynchronously after each map/pano renders, so the pano's and minimap's
   * links can become available at different times. The two are handled independently (and guarded separately) so
   * the pano links get processed on the first call even if the minimap hasn't rendered its links yet.
   * @private
   */
  #makeGsvAttributionClickable = () => {
    this.#makePanoLinksClickable();
    this.#makeMinimapLinksClickable();

    // Stop listening for link changes once both the pano and minimap links have been handled.
    if (this.status.panoLinksClickable && this.status.minimapLinksClickable) {
      google.maps.event.removeListener(this.linksListener);
    }
  };

  /**
   * Moves the GSV pano's bottom links to the top layer so they are clickable.
   * @private
   */
  #makePanoLinksClickable = () => {
    const panoLinks = $('.gm-style-cc', this.panoCanvas);
    if (!this.status.panoLinksClickable && panoLinks.length > 3) {
      this.status.panoLinksClickable = true;

      // Remove the first child of each GSV link because it looks better.
      panoLinks.each((i, el) => el.firstElementChild && el.firstElementChild.remove());

      panoLinks[0].remove(); // Remove GSV keyboard shortcuts link.
      const gsvLinksBar = $(panoLinks[1]).parent().parent()[0];
      svl.ui.streetview.viewControlLayer.append(gsvLinksBar);
      this.#liftBottomLeftAboveLinks(gsvLinksBar);
    }
  };

  /**
   * Moves Mapillary's attribution links (image credit/date/report links) to the top layer so they're clickable.
   *
   * Mapillary renders these inside the pano canvas itself, where the click-handling view-control-layer covers
   * them. We move the container up into that layer instead, the same trick used for the GSV links. Mapillary may
   * re-render its own container back into the pano (e.g. after an image change), so we keep watching for that.
   * @private
   */
  #makeMapillaryAttributionClickable = () => {
    const tryMove = () => {
      const attributionContainer = this.panoCanvas.querySelector('.mapillary-attribution-container');
      if (attributionContainer) {
        svl.ui.streetview.viewControlLayer.append(attributionContainer);
        this.#liftBottomLeftAboveLinks(attributionContainer);
      }
    };
    tryMove(); // Handle the case where Mapillary already rendered the container before we started observing.

    if (this.mapillaryAttributionObserver) this.mapillaryAttributionObserver.disconnect();
    this.mapillaryAttributionObserver = new MutationObserver(tryMove);
    this.mapillaryAttributionObserver.observe(this.panoCanvas, { childList: true, subtree: true });
  };

  /**
   * Lifts the bottom-left pano overlays (the pano date, info button, speed-limit, and logo) attribution links.
   *
   * Publishes the links bar's height as the --bottom-left-links-clearance CSS variable, which those overlays add
   * to their bottom offset. Default position is kept for viewers without a bottom-left links bar.
   * @param {HTMLElement} linksBar The links container now anchored at the bottom-left of the pano.
   * @private
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

    if (this.linksClearanceObserver) this.linksClearanceObserver.disconnect();
    this.linksClearanceObserver = new ResizeObserver(publishClearance);
    this.linksClearanceObserver.observe(linksBar);
  };

  /**
   * Moves the minimap's links to the top layer so they are clickable, removing the ones that duplicate the GSV links.
   * @private
   */
  #makeMinimapLinksClickable = () => {
    const minimapLinks = $('.gm-style-cc', '#minimap');
    if (!this.status.minimapLinksClickable && minimapLinks.length > 4) {
      this.status.minimapLinksClickable = true;
      minimapLinks[0].remove(); // Remove mini map keyboard shortcuts link.
      minimapLinks[1].remove(); // Remove mini map copyright text (duplicate of GSV).
      minimapLinks[3].remove(); // Remove mini map terms of use link (duplicate of GSV).
      svl.ui.minimap.overlay.append($(minimapLinks[4]).parent().parent());
    }
  };

  hideNavArrows() {
    $('#nav-arrows-container').hide();
  }

  showNavArrows() {
    if (!this.status.lockShowingNavArrows) $('#nav-arrows-container').show();
  }

  /* Prevents showNavArrows() from showing the arrows. Used to keep arrows hidden in the tutorial. */
  lockShowingNavArrows() {
    this.hideNavArrows();
    this.status.lockShowingNavArrows = true;
  }

  /* Allows showNavArrows() to show the arrows. Used to keep arrows hidden in the tutorial. */
  unlockShowingNavArrows() {
    this.status.lockShowingNavArrows = false;
  }

  /**
   * Removes old navigation arrows and creates new ones based on available links from the current pano.
   */
  resetNavArrows() {
    const arrowGroup = svl.ui.streetview.navArrows[0];

    // Clear existing arrows.
    while (arrowGroup.firstChild) {
      arrowGroup.removeChild(arrowGroup.firstChild);
    }

    // Create an arrow for each link, rotated to its direction.
    const links = svl.panoViewer.getLinkedPanos();
    links.forEach((link) => {
      const arrow = this.#createArrow();
      const normalizedHeading = (link.heading + 360) % 360;
      arrow.setAttribute('transform', `translate(15, 0) rotate(${normalizedHeading}, 15, 30)`);
      arrow.setAttribute('pano-id', link.panoId);
      arrowGroup.appendChild(arrow);
    });

    const heading = svl.panoViewer.getPov().heading;
    arrowGroup.setAttribute('transform', `rotate(${-heading})`);
  }

  /**
   * Create svg navigation arrow, setting its width.
   * @returns {SVGPathElement}
   * @private
   */
  #createArrow() {
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/assets/images/icons/arrow-forward.svg');
    image.setAttribute('width', '20');
    image.setAttribute('height', '20');
    image.setAttribute('x', '5');  // ((areaWidth / 2)  - iconWidth) / 2 = ((60 / 2 - 20) / 2 = 5

    return image;
  }

  updateCanvas() {
    svl.canvas.clear();
    if (this.status.currPanoId !== svl.panoViewer.getPanoId()) {
      svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
    }
    this.status.currPanoId = svl.panoViewer.getPanoId();
    svl.canvas.render();
  }

  /**
   * Updates various views when the POV has changed.
   * @private
   */
  #handlePovChange = () => {
    const heading = svl.panoViewer.getPov().heading;
    if (svl.canvas) this.updateCanvas();
    if (svl.compass) svl.compass.update();

    // Skip the heading-dependent viz while the heading is still settling; NavigationService's settle poll handles
    // the final update so these don't swing through the mid-animation heading. (#4174)
    if (!svl.navigationService || !svl.navigationService.getStatus('headingSettling')) {
      if (svl.observedArea) svl.observedArea.update();
      // Once at the route's last pano, auto-finish as soon as the user has looked all the way around it.
      if (svl.missionController) svl.missionController.maybeAutoCompleteRoute();
      if (svl.peg) svl.peg.setHeading(heading);
    }

    const arrowGroup = svl.ui.streetview.navArrows[0];
    arrowGroup.setAttribute('transform', `rotate(${-heading})`);

    svl.tracker.push('POV_Changed');
  };

  /**
   * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
   * @param {string} panoId String representation of the Panorama ID
   * @returns {Promise<PanoData>}
   */
  setPanorama(panoId) {
    return svl.panoViewer.setPano(panoId)
      .then(this.#panoSuccessCallback, (err) => this.#setPanoFailureCallback(err, panoId));
  }

  /**
   * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
   * @param {{lat: number, lng: number}} latLng The desired location to move to.
   * @param {Set<PanoData>} [excludedPanos=new Set()] Set of PanoData objects that are not valid images to move to.
   * @returns {Promise<PanoData>}
   */
  setLocation(latLng, excludedPanos = new Set()) {
    return svl.panoViewer.setLocation(latLng, excludedPanos).then(this.#panoSuccessCallback);
  }

  /**
   * Sets the zoom level for this panorama.
   * @param {number} zoom Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
   * @returns {void}
   */
  setZoom(zoom) {
    const currPov = svl.panoViewer.getPov();
    currPov.zoom = zoom;
    this.setPov(currPov);
  }

  /**
   * Prevents users from looking at the sky or straight to the ground. Restrict heading angle if specified in props.
   * @param {{heading: number, pitch: number, zoom: number}} pov Target pov
   * @returns {{heading: number, pitch: number, zoom: number}} The input pov restricted within min/max pitch/heading
   * @private
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
    let pov = svl.panoViewer.getPov();
    if (!pov) return; // Drag events can fire before the first pano has loaded.
    const viewerScaling = 0.375;
    pov.heading -= dx * viewerScaling;
    pov.pitch += dy * viewerScaling;
    pov = this.#restrictViewport(pov);
    this.setPov(pov);
  }

  /**
   * Changes the image pov. If a transition duration is given, smoothly updates the pov over that time.
   * @param {{heading: number, pitch: number, zoom: number}} pov Target pov
   * @param {number} [durationMs] Transition duration in milliseconds, happens immediately if undefined
   * @param {function} [callback] Optional callback function executed after updating pov.
   * @returns {void}
   */
  setPov(pov, durationMs, callback) {
    const currentPov = svl.panoViewer.getPov();
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
          svl.panoViewer.setPov(currentPov);
          this.#handlePovChange();
        } else {
          // Set the pov to adjust zoom level, then clear the interval. Invoke a callback if there is one.
          if (!pov.zoom) {
            pov.zoom = 1;
          }

          svl.panoViewer.setPov(pov);
          this.#handlePovChange();
          window.clearInterval(interval);
          if (callback) {
            callback();
          }
        }
      }, timeSegment);
    } else {
      svl.panoViewer.setPov(pov);
      this.#handlePovChange();
    }
  }

  /**
   * Set the minimum and maximum heading angle that users can adjust the Street View camera.
   * @param {{min: number, max: number}} range The acceptable heading range
   * @returns {void}
   */
  setHeadingRange(range) {
    this.properties.minHeading = range.min;
    this.properties.maxHeading = range.max;
  }

  // Set the POV in the same direction as the route.
  setPovToRouteDirection(durationMs) {
    const pov = svl.panoViewer.getPov();
    const newPov = {
      heading: Math.round(svl.compass.getTargetAngle() + 360) % 360,
      pitch: pov.pitch,
      zoom: pov.zoom,
    };
    this.setPov(newPov, durationMs);
  }

  /**
   * Disable panning on Street View
   * @returns {PanoManager} The PanoManager instance; returned to enable method chaining
   */
  disablePanning() {
    if (!this.status.lockDisablePanning) {
      this.status.disablePanning = true;
    }
    return this;
  }

  /**
   * Enable panning on Street View.
   * @returns {PanoManager} The PanoManager instance; returned to enable method chaining
   */
  enablePanning() {
    if (!this.status.lockDisablePanning) {
      this.status.disablePanning = false;
    }
    return this;
  }

  /**
   * Lock disable panning.
   * @returns {PanoManager} The PanoManager instance; returned to enable method chaining
   */
  lockDisablePanning() {
    this.status.lockDisablePanning = true;
    return this;
  }

  /**
   * Unlock disable panning.
   * @returns {PanoManager} The PanoManager instance; returned to enable method chaining
   */
  unlockDisablePanning() {
    this.status.lockDisablePanning = false;
    return this;
  }

  /* Make navigation arrows blink. Used in the tutorial. */
  blinkNavigationArrows() {
    setTimeout(() => {
      const arrows = document.querySelectorAll('#arrow-group image');
      // Obtain interval id to allow for the interval to be cleaned up after the arrow leaves document context.
      const intervalId = window.setInterval(() => {
        // Blink logic.
        arrows.forEach((arrow) => {
          if (arrow.classList.contains('highlight')) arrow.classList.remove('highlight');
          else arrow.classList.add('highlight');

          // Once the arrow is removed from the document, stop the interval for all arrows.
          if (!document.body.contains(arrow)) window.clearInterval(intervalId);
        });
      }, 500);
    }, 500);
  }

  /**
   * Gets the value from the status object.
   * @param {string} key The key for the desired status
   * @returns {*} The value of the given status
   */
  getStatus(key) {
    return this.status[key];
  }
}
