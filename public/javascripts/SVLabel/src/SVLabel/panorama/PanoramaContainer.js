async function PanoramaContainer (panoViewerType, params = {}) {
    let panoCanvas = document.getElementById('pano');
    let status = {
        bottomLinksClickable: false,
        panoLinkListenerSet: false
    }
    let container = {};
    let _panoChangeSuccessCallbackHelper = null;
    let linksListener = null;

    let self = this;

    /**
     * Initializes panoViewer on the Explore page, sets it to the starting location, and sets up listeners.
     * @private
     */
    async function _init() {
        const panoOptions = {
            linksControl: true,
            keyboardShortcuts: true
        }

        // Load the pano viewer.
        svl.panoViewer = await panoViewerType.create(panoCanvas, panoOptions);
        // svl.panoViewer = await Infra3dViewer.create(panoCanvas, panoOptions);
        svl.panoViewer.addListener('pov_changed', _handlerPovChange);

        if (panoViewerType === GsvViewer) {
            _panoChangeSuccessCallbackHelper = _successCallbackHelperGsv;
        } else if (panoViewerType === Infra3dViewer) {
            _panoChangeSuccessCallbackHelper = _successCallbackHelperInfra3d;
        }

        // Move to the specified starting location.
        if ('startPanoId' in params) {
            await setPanorama(params.startPanoId);
        } else if ('startLat' in params && 'startLng' in params) {
            await setLocation(params.startLat, params.startLng);
        }

        // TODO we probably need to do this for any viewer type...
        linksListener = svl.panoViewer.panorama.addListener('links_changed', makeArrowsAndLinksClickable);

        // TODO not sure why this didn't work at first glance.
        // svl.panoViewer.panorama.registerPanoProvider(function(pano) {
        //     if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
        //         return _getCustomPanorama(pano);
        //     }
        //     return null;
        // });
        // svl.panoramaContainer.addPanoMetadata('tutorial', _getCustomPanorama('tutorial'));
        // svl.panoramaContainer.addPanoMetadata('afterWalkTutorial', _getCustomPanorama('afterWalkTutorial'));
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
        var panoId = svl.panoViewer.getPanoId();

        // Record the pano metadata.
        addPanoMetadata(panoId, data);

        // Show the pano date in the bottom-left corner.
        svl.ui.date.text(moment(data.imageDate).format('MMM YYYY'));
        // else if (panoId === "tutorial" || panoId === "afterWalkTutorial") {
        //     // TODO I'm not sure how registering our own panos works for this.
        //     const imageDate = getPanoData(panoId).data().imageDate;
        //     svl.ui.date.text(moment(imageDate).format('MMM YYYY'));
        // }
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param data The pano data returned from the StreetViewService (if using GsvViewer)
     * @private
     */
    function _panoSuccessCallback(data) {
        var panoId = svl.panoViewer.getPanoId();

        if (typeof panoId === "undefined" || panoId.length === 0) {
            if ('compass' in svl) svl.compass.update();
            return Promise.resolve();
        }

        // Mark that we visited this pano so that we can tell if they've gotten stuck.
        svl.stuckAlert.panoVisited(panoId);

        // Updates peg location on minimap to match current panorama location.
        const panoramaPosition = svl.panoViewer.getPosition();
        if (svl.map) svl.map.setMinimapLocation(panoramaPosition);

        // povChange["status"] = true;
        if (svl.canvas) { // TODO this if statement is new, need to decide when each thing is initialized.
            svl.canvas.clear();
            svl.canvas.setOnlyLabelsOnPanoAsVisible(panoId);
            svl.canvas.render();
        }
        // povChange["status"] = false;

        // console.log(data);
        svl.tracker.push("PanoId_Changed", {
            panoId: panoId,
            lat: panoramaPosition.lat,
            lng: panoramaPosition.lng,
            cameraHeading: data.tiles.originHeading,
            cameraPitch: -data.tiles.originPitch, // cameraPitch is negative originPitch.
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
        const currentTask = svl.taskContainer.getCurrentTask();
        if (currentTask) {
            util.misc.reportNoStreetView(currentTask.getStreetEdgeId());
            // TODO not sure if below is the generic version that we want... It's from handleImageryNotFound().
            // TODO it's not, in initNextTask currentTask is still set to the old task while we test the next one.
            // console.error("Error Type: " + JSON.stringify(error) +
            //     "\nNo Street View found at this location: " + panoId + " street " + currentTask.getStreetEdgeId() +
            //     "\nNeed to move to a new location.");
        }

        svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoId});

        // Move to a new location
        svl.map.jumpImageryNotFound(); // TODO it's private right now

        console.error('Error loading panorama:', error);
        return Promise.resolve();
    }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around.
     */
    const makeArrowsAndLinksClickable = function() {
        // Bring the links on the bottom of GSV and the mini map to the top layer so they are clickable.
        var bottomLinks = $('.gm-style-cc');
        if (!status.bottomLinksClickable && bottomLinks.length > 7) {
            status.bottomLinksClickable = true;
            bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
            bottomLinks[4].remove(); // Remove mini map keyboard shortcuts link.
            bottomLinks[5].remove(); // Remove mini map copyright text (duplicate of GSV).
            bottomLinks[7].remove(); // Remove mini map terms of use link (duplicate of GSV).
            svl.ui.map.viewControlLayer.append($(bottomLinks[1]).parent().parent());
            svl.ui.minimap.overlay.append($(bottomLinks[8]).parent().parent());
        }

        // Bring the layer with arrows forward.
        var $navArrows = svl.ui.map.pano.find('svg').parent();
        svl.ui.map.viewControlLayer.append($navArrows);

        // Add an event listener to the nav arrows to log their clicks.
        if (!status.panoLinkListenerSet && $navArrows.length > 0) {
            // TODO We are adding click events to extra elements that don't need it, we shouldn't do that :)
            $navArrows[0].addEventListener('click', function (e) {
                var targetPanoId = e.target.getAttribute('pano');
                if (targetPanoId) {
                    svl.tracker.push('WalkTowards', {'TargetPanoId': targetPanoId});
                }
            });
            status.panoLinkListenerSet = true;
        }

        if (util.getBrowser() === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            svl.ui.map.viewControlLayer.append(svl.ui.map.canvas);
        }
        google.maps.event.removeListener(linksListener);
    }

    function updateCanvas() {
        svl.canvas.clear();
        if (status.currPanoId !== svl.panoViewer.getPanoId()) {
            svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
        }
        status.currPanoId = svl.panoViewer.getPanoId();
        svl.canvas.render();
    }
    this.updateCanvas = updateCanvas;

    /**
     * Callback for pov update.
     */
    function _handlerPovChange() {
        // povChange["status"] = true;
        if (svl.canvas) { // TODO this if statement is new, need to decide when each thing is initialized.
            updateCanvas();
        }
        // povChange["status"] = false;

        if ("compass" in svl) { svl.compass.update(); }
        if ("observedArea" in svl) { svl.observedArea.update(); }

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
     * @param lat The latitude of the desired location.
     * @param lng The longitude of the desired location.
     */
    async function setLocation(lat, lng) {
        await svl.panoViewer.setPosition(lat, lng).then(_panoSuccessCallback, _panoFailureCallback);
    }


    /**
     * Sets the zoom level for this panorama.
     * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
     */
    function setZoom (zoom) {
        const currPov = svl.panoViewer.getPov();
        currPov.zoom = Math.round(zoom);
        svl.panoViewer.setPov(currPov);
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

    /**
     * This method adds panorama data into the container.
     * @param panoramaId
     * @param panoramaMetadata
     */
    function addPanoMetadata(panoramaId, panoramaMetadata) {
        if (!(panoramaId in container)) {
            if (panoramaId === 'tutorial' || panoramaId === 'tutorialAfterWalk') {
                panoramaMetadata.submitted = true;
            }
            container[panoramaId] = new Panorama(panoramaMetadata);
        }
    }

    /**
     * This method returns the existing panorama data.
     * @param panoramaId
     */
    function getPanoData(panoramaId) {
        return panoramaId in container ? container[panoramaId] : null;
    }

    /**
     * Get all the panorama instances stored in the container.
     * @returns {Array}
     */
    function getAllPanoData() {
        return Object.keys(container).map(function (panoramaId) { return container[panoramaId]; });
    }

    /**
     * Get panorama instances that have not been submitted to the server.
     * @returns {Array}
     */
    function getStagedPanoData() {
        let panoramas = getAllPanoData();
        panoramas = panoramas.filter(function (pano) { return !pano.getProperty('submitted'); });
        return panoramas;
    }

    self.addPanoMetadata = addPanoMetadata;
    self.getPanoData = getPanoData;
    self.getAllPanoData = getAllPanoData;
    self.getStagedPanoData = getStagedPanoData;
    self.setPanorama = setPanorama;
    self.setLocation = setLocation;
    self.setZoom = setZoom;

    await _init();

    return this;
}
