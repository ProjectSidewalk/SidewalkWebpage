/**
 *
 * @param form
 * @param storage
 * @param taskContainer
 * @param tracker
 * @param user
 * @param onboardingModel
 * @param uiPopUpMessage
 * @returns {{className: string}}
 * @constructor
 */
function PopUpMessage (form, storage, taskContainer, tracker, user, onboardingModel, uiPopUpMessage) {
    var self = this;
    var status = { haveAskedToSignIn: false, signUp: false, isVisible: false};
    var buttons = [];

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });
    this.getStatus = function (key){
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    function disableInteractions () {
        svl.panorama.set('linksControl', false);//disable arrows
        svl.map.disableWalking();
        svl.map.unlockDisablePanning();
        svl.map.disablePanning();
        svl.canvas.disableLabeling();
        svl.keyboard.disableKeyboard();
    }
    function enableInteractions () {
        svl.panorama.set('linksControl', true);//enable arrows
        svl.map.enableWalking();
        svl.map.enablePanning();
        svl.canvas.enableLabeling();
        svl.keyboard.enableKeyboard();
    }
    function _attachCallbackToClickOK (callback) {
        $("#pop-up-message-ok-button").one('click', callback);
    }

    function appendHTML (htmlDom, callback) {
        var $html = $(htmlDom);
        uiPopUpMessage.content.append($html);

        if (callback) {
            $html.on("click", callback);
        }
        $html.on('click', self.hide);
        buttons.push($html);
    }

    this._appendButton = function (buttonDom, callback) {
        var $button = $(buttonDom);
        $button.css({ margin: '0 10 10 0' });
        $button.addClass('button');
        uiPopUpMessage.buttonHolder.append($button);

        if (callback) {
            $button.one('click', callback);
        }
        $button.one('click', self.hide);
        buttons.push($button);
    };

    this._appendOKButton = function () {
        var OKButton = '<button id="pop-up-message-ok-button">OK</button>';
        function handleClickOK () {
            tracker.push('PopUpMessage_ClickOk');
            enableInteractions();
            $("#pop-up-message-ok-button").remove();
            $("#pop-up-message-image").remove();
        }
        self._appendButton(OKButton, handleClickOK);


        $(document).keyup(function (e){
            e = e || window.event; //Handle IE
            //enter
            if (e.keyCode == 13 && !svl.modalMission._status.isOpen) {
                tracker.push('KeyboardShortcut_ClickOk');
                $("#pop-up-message-ok-button").click();
            }
        });
    };

    this.haveAskedToSignIn = function () {
        return status.haveAskedToSignIn;
    };

    /**
     * Hides the message box.
     */
    this.hide = function () {
        uiPopUpMessage.holder.removeClass('visible');
        uiPopUpMessage.holder.addClass('hidden');
        if (!status.signUp){
            enableInteractions();
        }
        self.hideBackground();  // hide background
        self.reset();  // reset all the parameters
        status.isVisible = false;
        return this;
    };

    /**
     * Hides the background
     */
    this.hideBackground = function () {
        uiPopUpMessage.holder.css({ width: '', height: '' });
    };

    /**
     * Prompt a user who's not logged in to sign up/sign in.
     * Todo. I should move this to either User.js or a new module (e.g., SignUp.js?).
     */
    this.promptSignIn = function () {
        uiPopUpMessage.buttonHolder.html("");
        self._setTitle("You've been contributing a lot!");
        self._setMessage("Do you want to create an account to keep track of your progress?");
        disableInteractions(); //disable interactions while msg up
        self._appendButton('<button id="pop-up-message-sign-up-button" class="float" style = "margin-right:10px">Let me sign up!</button>', function () {
            // Store the data in LocalStorage.
            var task = taskContainer.getCurrentTask();

            tracker.push('PopUpMessage_SignUpClickYes', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });
            var data = form.compileSubmissionData(task),
                staged = storage.get("staged");
            staged.push(data);
            storage.set("staged", staged);
            disableInteractions();
            status.signUp = true;
            $("#sign-in-modal").addClass("hidden");
            $("#sign-up-modal").removeClass("hidden");
            $('#sign-in-modal-container').modal('show');
        });
        self._appendButton('<button id="pop-up-message-cancel-button" class="float">No</button>', function () {

            // Submit the data as an anonymous user.
            user.setProperty('firstTask', false);

            var task = taskContainer.getCurrentTask();
            tracker.push('PopUpMessage_SignUpClickNo', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });

            var data = form.compileSubmissionData(task);
            form.submit(data, task);
        });
        appendHTML('<br class="clearBoth"/><p><a id="pop-up-message-sign-in">' +
            '<small><span style="text-decoration: underline; cursor: pointer;">I do have an account! Let me sign in.</span></small>' +
            '</a></p>', function () {

            var task = taskContainer.getCurrentTask();

            tracker.push('PopUpMessage_SignInClick', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });
            var data = form.compileSubmissionData(task),
                staged = storage.get("staged");
            staged.push(data);
            storage.set("staged", staged);

            $("#sign-in-modal").removeClass("hidden");
            $("#sign-up-modal").addClass("hidden");
            $('#sign-in-modal-container').modal('show');
        });
        self._setPosition(48, 260, 640);
        self.show(true);
        status.haveAskedToSignIn = true;
    };

    /**
     * Notification
     * @param title
     * @param message
     * @param callback
     */
    this.notify = function (title, message, callback) {
        uiPopUpMessage.buttonHolder.html("");
        self._setPosition(48, 260, 640);
        self.show();
        self._setTitle(title);
        self._setMessage(message);
        self._appendOKButton();

        if (callback) {
            _attachCallbackToClickOK(callback);
        }
    };

    /**
     * Notification with image
     * @param title
     * @param image
     * @param callback
     */
    this.notifyWithImage = function (title, message, image, callback) {
        uiPopUpMessage.buttonHolder.html("");
        self._setPosition(48, 147, 640);
        self.show();
        self._setTitle(title);
        self._setMessage(message);
        self._setImage(image);
        self._appendOKButton();

        if (callback) {
            _attachCallbackToClickOK(callback);
        }
    };

    /**
     * Reset all the parameters.
     */
    this.reset = function () {
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

        for (var i = 0; i < buttons.length; i++ ){
            try {
                buttons[i].remove();
            } catch (e) {
                console.warning("Button does not exist.", e);
            }
        }
        buttons = [];
        status.signUp = false;
    };

    /**
     * This method shows a message box on the page.
     */
    this.show = function (disableOtherInteraction) {
        disableInteractions();
        self._showBackground();

        uiPopUpMessage.holder.removeClass('hidden');
        uiPopUpMessage.holder.addClass('visible');
        status.isVisible = true;
        return this;
    };

    /**
     * Show a semi-transparent background to block people to interact with
     * other parts of the interface.
     */
    this._showBackground = function () {
        uiPopUpMessage.holder.css({ width: '100%', height: '100%'});
    };

    /**
     * Sets the title
     */
    this._setTitle = function (title) {
        uiPopUpMessage.title.html(title);
    };

    /**
     * Sets the message.
     */
    this._setMessage = function (message) {
        uiPopUpMessage.content.html(message);
    };
    /**
     * Sets the image
     */
    this._setImage = function (image) {
        var imageHtml = `<img src = ${svl.rootDirectory}` + `${image} id="pop-up-message-image" />`;
        var $img = $(imageHtml);
        $img.css({ cursor: 'default', width: '450px', height: '291px', left: '50px' });
        $img.addClass('img');
        uiPopUpMessage.imageHolder.append($img);
    };

    /*
     * Sets the position of the message.
     */
    this._setPosition = function  (x, y, width, height) {
        uiPopUpMessage.foreground.css({
            left: x,
            top: y,
            width: width,
            height: height,
            zIndex: 2
        });
        return this;
    };
    self.disableInteractions = disableInteractions;
    self.enableInteractions = enableInteractions;

}
