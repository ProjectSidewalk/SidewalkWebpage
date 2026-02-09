/**
 * Handles interfacing with the PanoViewer with functionality that is specific to the Explore page.
 */
class PanoManager {
    constructor() {
        this.panoCanvas = document.getElementById('pano');
        this.status = {
            bottomLinksClickable: false,
            disablePanning: false,
            lockDisablePanning: false,
            lockShowingNavArrows: false
        };
        this.properties = {
            maxPitch: 0,
            minPitch: -35,
            minHeading: undefined,
            maxHeading: undefined
        }
        this.linksListener = null;
    }

    /**
     * Factory function that creates a PanoManager and svl.panoViewer.
     *
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
     * @param {string} viewerAccessToken An access token used to request images for the pano viewer
     * @param {object} params Parameters that affect the initialization of the panorama viewer
     * @param {string} [params.startPanoId] Optional starting pano, used over lat/lng
     * @param {number} [params.startLat] Optional starting latitude, overridden by startPanoId
     * @param {number} [params.startLng] Optional starting longitude, overridden by startPanoId
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
     * Initializes panoViewer on the Explore page, sets it to the starting location, and sets up listeners.
     * @returns {Promise<void>}
     * @private
     */
    async #init(panoViewerType, viewerAccessToken, params = {}, errorParams) {
        let panoOptions = {
            accessToken: viewerAccessToken
        };

        // Add the starting location to panoOptions.
        if (params.startPanoId) {
            panoOptions.startPanoId = params.startPanoId
        } else if (params.startLat && params.startLng) {
            panoOptions.startLatLng = { lat: params.startLat, lng: params.startLng };
            panoOptions.backupLatLng = errorParams.task.getEndCoordinate();
        }

        // Load the pano viewer.
        svl.panoViewer = await panoViewerType.create(this.panoCanvas, panoOptions)
            .catch(async (err) => {
                // If no GSV at starting street, log it and refresh the page to get a new street.
                await util.misc.reportNoImagery(errorParams.task, errorParams.missionId).then(() => {
                    window.location.replace('/explore');
                });
            });

        // If we used the backup at the end of the street (if we're closer to that point), reverse the street direction.
        if (panoOptions.startLatLng && panoOptions.backupLatLng) {
            const start = turf.point([params.startLng, params.startLat]);
            const end = turf.point([errorParams.task.getEndCoordinate().lng, errorParams.task.getEndCoordinate().lat]);
            const curr = turf.point([svl.panoViewer.getPosition().lng, svl.panoViewer.getPosition().lat]);
            if (turf.distance(curr, end) < turf.distance(curr, start)) {
                errorParams.task.reverseStreetDirection();
            }
        }

        await this.#panoSuccessCallback(svl.panoViewer.currPanoData);
        svl.panoViewer.addListener('pov_changed', this.#handlerPovChange);

        // Adds event listeners to the navigation arrows.
        svl.ui.streetview.navArrows.on('click', (event) => {
            event.stopPropagation();
            const targetPanoId = event.target.getAttribute('pano-id');
            if (targetPanoId) svl.navigationService.moveToPano(event.target.getAttribute('pano-id'));
        });

        if (panoViewerType === GsvViewer) {
            $('#imagery-source-logo-holder').hide();
        } else if (panoViewerType === MapillaryViewer) {
            $('#imagery-source-logo').attr('src', '/assets/images/logos/mapillary-logo-white.png');
            $('#imagery-source-logo-holder').css        ('padding-left', '5px');
        } else if (panoViewerType === Infra3dViewer) {
            $('#imagery-source-logo').attr('src', '/assets/images/logos/infra3d-logo.svg');
        }

        // TODO we probably need to do this for any viewer type...
        if (panoViewerType === GsvViewer) {
            this.linksListener = svl.panoViewer.gsvPano.addListener('links_changed', this.#makeLinksClickable);
        }

        this.resetNavArrows();

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        $(window).on('resize', () => {
            this.updatePov(.0025,.0025);
        });
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
     * @returns {Promise<PanoData>}
     * @private
     */
    #panoSuccessCallback = async (panoData) => {
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
            panoId: panoId,
            lat: panoData.getProperty('lat'),
            lng: panoData.getProperty('lng'),
            cameraHeading: panoData.getProperty('cameraHeading'),
            cameraPitch: panoData.getProperty('cameraPitch'),
        });

        if ('compass' in svl) {
            svl.compass.update();
        }

