/**
 * ModalSkip module.
 * Todo. Too many dependencies. Break down the features.
 * Todo. handling uiLeftColumn (menu on the left side of the interface) should be LeftMenu's responsibility
 * Todo. Some of the responsibilities in `_handleClickOK` method should be delegated to ModalModel or other modules.
 * @constructor
 */
function ModalSkip(form, modalModel, navigationModel, streetViewService, onboardingModel, ribbonMenu, taskContainer, tracker, uiLeftColumn, uiModalSkip) {
    var self = this;
    var status = {
        disableClickOK: true
    };
    var blinkInterval;
    var stuckPanos = [];

    onboardingModel.on("Onboarding:startOnboarding", function() {
        self.hideSkipMenu();
    });

    /**
     * Callback for clicking jump button.
     * @param e
     */
    this._handleClickJump = function(e) {
        e.preventDefault();
        tracker.push('ModalSkip_ClickJump');
        svl.modalComment.hide();
        self.showSkipMenu();
    };

    function _turfPointToGoogleLatLng(point) {
        return new google.maps.LatLng(point.geometry.coordinates[1], point.geometry.coordinates[0]);
    }

    /**
     * Callback for clicking stuck button.
     */
    this._handleClickStuck = function(e) {
        e.preventDefault();
        tracker.push('ModalStuck_ClickStuck');
        svl.modalComment.hide();
        // TODO show loading icon.

        // Grab street geometry and current location.
        var currentTask = taskContainer.getCurrentTask();
        var streetEdge = currentTask.getFeature();
        var currentPano = svl.map.getPanoId();
        var point = svl.map.getPosition();
        var currPos = turf.point([point.lng, point.lat]);
        var streetEndpoint = turf.point([currentTask.getLastCoordinate().lng, currentTask.getLastCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        var remainder = turf.lineSlice(currPos, streetEndpoint, streetEdge);
        currPos = turf.point([remainder.geometry.coordinates[0][0], remainder.geometry.coordinates[0][1]]);
        var gLatLng = _turfPointToGoogleLatLng(currPos);

        // Save the current pano ID as one that you're stuck at.
        if (!stuckPanos.includes(currentPano)) stuckPanos.push(currentPano);

        // Set radius around each attempted point for which you'll accept GSV imagery to 10 meters.
        var MAX_DIST = 10;
        // Set how far to move forward along the street for each new attempt at finding imagery to 10 meters.
        var DIST_INCREMENT = 0.01;

        var GSV_SRC = google.maps.StreetViewSource.OUTDOOR;
        var GSV_OK = google.maps.StreetViewStatus.OK;
        var line;
        var end;

        // Callback function when querying GSV for imagery using streetViewService.getPanorama. If we don't find imagery
        // here, recursively call getPanorama with this callback function to test another 10 meters down the street.
        var callback = function(streetViewPanoramaData, status) {
            // If there is no imagery here that we haven't already been stuck in, either try further down the street,
            // try with a larger radius, or just jump to a new street if all else fails.
            if (status !== GSV_OK || stuckPanos.includes(streetViewPanoramaData.location.pano)) {

                // If there is room to move forward then try again, recursively calling getPanorama with this callback.
                if (turf.length(remainder) > 0) {
                    // Save the current pano ID as one that doesn't work.
                    if (status === GSV_OK) {
                        stuckPanos.push(streetViewPanoramaData.location.pano);
                    }
                    // Set `currPos` to be `DIST_INCREMENT` further down the street. Use `lineSliceAlong` to find that
                    // next point, and use `lineSlice` to remove the piece we just moved past from `remainder`.
                    line = turf.lineSliceAlong(remainder, 0, DIST_INCREMENT);
                    end = line.geometry.coordinates.length - 1;
                    currPos = turf.point([line.geometry.coordinates[end][0], line.geometry.coordinates[end][1]]);
                    remainder = turf.lineSlice(currPos, streetEndpoint, remainder);
                    gLatLng = _turfPointToGoogleLatLng(currPos);
                    streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
                } else if (MAX_DIST === 10 && status !== GSV_OK) {
                    // If we get to the end of the street, increase the radius a bit to try and drop them at the end.
                    MAX_DIST = 25;
                    gLatLng = _turfPointToGoogleLatLng(currPos);
                    streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
                } else {
                    // If all else fails, jump to a new street.
                    tracker.push("ModalStuck_GSVNotAvailable");
                    form.skip(currentTask, "GSVNotAvailable");
                    svl.stuckAlert.stuckSkippedStreet();
                }
            } else if (status === GSV_OK) {
                // Save current pano ID as one that doesn't work in case they try to move before clicking 'stuck' again.
                stuckPanos.push(streetViewPanoramaData.location.pano);
                // Move them to the new pano we found.
                svl.map.setPositionByIdAndLatLng(
                    streetViewPanoramaData.location.pano,
                    currPos.geometry.coordinates[1],
                    currPos.geometry.coordinates[0]
                );
                tracker.push('ModalStuck_Unstuck');
                svl.stuckAlert.stuckClicked();
            }
        };

        // Initial call to getPanorama with using the recursive callback function.
        streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
    }

    /**
     * This method handles a click Unavailable event.
     * @param e
     */
    this._handleClickUnavailable = function(e) {
        tracker.push("ModalSkip_ClickUnavailable");
        var task = taskContainer.getCurrentTask();
        form.skip(task, "GSVNotAvailable");

        ribbonMenu.backToWalk();
        self.hideSkipMenu();
    };

    /**
     * This method handles a click Continue Neighborhood event.
     * @param e
     */
    this._handleClickContinueNeighborhood = function(e) {
        tracker.push("ModalSkip_ClickContinueNeighborhood");
        uiModalSkip.secondBox.hide();
        uiModalSkip.firstBox.show();
        var task = taskContainer.getCurrentTask();
        form.skip(task, "IWantToExplore");

        ribbonMenu.backToWalk();
        self.hideSkipMenu();
    };

    /**
     * This method handles a click Redirect event.
     * @param e
     */
     this._handleClickRedirect = function(e) {
        tracker.push("ModalSkip_ClickRedirect");
         window.location.replace('/audit?nextRegion=regular');
     };

    /**
     * This method handles a click Explore event.
     * @param e
     */
     this._handleClickExplore = function(e) {
        tracker.push("ModalSkip_ClickExplore");
         uiModalSkip.firstBox.hide();
         uiModalSkip.secondBox.show();
     };

    /**
     * This method handles a click Cancel event on the first jump screen.
     * @param e
     */
    this._handleClickCancelFirst = function(e) {
        tracker.push("ModalSkip_ClickCancelFirst");
        self.hideSkipMenu();
    };

    /**
     * This method handles a click Cancel event on the second jump screen.
     * @param e
     */
    this._handleClickCancelSecond = function(e) {
        tracker.push("ModalSkip_ClickCancelSecond");
        uiModalSkip.secondBox.hide();
        uiModalSkip.firstBox.show();
        self.hideSkipMenu();
    };

    /**
     * Blink the jump button.
     * Todo. This should be moved LeftMenu.js
     */
    this.blink = function() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiLeftColumn.jump.toggleClass("highlight-100");
        }, 500);
    };

    /**
     * Hide the skip menu.
     */
    this.hideSkipMenu = function() {
        uiModalSkip.holder.addClass('hidden');
        svl.popUpMessage.enableInteractions();
        self.hideBackground();
    };

    /**
     * Show the skip menu.
     */
    this.showSkipMenu = function() {
        uiModalSkip.holder.removeClass('hidden');
        svl.popUpMessage.disableInteractions();
        self.showBackground();
    };

    this.hideBackground = function() {
        $('#modal-skip-background').css({ width: '', height: ''})
    };

    this.showBackground = function() {
        $('#modal-skip-background').css("background-color", "white");
        $('#modal-skip-background').css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });
    };

    /**
     * Stop blinking the jump button.
     * Todo. This should be moved to LeftMenu.js
     */
    this.stopBlinking = function() {
        window.clearInterval(blinkInterval);
        uiLeftColumn.jump.removeClass("highlight-100");
    };

    // Initialize
    uiModalSkip.unavailable.bind("click", this._handleClickUnavailable);
    uiModalSkip.continueNeighborhood.bind("click", this._handleClickContinueNeighborhood);
    uiModalSkip.cancelFirst.bind("click", this._handleClickCancelFirst);
    uiModalSkip.cancelSecond.bind("click", this._handleClickCancelSecond);
    uiModalSkip.redirect.bind("click", this._handleClickRedirect);
    uiModalSkip.explore.bind("click", this._handleClickExplore);
    uiLeftColumn.jump.on('click', this._handleClickJump);
    uiLeftColumn.stuck.on('click', this._handleClickStuck);
}
