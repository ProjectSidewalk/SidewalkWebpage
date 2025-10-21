async function PanoManager (panoViewerType, params = {}) {
    let panoCanvas = document.getElementById('pano');
    let status = {
        bottomLinksClickable: false,
        disablePanning: false,
        lockDisablePanning: false
    };
    let properties = {
        maxPitch: 0,
        minPitch: -35,
        minHeading: undefined,
        maxHeading: undefined
    }
    let _panoChangeSuccessCallbackHelper = null;
    let linksListener = null;

    // Used while calculation of canvas coordinates during rendering of labels
    // TODO: Refactor it to be included in the status variable above so that we can use
    // setStatus("povChange", true); Instead of povChange["status"] = true;
    let povChange = {
        status: false
    };

    let self = this;

    /**
     * Initializes panoViewer on the Explore page, sets it to the starting location, and sets up listeners.
     * @private
     */
    async function _init() {
        const panoOptions = {
            keyboardShortcuts: true
        }

        // Load the pano viewer.
        svl.panoViewer = await panoViewerType.create(panoCanvas, panoOptions);
        svl.panoViewer.addListener('pov_changed', _handlerPovChange);

        // Adds event listeners to the navigation arrows.
        $('#arrow-group').on('click', (event) => {
            event.stopPropagation();
            const targetPanoId = event.target.getAttribute('pano-id');
            if (targetPanoId) svl.navigationService.moveToPano(event.target.getAttribute('pano-id'));
        });

        if (panoViewerType === GsvViewer) {
            _panoChangeSuccessCallbackHelper = _successCallbackHelperGsv;
        } else if (panoViewerType === Infra3dViewer) {
            _panoChangeSuccessCallbackHelper = _successCallbackHelperInfra3d;
        }

        // Move to the specified starting location.
        // TODO The page totally fails to load if we fail to get imagery at the start location.
        if (panoViewerType === Infra3dViewer) {
            await setPanorama('vps_baden@meta_ch_baden_masterdemo_v3/114-41');
        } else if ('startPanoId' in params) {
            await setPanorama(params.startPanoId);
        } else if ('startLat' in params && 'startLng' in params) {
            await setLocation({lat: params.startLat, lng: params.startLng });
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

        // TODO not sure why this didn't work at first glance.
        // svl.panoViewer.panorama.registerPanoProvider(function(pano) {
        //     if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
        //         return _getCustomPanorama(pano);
        //     }
        //     return null;
        // });
        // svl.panoStore.addPanoMetadata('tutorial', _getCustomPanorama('tutorial'));
        // svl.panoStore.addPanoMetadata('afterWalkTutorial', _getCustomPanorama('afterWalkTutorial'));
    }

    /**
     * Updates the date text field on the pano when pano changes in Infra3d viewer.
     * @private
     */
    function _successCallbackHelperInfra3d() {
        // No pano history for Infra3D.

        // Show the pano date in the bottom-left corner.
        const panoDate = svl.panoViewer.viewer.getCurrentNode().date;
        document.getElementById("svl-panorama-date").innerText = moment(panoDate).format('MMM YYYY');
    }

    /**
     * Saves historic pano metadata and updates the date text field on the pano in GSV viewer.
     * @param data The pano data returned from the StreetViewService
     * @private
     */
    function _successCallbackHelperGsv(data) {
        const panoId = svl.panoViewer.getPanoId();

        // Record the pano metadata.
        svl.panoStore.addPanoMetadata(panoId, data);

        // Show the pano date in the bottom-left corner.
        svl.ui.streetview.date.text(moment(data.imageDate).format('MMM YYYY'));
        // else if (panoId === "tutorial" || panoId === "afterWalkTutorial") {
        //     // TODO I'm not sure how registering our own panos works for this.
        //     const imageDate = svl.panoStore.getPanoData(panoId).data().imageDate;
        //     svl.ui.streetview.date.text(moment(imageDate).format('MMM YYYY'));
        // }
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param data The pano data returned from the StreetViewService (if using GsvViewer)
     * @private
     */
    function _panoSuccessCallback(data) {
        const panoId = svl.panoViewer.getPanoId();

        if (typeof panoId === "undefined" || panoId.length === 0) {
            if ('compass' in svl) svl.compass.update();
            return Promise.resolve();
        }

        // Mark that we visited this pano so that we can tell if they've gotten stuck.
        svl.stuckAlert.panoVisited(panoId);

        // Updates peg location on minimap to match current panorama location.
        const panoramaPosition = svl.panoViewer.getPosition();
        if (svl.minimap) svl.minimap.setMinimapLocation(panoramaPosition);

        // povChange["status"] = true;
        if (svl.canvas) { // TODO this if statement is new, need to decide when each thing is initialized.
            svl.canvas.clear();
            svl.canvas.setOnlyLabelsOnPanoAsVisible(panoId);
            svl.canvas.render();
        }
        // povChange["status"] = false;

        svl.tracker.push("PanoId_Changed", {
            panoId: panoId,
            lat: panoramaPosition.lat,
            lng: panoramaPosition.lng,
            // TODO need to figure out what to do for Infra3d here.
            // cameraHeading: data.tiles.originHeading,
            // cameraPitch: -data.tiles.originPitch, // cameraPitch is negative originPitch.
        });

        if ('compass' in svl) {
            svl.compass.update();
        }

        // Pieces that are different based on the viewer type: recording pano metadata, updating pano date.
        _panoChangeSuccessCallbackHelper(data);
        return Promise.resolve();
    }

    // TODO I'd like to pass the pano ID or lat/lng in to here if possible?
    function _panoFailureCallback(error) {
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
        $('#nav-arrows').hide();
    }

    function showNavArrows() {
        $('#nav-arrows').show();
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
     * Create an svg navigation arrow.
     * TODO move this to icons.scala.html once we've settled on a design, or get one from FontAwesome/NounProject.
     * @returns {SVGPathElement}
     * @private
     */
    function _createArrow() {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M15 0 L25 10 L20 10 L20 20 L10 20 L10 10 L5 10 Z');
        path.setAttribute('fill', 'white');
        path.setAttribute('stroke', 'black');
        path.setAttribute('stroke-width', '2');
        return path;
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
        // povChange["status"] = true;
        updateCanvas();
        // povChange["status"] = false;

        svl.compass.update();
        svl.observedArea.update();

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
        await svl.panoViewer.setPano(panoId).then(_panoSuccessCallback, _panoFailureCallback);
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param latLng An object with properties lat and lng representing the desired location.
     */
    async function setLocation(latLng) {
        await svl.panoViewer.setPosition(latLng).then(_panoSuccessCallback, _panoFailureCallback);
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
     * Update POV of Street View as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov(dx, dy) {
        let pov = svl.panoViewer.getPov();
        // TODO not sure why Infra3d viewer pans so slowly, or doesn't pan at all if we dx/dy is small.
        const viewerScaling = panoViewerType === Infra3dViewer ? 3 : 0.375;
        pov.heading -= dx * viewerScaling;
        pov.pitch += dy * viewerScaling;
        pov = _restrictViewport(pov);
        povChange["status"] = true;

        // Update the Street View image.
        setPov(pov);
    }

    /**
     * Changes the Street View pov. If a transition duration is given, smoothly updates the pov over that time.
     * @param pov Target pov
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
                } else {
                    // Set the pov to adjust zoom level, then clear the interval. Invoke a callback if there is one.
                    if (!pov.zoom) {
                        pov.zoom = 1;
                    }

                    svl.panoViewer.setPov(pov);
                    window.clearInterval(interval);
                    if (callback) {
                        callback();
                    }
                }
            }, timeSegment);
        } else {
            svl.panoViewer.setPov(pov);
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
        var pov = svl.panoViewer.getPov();
        var newPov = {
            heading: Math.round(svl.compass.getTargetAngle() + 360) % 360,
            pitch: pov.pitch,
            zoom: pov.zoom
        }
        setPov(newPov, durationMs);
    }

    /*
     * Gets the pov change tracking variable.
     */
    function getPovChangeStatus() {
        return povChange;
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

    /**
     * Make navigation arrows blink.
     * TODO needs to be updated to work with new arrow implementation.
     */
    function blinkNavigationArrows() {
        setTimeout(() => {
            const arrows = document.querySelector("div.gmnoprint.SLHIdE-sv-links-control").querySelector("svg").querySelectorAll("path[fill-opacity='1']");
            // Obtain interval id to allow for the interval to be cleaned up after the arrow leaves document context.
            const intervalId = window.setInterval(function () {
                // Blink logic.
                arrows.forEach((arrow) => {
                    arrow.setAttribute("fill", (arrow.getAttribute("fill") === "white" ? "yellow" : "white"));

                    // Once the arrow is removed from the document, stop the interval for all arrows.
                    if (!document.body.contains(arrow)) window.clearInterval(intervalId);
                });
            }, 500);
        }, 500);
    }

    function getStatus(key) {
        return status[key];
    }

    /**
     * If the user is going through the tutorial, it will return the custom/stored panorama for either the initial
     * tutorial view or the "after walk" view.
     * @param pano - the pano ID/name of the wanted custom panorama.
     * @returns custom Google Street View panorama.
     * */
    function _getCustomPanorama(pano) {
        if (pano === 'tutorial') {
            return {
                location: {
                    pano: 'tutorial',
                    latLng: new google.maps.LatLng(38.94042608, -77.06766133)
                },
                links: [],
                imageDate: '2014-05',
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(2048, 1024),
                    worldSize: new google.maps.Size(4096, 2048),
                    centerHeading: 50.3866,
                    originHeading: 50.3866,
                    originPitch: -1.13769,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return `${svl.rootDirectory}img/onboarding/tiles/tutorial/${zoom}-${tileX}-${tileY}.jpg`;
                    }
                }
            };
        } else if (pano === 'afterWalkTutorial') {
            return {
                location: {
                    pano: 'afterWalkTutorial',
                    latLng: new google.maps.LatLng(38.94061618, -77.06768201)
                },
                links: [],
                imageDate: '2014-05',
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(1700, 850),
                    worldSize: new google.maps.Size(3400, 1700),
                    centerHeading: 344,
                    originHeading: 344,
                    originPitch: 0,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return `${svl.rootDirectory}img/onboarding/tiles/afterwalktutorial/${zoom}-${tileX}-${tileY}.jpg`;
                    }
                }
            };
        }
    }

    self.setPov = setPov;
    self.setHeadingRange = setHeadingRange;
    self.setPovToRouteDirection = setPovToRouteDirection;
    self.updateCanvas = updateCanvas;
    self.hideNavArrows = hideNavArrows;
    self.showNavArrows = showNavArrows;
    self.resetNavArrows = resetNavArrows;
    self.setPanorama = setPanorama;
    self.setLocation = setLocation;
    self.setZoom = setZoom;
    self.getPovChangeStatus = getPovChangeStatus;
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
