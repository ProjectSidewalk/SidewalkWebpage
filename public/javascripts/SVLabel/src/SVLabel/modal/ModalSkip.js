/**
 * ModalSkip module.
 * Todo. Too many dependencies. Break down the features.
 * Todo. Uandling uiLeftColumn (menu on the left side of the interface) should not be this module's responsibility
 * Todo. Some of the responsibilities in `_handleClickOK` method should be delegated to ModalModel or other modules.
 * @param form
 * @param modalModel
 * @param navigationModel
 * @param ribbonMenu
 * @param taskContainer
 * @param tracker
 * @param uiLeftColumn
 * @param uiModalSkip
 * @constructor
 */
function ModalSkip (form, modalModel, navigationModel, ribbonMenu, taskContainer, tracker, uiLeftColumn, uiModalSkip) {
    var self = this;
    this._modalModel = modalModel;
    var status = {
        disableClickOK: true
    };
    var blinkInterval;

    /**
     * Disable clicking the ok button
     */
    this._disableClickOK = function () {
        uiModalSkip.ok.attr("disabled", true);
        uiModalSkip.ok.addClass("disabled");
        status.disableClickOK = true;
    };

    /**
     * Enable clicking the ok button
     */
    this._enableClickOK = function () {
        uiModalSkip.ok.attr("disabled", false);
        uiModalSkip.ok.removeClass("disabled");
        status.disableClickOK = false;
    };

    /**
     * Callback for clicking jump button
     * @param e
     */
    this._handleClickJump = function (e) {
        e.preventDefault();
        tracker.push('ModalSkip_ClickJump');
        self.showSkipMenu();
    };


    /**
     * This method handles a click OK event
     * @param e
     */
    this._handleClickOK = function (e) {
        tracker.push("ModalSkip_ClickOK");
        var radioValue = $('input[name="modal-skip-radio"]:checked', '#modal-skip-content').val();


        var position = navigationModel.getPosition();
        var incomplete = {
            issue_description: radioValue,
            lat: position.lat,
            lng: position.lng
        };
        var task = taskContainer.getCurrentTask();

        // Set the task's `_paths` to blank so it will not get rendered on the google maps pane.
        task.eraseFromGoogleMaps();

        if (radioValue == "GSVNotAvailable") {
            task.complete();
            taskContainer.push(task);  // Pushed to completed tasks.
            util.misc.reportNoStreetView(task.getStreetEdgeId());
        }


        form.skipSubmit(incomplete, task);
        taskContainer.initNextTask();

        ribbonMenu.backToWalk();

        self.hideSkipMenu();
    }

    /**
     * This method handles a click Cancel event
     * @param e
     */
    this._handleClickCancel = function (e) {
        tracker.push("ModalSkip_ClickCancel");
        self.hideSkipMenu();
    }

    /**
     * This method takes care of nothing.
     * @param e
     */
    this._handleClickRadio = function (e) {
        tracker.push("ModalSkip_ClickRadio");
        self._enableClickOK();
    }

    /**
     * Blink the jump button
     */
    this.blink = function () {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiLeftColumn.jump.toggleClass("highlight-50");
        }, 500);
    };

    /**
     * Hide a skip menu
     */
    this.hideSkipMenu = function () {
        uiModalSkip.radioButtons.prop('checked', false);
        uiModalSkip.holder.addClass('hidden');
    };

    /**
     * Show a skip menu
     */
    this.showSkipMenu = function () {
        uiModalSkip.holder.removeClass('hidden');
        this._disableClickOK();
    };

    /**
     * Stop blinking the jump button
     */
    this.stopBlinking = function () {
        window.clearInterval(blinkInterval);
        uiLeftColumn.jump.removeClass("highlight-50");
    };

    // Initialize
    this._disableClickOK();
    uiModalSkip.ok.bind("click", this._handleClickOK);
    uiModalSkip.cancel.bind("click", this._handleClickCancel);
    uiModalSkip.radioButtons.bind("click", this._handleClickRadio);
    uiLeftColumn.jump.on('click', this._handleClickJump);
}