        return Promise.resolve(panoData);
    };

    /**
     * Log an error if the pano isn't found. This shouldn't really happen since we only go to connected panos.
     * @param {Error} error
     * @param {string} panoId
     * @returns {Promise<void>}
     * @private
     */
    #setPanoFailureCallback = async (error, panoId) => {
        svl.tracker.push('PanoId_NotFound', { 'TargetPanoId': panoId });
        console.error(`failed to load pano ${panoId}!`, error);
        throw error;
    }

    /**
     * Moves the buttons on the bottom-right of the GSV image to the top layer so they are clickable.
     * @private
     */
    #makeLinksClickable = () => {
        // Bring the links on the bottom of GSV and the mini map to the top layer so they are clickable.
        let bottomLinks = $('.gm-style-cc');
        if (!this.status.bottomLinksClickable && bottomLinks.length > 7) {
            this.status.bottomLinksClickable = true;
            bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
            bottomLinks[4].remove(); // Remove mini map keyboard shortcuts link.
            bottomLinks[5].remove(); // Remove mini map copyright text (duplicate of GSV).
            bottomLinks[7].remove(); // Remove mini map terms of use link (duplicate of GSV).
            svl.ui.streetview.viewControlLayer.append($(bottomLinks[1]).parent().parent());
            svl.ui.minimap.overlay.append($(bottomLinks[8]).parent().parent());
        }

        if (util.getBrowser() === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            svl.ui.streetview.viewControlLayer.append(svl.ui.streetview.canvas);
        }

        google.maps.event.removeListener(this.linksListener);
    }

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
        links.forEach(link => {
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
     * Callback for pov update.
     * @private
     */
    #handlerPovChange = () => {
        if (svl.canvas) this.updateCanvas();
        if (svl.compass) svl.compass.update();
        if (svl.observedArea) svl.observedArea.update();

        const arrowGroup = svl.ui.streetview.navArrows[0];
        const heading = svl.panoViewer.getPov().heading;
        arrowGroup.setAttribute('transform', `rotate(${-heading})`);

        svl.tracker.push('POV_Changed');
    };

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param {string} panoId String representation of the Panorama ID
     * @returns {Promise<PanoData>}
     */
    async setPanorama(panoId) {
        return svl.panoViewer.setPano(panoId).then(this.#panoSuccessCallback, (err) => this.#setPanoFailureCallback(err, panoId));
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param {{lat: number, lng: number}} latLng The desired location to move to.
     * @param {Set<string>} [excludedPanos=new Set()] Set of pano IDs that are not valid images to move to.
     * @returns {Promise<PanoData>}
     */
    async setLocation(latLng, excludedPanos = new Set()) {
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
            } else {
                if (pov.heading < this.properties.minHeading &&
                    pov.heading > this.properties.maxHeading) {
                    if (Math.abs(pov.heading - this.properties.maxHeading) < Math.abs(pov.heading - this.properties.minHeading)) {
                        pov.heading = this.properties.maxHeading;
                    } else {
                        pov.heading = this.properties.minHeading;
                    }
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
        let currentPov = svl.panoViewer.getPov();
        let interval;

        // Pov restriction.
        pov = this.#restrictViewport(pov);

        if (durationMs) {
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

            interval = window.setInterval(function () {
                const headingDelta = (pov.heading - currentPov.heading + 360) % 360;
                if (headingDelta > 1 && headingDelta < 359) {
                    // Update heading angle and pitch angle.
                    currentPov.heading += headingIncrement;
                    currentPov.pitch += pitchIncrement;
                    currentPov.heading = (currentPov.heading + 360) % 360;
                    svl.panoViewer.setPov(currentPov);
                    svl.peg.setHeading(currentPov.heading);
                } else {
                    // Set the pov to adjust zoom level, then clear the interval. Invoke a callback if there is one.
                    if (!pov.zoom) {
                        pov.zoom = 1;
                    }

                    svl.panoViewer.setPov(pov);
                    svl.peg.setHeading(currentPov.heading);
                    window.clearInterval(interval);
                    if (callback) {
                        callback();
                    }
                }
            }, timeSegment);
        } else {
            svl.panoViewer.setPov(pov);
            svl.peg.setHeading(pov.heading);
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
            zoom: pov.zoom
        }
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
            const intervalId = window.setInterval(function () {
                // Blink logic.
                arrows.forEach((arrow) => {
                    if (arrow.classList.contains('highlight')) arrow.classList.remove('highlight')
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
