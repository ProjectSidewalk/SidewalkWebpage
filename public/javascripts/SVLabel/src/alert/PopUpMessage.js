/**
 *
 * @param form
 * @param taskContainer
 * @param tracker
 * @param user
 * @param uiPopUpMessage
 * @returns {{className: string}}
 * @constructor
 */
function PopUpMessage (form, taskContainer, tracker, user, uiPopUpMessage) {
    const status = { haveAskedToSignIn: false, signUp: false, isVisible: false };
    let buttons = [];

    this.getStatus = (key) => {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    this.disableInteractions = () => {
        svl.panoManager.hideNavArrows();
        svl.navigationService.disableWalking();
        svl.panoManager.unlockDisablePanning();
        svl.panoManager.disablePanning();
        svl.canvas.disableLabeling();
        svl.keyboard.disableKeyboard();
    };

    this.enableInteractions = () => {
        svl.panoManager.showNavArrows();
        svl.navigationService.enableWalking();
        svl.panoManager.enablePanning();
        svl.canvas.enableLabeling();
        svl.keyboard.enableKeyboard();
    };

    const _attachCallbackToClickOk = (callback) => {
        $("#pop-up-message-ok-button").one('click', callback);
    };

    const _appendButton = (buttonDom, callback) => {
        const $button = $(buttonDom);
        $button.css({ margin: '0 10 10 0' });
        $button.addClass('button');
        uiPopUpMessage.buttonHolder.append($button);

        if (callback) {
            $button.one('click', callback);
        }
        $button.one('click', this.hide);
        buttons.push($button);
    };

    const _appendOkButton = () => {
        const OkButton = '<button id="pop-up-message-ok-button">OK</button>';
        const handleClickOk = () => {
            tracker.push('PopUpMessage_ClickOk');
            this.enableInteractions();
            $("#pop-up-message-ok-button").remove();
            $("#pop-up-message-image").remove();
        }
        _appendButton(OkButton, handleClickOk);

        $(document).keyup((e) => {
            // Enter works the same as clicking OK.
            if (e.keyCode === 13) {
                tracker.push('KeyboardShortcut_ClickOk');
                $("#pop-up-message-ok-button").trigger('click', { lowLevelLogging: false });
            }
        });
    };

    this.haveAskedToSignIn = () => {
        return status.haveAskedToSignIn;
    };

    /**
     * Hides the message box.
     */
    this.hide = () => {
        uiPopUpMessage.holder.removeClass('visible');
        uiPopUpMessage.holder.addClass('hidden');
        if (!status.signUp) {
            this.enableInteractions();
        }
        this.hideBackground();  // hide background
        this.reset();  // reset all the parameters
        status.isVisible = false;
        return this;
    };

    /**
     * Hides the background
     */
    this.hideBackground = () => {
        uiPopUpMessage.holder.css({ width: '', height: '' });
    };

    /**
     * Prompt a user who's not logged in to sign up/sign in.
     */
    this.promptSignIn = () => {
        uiPopUpMessage.buttonHolder.html("");
        _setTitle(i18next.t('popup.signup-title'));
        _setMessage(i18next.t('popup.signup-body'));
        const task = taskContainer.getCurrentTask();

        // Add the 'Sign up' button.
        const signUpHtml = `<button id="pop-up-message-sign-up-button">${i18next.t('common:sign-up')}</button>`;
        const signUpCallback = () => {
            tracker.push('PopUpMessage_SignUpClickYes', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });
            status.signUp = true;
            $("#sign-in-modal").addClass("hidden");
            $("#sign-up-modal").removeClass("hidden");
            $('#sign-in-modal-container').modal('show');
        };
        _appendButton(signUpHtml, signUpCallback);

        // Add the 'Sign in' button.
        const signInHtml = `<button id="pop-up-message-sign-in-button">${i18next.t('common:sign-in')}</button>`;
        const signInCallback = () => {
            tracker.push('PopUpMessage_SignInClick', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });

            $("#sign-in-modal").removeClass("hidden");
            $("#sign-up-modal").addClass("hidden");
            $('#sign-in-modal-container').modal('show');
        };
        _appendButton(signInHtml, signInCallback);

        // Add the 'No' button.
        const noHtml = `<button id="pop-up-message-cancel-button">${i18next.t('common:no')}</button>`;
        const noCallback = () => {
            tracker.push('PopUpMessage_SignUpClickNo', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });
        };
        _appendButton(noHtml, noCallback);

        // Show the notification.
        _setPosition(48, 260, 640);
        this.show();
        status.haveAskedToSignIn = true;
    };

    /**
     * Notification
     * @param {string} title HTML content to add to the h2 header for the pop-up
     * @param {string} message HTML content to add to the p body for the pop-up
     * @param {function} callback function to call when the user clicks OK to dismiss the pop-up
     * @returns {boolean} Returns true if the message is shown, false if it isn't (because another is already visible)
     */
    this.notify = (title, message, callback) => {
        if (status.isVisible) {
            console.trace('ALREADY GOT ONE');
            return false;
        } else {
            _setPosition(48, 260, 640);
            this.show();
            _setTitle(title);
            _setMessage(message);
            _appendOkButton();
            if (callback) _attachCallbackToClickOk(callback);
            return true;
        }
    };

    /**
     * Notification with image
     * @param {string} title HTML content to add to the h2 header for the pop-up
     * @param {string} message HTML content to add to the p body for the pop-up
     * @param {string} image URL of the image to add to the pop-up
     * @param {string} width width of the image, including units
     * @param {string} height height of the image, including units
     * @param {string} x left position of the image, including units
     * @param {function} callback function to call when the user clicks OK to dismiss the pop-up
     * @returns {boolean} Returns true if the message is shown, false if it isn't (because another is already visible)
     */
    this.notifyWithImage = (title, message, image, width, height, x, callback) => {
        if (status.isVisible) {
            return false;
        } else {
            _setPosition(48, 147, 640);
            this.show();
            _setTitle(title);
            _setMessage(message);
            _setImage(image, width, height, x);
            _appendOkButton();
            if (callback) _attachCallbackToClickOk(callback);
            return true;
        }
    };

    /**
     * Reset all the parameters.
     */
    this.reset = () => {
        uiPopUpMessage.holder.css({ width: '', height: '' });
        uiPopUpMessage.imageHolder.css({ width: '', height: '', left: '' });
        uiPopUpMessage.foreground.css({
            left: '',
            top: '',
            width: '',
            height: '',
            zIndex: ''
        });

        uiPopUpMessage.foreground.css('padding-bottom', '');

        for (let i = 0; i < buttons.length; i++ ){
            try {
                buttons[i].remove();
            } catch (e) {
                console.warn("Button does not exist.", e);
            }
        }
        buttons = [];
        status.signUp = false;
    };

    /**
     * This method shows a message box on the page.
     */
    this.show = () => {
        this.disableInteractions();
        _showBackground();

        uiPopUpMessage.holder.removeClass('hidden');
        uiPopUpMessage.holder.addClass('visible');
        status.isVisible = true;
        return this;
    };

    /**
     * Show a semi-transparent background to block people to interact with other parts of the interface.
     */
    const _showBackground = () => {
        uiPopUpMessage.holder.css({ width: '100%', height: '100%' });
    };

    /**
     * Sets the title
     */
    const _setTitle = (title) => {
        uiPopUpMessage.title.html(title);
    };

    /**
     * Sets the message.
     */
    const _setMessage = (message) => {
        uiPopUpMessage.content.html(message);
    };

    /**
     * Adds an image to the pop-up window.
     */
    const _setImage = (image, width, height, x) => {
        const imageHtml = `<img src=${image} id="pop-up-message-image"/>`;
        const $img = $(imageHtml);
        $img.css({ cursor: 'default', width: width, height: height, left: x });
        $img.addClass('img');
        uiPopUpMessage.imageHolder.append($img);
    };

    /*
     * Sets the position of the message.
     */
    const _setPosition = (x, y, width, height) => {
        uiPopUpMessage.foreground.css({
            left: x,
            top: y,
            width: width,
            height: height,
            zIndex: 2
        });
        return this;
    };
}
