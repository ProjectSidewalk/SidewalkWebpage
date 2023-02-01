/**
 * ModalSkip module.
 * Todo. Too many dependencies. Break down the features.
 * Todo. handling uiLeftColumn (menu on the left side of the interface) should be LeftMenu's responsibility
 * @constructor
 */
function ModalSkip(form, onboardingModel, ribbonMenu, taskContainer, tracker, uiLeftColumn, uiModalSkip) {
    var self = this;
    var blinkInterval;

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

    this.enableStuckButton = function() {
        uiLeftColumn.stuck.on('click', this._handleClickStuck);
    }

    this.disableStuckButton = function() {
        uiLeftColumn.stuck.off('click');
    }

    /**
     * Callback for clicking stuck button.
     *
     * The algorithm searches for available GSV imagery along the street you are assigned to. If the pano you are put in
     * doesn't help, you can click the Stuck button again; we save the attempted panos so we'll try something new. If we
     * can't find anything along the street, we just mark it as complete and move you to a new street.
     */
    this._handleClickStuck = function(e) {
        e.preventDefault();
        svl.stuckAlert.compassOrStuckClicked();
        tracker.push('ModalStuck_ClickStuck');
        svl.map.moveForward('ModalStuck_Unstuck', 'ModalStuck_GSVNotAvailable', svl.stuckAlert.stuckClicked);
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

        // If the user was following a route, refresh the page so that they are no longer on the route.
        if (svl.userRouteId) {
            window.location.replace('/audit?resumeRoute=false');
        }
    };

    /**
     * This method handles a click Redirect event.
     * @param e
     */
     this._handleClickRedirect = function(e) {
        tracker.push("ModalSkip_ClickRedirect");
         window.location.replace('/audit?newRegion=true&resumeRoute=false');
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
     * Blink the stuck button.
     * Todo. This should be moved LeftMenu.js
     */
    this.blink = function() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiLeftColumn.stuck.toggleClass("highlight-100");
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
        uiLeftColumn.stuck.removeClass("highlight-100");
    };

    // Initialize
    uiModalSkip.unavailable.bind("click", this._handleClickUnavailable);
    uiModalSkip.continueNeighborhood.bind("click", this._handleClickContinueNeighborhood);
    uiModalSkip.cancelFirst.bind("click", this._handleClickCancelFirst);
    uiModalSkip.cancelSecond.bind("click", this._handleClickCancelSecond);
    uiModalSkip.redirect.bind("click", this._handleClickRedirect);
    uiModalSkip.explore.bind("click", this._handleClickExplore);
    uiLeftColumn.jump.on('click', this._handleClickJump);
    self.enableStuckButton();
}
