/**
 *
 * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer
 * @param {object} params Parameters that affect the initialization of the panorama viewer.
 * @param {string} [params.startPanoId] Optional starting pano, used over lat/lng, overridden if in the tutorial
 * @param {number} [params.startLat] Optional starting latitude, overridden by startPanoId or if in the tutorial
 * @param {number} [params.startLng] Optional starting longitude, overridden by startPanoId or if in the tutorial
 * @param {object} errorParams Params necessary in case loading the initial location fails
 * @param {Task} errorParams.task
 * @param {number} errorParams.missionId
 * @returns {Promise<PanoManager>}
 * @constructor
 */
async function PanoManager (panoViewerType, viewerAccessToken, params = {}, errorParams) {
    let panoCanvas = document.getElementById('pano');
    let status = {
        bottomLinksClickable: false,
        disablePanning: false,
        lockDisablePanning: false,
        lockShowingNavArrows: false
    };
    let properties = {
        maxPitch: 0,
        minPitch: -35,
        minHeading: undefined,
        maxHeading: undefined
    }
    let linksListener = null;

    let self = this;

    /**
     * Initializes panoViewer on the Explore page, sets it to the starting location, and sets up listeners.
     * @private
     */
    async function _init() {
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
        svl.panoViewer = await panoViewerType.create(panoCanvas, panoOptions)
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

        await _panoSuccessCallback(svl.panoViewer.currPanoData);
        svl.panoViewer.addListener('pov_changed', _handlerPovChange);

        // Adds event listeners to the navigation arrows.
        $('#arrow-group').on('click', (event) => {
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
            linksListener = svl.panoViewer.panorama.addListener('links_changed', _makeLinksClickable);
        }

        resetNavArrows();

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        $(window).on('resize', function() {
            updatePov(.0025,.0025);
        });
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
     * @private
     */
    async function _panoSuccessCallback(panoData) {
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

        if (svl.canvas) { // TODO this if statement is new, need to decide when each thing is initialized.
            svl.canvas.clear();
            svl.canvas.setOnlyLabelsOnPanoAsVisible(panoId);
            svl.canvas.render();
        }

        svl.tracker.push("PanoId_Changed", {
            panoId: panoId,
            lat: panoData.getProperty('lat'),
            lng: panoData.getProperty('lng'),
            cameraHeading: panoData.getProperty('cameraHeading'),
            cameraPitch: panoData.getProperty('cameraPitch'),
        });

        if ('compass' in svl) {
            svl.compass.update();
        }

        return Promise.resolve();
    }

    // TODO I'd like to pass the pano ID or lat/lng in to here if possible?
    async function _setPanoFailureCallback(error) {
        // svl.tracker.push('PanoId_NotFound', { 'TargetPanoId': panoId });
        console.error('failed to load pano!', error);
        // TODO is there anything that we need to log here? Or should we just remove this callback entirely?
        // - NavigationService will handle marking streets as having no imagery, etc.
        return Promise.resolve();
    }

    /**
     * Moves the buttons on the bottom-right of the GSV image to the top layer so they are clickable.
     * @private
     */
    const _makeLinksClickable = function() {
        // Bring the links on the bottom of GSV and the mini map to the top layer so they are clickable.
        let bottomLinks = $('.gm-style-cc');
        if (!status.bottomLinksClickable && bottomLinks.length > 7) {
            status.bottomLinksClickable = true;
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

        google.maps.event.removeListener(linksListener);
    }

    function hideNavArrows() {
        $('#nav-arrows-container').hide();
    }

    function showNavArrows() {
        if (!status.lockShowingNavArrows) $('#nav-arrows-container').show();
    }

    /* Prevents showNavArrows() from showing the arrows. Used to keep arrows hidden in the tutorial. */
    function lockShowingNavArrows() {
        hideNavArrows();
        status.lockShowingNavArrows = true;
    }

    /* Allows showNavArrows() to show the arrows. Used to keep arrows hidden in the tutorial. */
    function unlockShowingNavArrows() {
        status.lockShowingNavArrows = false;
    }

    /**
     * Removes old navigation arrows and creates new ones based on available links from the current pano.
     */
    function resetNavArrows() {
        // TODO arrowGroup should be stored in svl.ui.
        const arrowGroup = document.getElementById('arrow-group');

        // Clear existing arrows.
        while (arrowGroup.firstChild) {
            arrowGroup.removeChild(arrowGroup.firstChild);
        }

        // Create an arrow for each link, rotated to its direction.
        const links = svl.panoViewer.getLinkedPanos();
        links.forEach(link => {
            const arrow = _createArrow();
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
    function _createArrow() {
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/assets/images/icons/arrow-forward.svg');
        image.setAttribute('width', '20');
        image.setAttribute('height', '20');
        image.setAttribute('x', '5');  // ((areaWidth / 2)  - iconWidth) / 2 = ((60 / 2 - 20) / 2 = 5

        return image;
    }

    function updateCanvas() {
        svl.canvas.clear();
        if (status.currPanoId !== svl.panoViewer.getPanoId()) {
            svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
        }
        status.currPanoId = svl.panoViewer.getPanoId();
        svl.canvas.render();
    }

    /**
     * Callback for pov update.
     */
    function _handlerPovChange() {
        // TODO I don't like checking if things are initialized yet.
        if (svl.canvas) updateCanvas();
        if (svl.compass) svl.compass.update();
        if (svl.observedArea) svl.observedArea.update();

        const arrowGroup = document.getElementById('arrow-group');
        const heading = svl.panoViewer.getPov().heading;
        arrowGroup.setAttribute('transform', `rotate(${-heading})`);

        svl.tracker.push("POV_Changed");
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param panoId    String representation of the Panorama ID
     */
    async function setPanorama(panoId) {
        return svl.panoViewer.setPano(panoId).then(_panoSuccessCallback, _setPanoFailureCallback);
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param latLng An object with properties lat and lng representing the desired location.
     * @param {Set<string>} [excludedPanos=new Set()] Set of pano IDs that are not valid images to move to.
     */
    async function setLocation(latLng, excludedPanos = new Set()) {
        return svl.panoViewer.setLocation(latLng, excludedPanos).then(_panoSuccessCallback);
    }


    /**
     * Sets the zoom level for this panorama.
     * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
     */
    function setZoom(zoom) {
        const currPov = svl.panoViewer.getPov();
        currPov.zoom = zoom;
        setPov(currPov);
    }

    /**
     * Prevents users from looking at the sky or straight to the ground. Restrict heading angle if specified in props.
     */
    function _restrictViewport(pov) {
        if (pov.pitch > properties.maxPitch) {
            pov.pitch = properties.maxPitch;
        } else if (pov.pitch < properties.minPitch) {
            pov.pitch = properties.minPitch;
        }
        if (properties.minHeading && properties.maxHeading) {
            if (properties.minHeading <= properties.maxHeading) {
                if (pov.heading > properties.maxHeading) {
                    pov.heading = properties.maxHeading;
                } else if (pov.heading < properties.minHeading) {
                    pov.heading = properties.minHeading;
                }
            } else {
                if (pov.heading < properties.minHeading &&
                    pov.heading > properties.maxHeading) {
                    if (Math.abs(pov.heading - properties.maxHeading) < Math.abs(pov.heading - properties.minHeading)) {
                        pov.heading = properties.maxHeading;
                    } else {
                        pov.heading = properties.minHeading;
                    }
                }
            }
        }
        return pov;
    }

    /**
     * Update POV of the image as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov(dx, dy) {
        let pov = svl.panoViewer.getPov();
        const viewerScaling = 0.375;
        pov.heading -= dx * viewerScaling;
        pov.pitch += dy * viewerScaling;
        pov = _restrictViewport(pov);
        setPov(pov);
    }

    /**
     * Changes the image pov. If a transition duration is given, smoothly updates the pov over that time.
     * @param {{heading: number, pitch: number, zoom: number}} pov Target pov
     * @param durationMs Transition duration in milliseconds
     * @param callback Callback function executed after updating pov.
     * @returns {setPov}
     */
    function setPov(pov, durationMs, callback) {
        let currentPov = svl.panoViewer.getPov();
        let interval;

        // Pov restriction.
        _restrictViewport(pov);

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
        return this;
    }

    /**
     * Set the minimum and maximum heading angle that users can adjust the Street View camera.
     * @param range
     * @returns {setHeadingRange}
     */
    function setHeadingRange(range) {
        properties.minHeading = range[0];
        properties.maxHeading = range[1];
        return this;
    }

    // Set the POV in the same direction as the route.
    function setPovToRouteDirection(durationMs) {
        const pov = svl.panoViewer.getPov();
        const newPov = {
            heading: Math.round(svl.compass.getTargetAngle() + 360) % 360,
            pitch: pov.pitch,
            zoom: pov.zoom
        }
        setPov(newPov, durationMs);
    }

    /**
     * Disable panning on Street View
     * @returns {disablePanning}
     */
    function disablePanning() {
        if (!status.lockDisablePanning) {
            status.disablePanning = true;
        }
        return this;
    }

    /**
     * Enable panning on Street View.
     * @returns {enablePanning}
     */
    function enablePanning() {
        if (!status.lockDisablePanning) {
            status.disablePanning = false;
        }
        return this;
    }

    /**
     * Lock disable panning.
     * @returns {lockDisablePanning}
     */
    function lockDisablePanning() {
        status.lockDisablePanning = true;
        return this;
    }

    /**
     * Unlock disable panning.
     * @returns {unlockDisablePanning}
     */
    function unlockDisablePanning() {
        status.lockDisablePanning = false;
        return this;
    }

    /* Make navigation arrows blink. Used in the tutorial. */
    function blinkNavigationArrows() {
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

    function getStatus(key) {
        return status[key];
    }

    self.setPov = setPov;
    self.setHeadingRange = setHeadingRange;
    self.setPovToRouteDirection = setPovToRouteDirection;
    self.updateCanvas = updateCanvas;
    self.hideNavArrows = hideNavArrows;
    self.showNavArrows = showNavArrows;
    self.lockShowingNavArrows = lockShowingNavArrows;
    self.unlockShowingNavArrows = unlockShowingNavArrows;
    self.resetNavArrows = resetNavArrows;
    self.setPanorama = setPanorama;
    self.setLocation = setLocation;
    self.setZoom = setZoom;
    self.disablePanning = disablePanning;
    self.enablePanning = enablePanning;
    self.lockDisablePanning = lockDisablePanning;
    self.unlockDisablePanning = unlockDisablePanning;
    self.blinkNavigationArrows = blinkNavigationArrows;
    self.getStatus = getStatus;
    self.updatePov = updatePov;

    await _init();

    return this;
}
