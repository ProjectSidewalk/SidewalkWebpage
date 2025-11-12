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
     * Event Handlers:
     */

    /**
     * Callback for clicking jump button.
     * @param e
     */
    this._handleClickJump = (e) => {
        e.preventDefault();
        tracker.push('ModalSkip_ClickJump');
        svl.modalComment.hide();
        uiModalSkip.box.show();
        self.showSkipMenu();
    };

    /**
     * Callback for clicking stuck button.
     *
     * The algorithm searches for available imagery along the street you are assigned to. If the pano you are put in
     * doesn't help, you can click the Stuck button again; we save the attempted panos so we'll try something new. If we
     * can't find anything along the street, we just mark it as complete and move you to a new street.
     */
    this._handleClickStuck = (e) => {
        e.preventDefault();
        svl.stuckAlert.compassOrStuckClicked();
        tracker.push('ModalStuck_ClickStuck');
        svl.navigationService.moveForward('ModalStuck_Unstuck', 'ModalStuck_PanoNotAvailable', svl.stuckAlert.stuckClicked);
    }


    /**
     * This method handles a click Continue Neighborhood event.
     * @param e
     */
    this._handleClickContinueNeighborhood = (e) => {
        tracker.push("ModalSkip_ClickContinueNeighborhood");
        uiModalSkip.box.hide();
        var task = taskContainer.getCurrentTask();
        form.skip(task, "IWantToExplore");

        ribbonMenu.backToWalk();
        self.hideSkipMenu();

        // If the user was following a route, refresh the page so that they are no longer on the route.
        if (svl.neighborhoodModel.isRoute) {
            window.location.replace('/explore?resumeRoute=false');
        }
    };

    /**
     * This method handles a click Redirect event.
     * @param e
     */
     this._handleClickNewNeighborhood = (e) => {
        tracker.push("ModalSkip_ClickRedirect");
         window.location.replace('/explore?newRegion=true&resumeRoute=false');
     };

    /**
     * This method handles a click Cancel event on the second jump screen.
     * @param e
     */
    this._handleClickCancel = (e) => {
        tracker.push("ModalSkip_ClickCancel");
        uiModalSkip.box.hide();
        self.hideSkipMenu();
    };

    /**
     * Enable the stuck button
     */
    this.enableStuckButton = () => {
        uiLeftColumn.stuck.on('click', this._handleClickStuck);
    }

    /**
     * Disable the stuck button
     */
    this.disableStuckButton = () => {
        uiLeftColumn.stuck.off('click');
    }

    /**
     * Blink the stuck button.
     * Todo. This should be moved LeftMenu.js
     */
    this.blink = () => {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiLeftColumn.stuck.toggleClass("highlight-100");
        }, 500);
    };

    /**
     * Hide the skip menu.
     */
    this.hideSkipMenu = () => {
        uiModalSkip.holder.addClass('hidden');
        svl.popUpMessage.enableInteractions();
        self.hideBackground();
    };

    /**
     * Show the skip menu.
     */
    this.showSkipMenu = () => {
        uiModalSkip.holder.removeClass('hidden');
        svl.popUpMessage.disableInteractions();
        self.showBackground();
    };

    /**
     * Hide the background of the skip menu.
     * */
    this.hideBackground = () => {
        uiModalSkip.background.css({ width: '', height: ''})
    };

    /**
     * Show the background of the skip menu.
     */
    this.showBackground = () => {
        uiModalSkip.background.css("background-color", "white");
        uiModalSkip.background.css({
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
    this.stopBlinking = () => {
        window.clearInterval(blinkInterval);
        uiLeftColumn.stuck.removeClass("highlight-100");
    };

    // Initialize Event Listeners
    uiModalSkip.continueNeighborhood.bind("click", this._handleClickContinueNeighborhood);
    uiModalSkip.cancel.bind("click", this._handleClickCancel);
    uiModalSkip.newNeighborhood.bind("click", this._handleClickNewNeighborhood);
    uiLeftColumn.jump.on('click', this._handleClickJump);
    self.enableStuckButton();
}
