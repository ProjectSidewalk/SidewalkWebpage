/**
 * A MessageBox module
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function PopUpMessage ($, param) {
    var self = {className: 'PopUpMessage'},
        status = { haveAskedToSignIn: false },
        buttons = [],
        OKButton = '<button id="pop-up-message-ok-button">OK</button>';

    function appendHTML (htmlDom, callback) {
        var $html = $(htmlDom);
        svl.ui.popUpMessage.box.append($html);

        if (callback) {
            $html.on("click", callback);
        }
        $html.on('click', hide);
        buttons.push($html);
    }

    function appendButton (buttonDom, callback) {
        var $button = $(buttonDom);

        $button.css({
            margin: '10 10 10 0'
        });
        $button.addClass('button');

//        svl.ui.popUpMessage.box.css('padding-bottom', '50px');
        svl.ui.popUpMessage.box.append($button);

        if (callback) {
            $button.on('click', callback);
        }
        $button.on('click', hide);
        buttons.push($button);
    }

    function appendOKButton(callback) {
        appendButton(OKButton, callback);
    }

    function handleClickOK () {
        $("#pop-up-message-ok-button").on('click', function () {
            if ('tracker' in svl && svl.tracker) {
                if (message) {
                    svl.tracker.push('MessageBox_ClickOk', {message: message});
                } else {
                    svl.tracker.push('MessageBox_ClickOk');
                }
            }
            $("#pop-up-message-ok-button").remove();
        });
    }

    /**
     * Hides the message box.
     */
    function hide () {
        // This method hides the message box.
        svl.ui.popUpMessage.holder.removeClass('visible');
        svl.ui.popUpMessage.holder.addClass('hidden');
        hideBackground();  // hide background
        reset();  // reset all the parameters
        return this;
    }

    /**
     * Hides the background
     */
    function hideBackground () {
        svl.ui.popUpMessage.holder.css({ width: '', height: '' });
    }

    /**
     * Prompt a user who's not logged in to sign up/sign in.
     * Todo. I should move this to either User.js or a new module (e.g., SignUp.js?).
     */
    function promptSignIn () {
        if (!status.haveAskedToSignIn) {
            setTitle("You've been contributing a lot!");
            setMessage("Do you want to create an account to keep track of your progress?");
            appendButton('<button id="pop-up-message-sign-up-button">Let me sign up!</button>', function () {
                // Store the data in LocalStorage.
                var task = svl.taskContainer.getCurrentTask();
                var data = svl.form.compileSubmissionData(task),
                    staged = svl.storage.get("staged");
                staged.push(data);
                svl.storage.set("staged", staged);

                $("#sign-in-modal").addClass("hidden");
                $("#sign-up-modal").removeClass("hidden");
                $('#sign-in-modal-container').modal('show');
            });
            appendButton('<button id="pop-up-message-cancel-button">No</button>', function () {
                if (!('user' in svl)) { svl.user = new User({username: 'anonymous'}); }

                svl.user.setProperty('firstTask', false);
                // Submit the data as an anonymous user.
                var task = svl.taskContainer.getCurrentTask();
                var data = svl.form.compileSubmissionData(task);
                svl.form.submit(data, task);
            });
            appendHTML('<br /><a id="pop-up-message-sign-in"><small><span style="color: white; text-decoration: underline;">I do have an account! Let me sign in.</span></small></a>', function () {
                var task = svl.taskContainer.getCurrentTask();
                var data = svl.form.compileSubmissionData(task),
                    staged = svl.storage.get("staged");
                staged.push(data);
                svl.storage.set("staged", staged);

                $("#sign-in-modal").removeClass("hidden");
                $("#sign-up-modal").addClass("hidden");
                $('#sign-in-modal-container').modal('show');
            });
            setPosition(0, 260, '100%');
            show(true);
        }
        status.haveAskedToSignIn = true;
    }

    /**
     * Reset all the parameters.
     */
    function reset () {
        svl.ui.popUpMessage.holder.css({ width: '', height: '' });
        svl.ui.popUpMessage.box.css({
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    zIndex: ''
                });

        svl.ui.popUpMessage.box.css('padding-bottom', '')

        for (var i = 0; i < buttons.length; i++ ){
            try {
                buttons[i].remove();
            } catch (e) {
                console.warning("Button does not exist.", e);
            }
        }
        buttons = [];
    }

    /**
     * This method shows a messaage box on the page.
     */
    function show (disableOtherInteraction) {
        if (disableOtherInteraction) {
            showBackground();
        }

        svl.ui.popUpMessage.holder.removeClass('hidden');
        svl.ui.popUpMessage.holder.addClass('visible');
        return this;
    }

    /**
     * Show a semi-transparent background to block people to interact with
     * other parts of the interface.
     */
    function showBackground () {
        svl.ui.popUpMessage.holder.css({ width: '100%', height: '100%'});
    }

    /**
     * Sets the title
     */
    function setTitle (title) {
         svl.ui.popUpMessage.title.html(title);
         return this;
    }

    /**
     * Sets the message.
     */
    function setMessage (message) {
        svl.ui.popUpMessage.content.html(message);
        return this;
    }

    /*
     * Sets the position of the message.
     */
    function setPosition (x, y, width, height) {
        svl.ui.popUpMessage.box.css({
            left: x,
            top: y,
            width: width,
            height: height,
            zIndex: 1000
        });
        return this;
    }

    self.appendButton = appendButton;
    self.appendHTML = appendHTML;
    self.appendOKButton = appendOKButton;
    self.hide = hide;
    self.hideBackground = hideBackground;
    self.promptSignIn = promptSignIn;
    self.reset = reset;
    self.show = show;
    self.showBackground = showBackground;
    self.setPosition = setPosition;
    self.setTitle = setTitle;
    self.setMessage = setMessage;
    return self;
}
