/**
 * Instructional (or sign in/up) pop-ups shown over the Explore page.
 */
class PopUpMessage {
    #taskContainer;
    #tracker;
    #ui;
    #status = { haveAskedToSignIn: false, signUp: false, isVisible: false };
    #buttons = [];

    // Set while an OK button is showing; invoked by the Enter shortcut. Stored as an action (rather than synthesizing
    // a DOM click) so the shortcut doesn't produce a spurious LowLevelEvent_click log in the Tracker.
    #okAction = null;

    /**
     * @param {TaskContainer} taskContainer
     * @param {Tracker} tracker
     */
    constructor(taskContainer, tracker) {
        this.#taskContainer = taskContainer;
        this.#tracker = tracker;
        this.#ui = {
            holder: document.getElementById('pop-up-message-holder'),
            foreground: document.getElementById('pop-up-message-foreground'),
            title: document.getElementById('pop-up-message-title'),
            content: document.getElementById('pop-up-message-content'),
            imageHolder: document.getElementById('pop-up-message-img-holder'),
            buttonHolder: document.getElementById('pop-up-message-button-holder'),
        };

        // Enter works the same as clicking OK. Registered once here; a no-op unless an OK button is showing.
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && this.#okAction) {
                this.#tracker.push('KeyboardShortcut_ClickOk');
                this.#okAction();
            }
        });
    }

    /**
     * Disables the user's ability to interact with the Explore tool while a pop-up is showing.
     */
    disableInteractions() {
        svl.panoManager.hideNavArrows();
        svl.navigationService.disableWalking();
        svl.panoManager.unlockDisablePanning().disablePanning();
        svl.canvas.disableLabeling();
        svl.keyboard.disableKeyboard();
    }

    /**
     * Re-enables the user's ability to interact with the Explore tool.
     */
    enableInteractions() {
        svl.panoManager.showNavArrows();
        svl.navigationService.enableWalking();
        svl.panoManager.enablePanning();
        svl.canvas.enableLabeling();
        svl.keyboard.enableKeyboard();
    }

    /**
     * Whether the user has already been prompted to sign in during this session.
     * @returns {boolean}
     */
    haveAskedToSignIn() {
        return this.#status.haveAskedToSignIn;
    }

    /**
     * Prompt a user who's not logged in to sign up/sign in.
     */
    promptSignIn() {
        this.#ui.buttonHolder.replaceChildren();
        this.#setTitle(i18next.t('popup.signup-title'));
        this.#setMessage(i18next.t('popup.signup-body'));
        const task = this.#taskContainer.getCurrentTask();

        // Add the 'Sign up' button.
        this.#appendButton('pop-up-message-sign-up-button', 'button-ps button--primary button--small',
            i18next.t('common:sign-up'), () => {
                this.#tracker.push('PopUpMessage_SignUpClickYes', {
                    auditTaskId: task.getAuditTaskId(),
                    auditStreetEdgeId: task.getStreetEdgeId(),
                });
                this.#status.signUp = true;
                document.getElementById('sign-in-modal').classList.add('hidden');
                document.getElementById('sign-up-modal').classList.remove('hidden');
                $('#sign-in-modal-container').modal('show'); // Bootstrap modal API; jQuery until modals are replaced.
            });

        // Add the 'Sign in' button.
        this.#appendButton('pop-up-message-sign-in-button', 'button-ps button--secondary button--small',
            i18next.t('common:sign-in'), () => {
                this.#tracker.push('PopUpMessage_SignInClick', {
                    auditTaskId: task.getAuditTaskId(),
                    auditStreetEdgeId: task.getStreetEdgeId(),
                });
                document.getElementById('sign-in-modal').classList.remove('hidden');
                document.getElementById('sign-up-modal').classList.add('hidden');
                $('#sign-in-modal-container').modal('show'); // Bootstrap modal API; jQuery until modals are replaced.
            });

        // Add the 'No' button.
        this.#appendButton('pop-up-message-cancel-button', 'button-ps button--secondary button--small',
            i18next.t('common:no'), () => {
                this.#tracker.push('PopUpMessage_SignUpClickNo', {
                    auditTaskId: task.getAuditTaskId(),
                    auditStreetEdgeId: task.getStreetEdgeId(),
                });
            });

        // Show the notification.
        this.#show();
        this.#status.haveAskedToSignIn = true;
    }

    /**
     * Notification
     * @param {string} title HTML content to add to the h2 header for the pop-up
     * @param {string} message HTML content to add to the p body for the pop-up
     * @param {Function} [callback] Function to call when the user clicks OK to dismiss the pop-up
     * @returns {boolean} Returns true if the message is shown, false if it isn't (because another is already visible)
     */
    notify(title, message, callback) {
        if (this.#status.isVisible) {
            console.trace('ALREADY GOT ONE');
            return false;
        }
        this.#show();
        this.#setTitle(title);
        this.#setMessage(message);
        this.#appendOkButton(callback);
        return true;
    }

    /**
     * Notification with image
     * @param {string} title HTML content to add to the h2 header for the pop-up
     * @param {string} message HTML content to add to the p body for the pop-up
     * @param {string} image URL of the image to add to the pop-up
     * @param {string} width width of the image, including units
     * @param {string} height height of the image, including units
     * @param {string} x left position of the image, including units
     * @param {Function} [callback] Function to call when the user clicks OK to dismiss the pop-up
     * @returns {boolean} Returns true if the message is shown, false if it isn't (because another is already visible)
     */
    notifyWithImage(title, message, image, width, height, x, callback) {
        if (this.#status.isVisible) {
            return false;
        }
        this.#show();
        this.#ui.foreground.classList.add('has-image');
        this.#setTitle(title);
        this.#setMessage(message);
        this.#setImage(image, width, height, x);
        this.#appendOkButton(callback);
        return true;
    }

    /**
     * Shows the message box, blocking interactions with the rest of the interface.
     */
    #show() {
        this.disableInteractions();
        this.#showBackground();
        this.#ui.holder.classList.remove('hidden');
        this.#ui.holder.classList.add('visible');
        this.#status.isVisible = true;
    }

    /**
     * Hides the message box and resets it for the next pop-up.
     */
    #hide() {
        this.#ui.holder.classList.remove('visible');
        this.#ui.holder.classList.add('hidden');
        if (!this.#status.signUp) {
            this.enableInteractions();
        }
        this.#hideBackground();
        this.#reset();
        this.#status.isVisible = false;
    }

    // Show a semi-transparent background to block people from interacting with other parts of the interface.
    #showBackground() {
        this.#ui.holder.style.width = '100%';
        this.#ui.holder.style.height = '100%';
    }

    #hideBackground() {
        this.#ui.holder.style.width = '';
        this.#ui.holder.style.height = '';
    }

    /**
     * Reset all the parameters.
     */
    #reset() {
        this.#ui.holder.style.width = '';
        this.#ui.holder.style.height = '';
        this.#ui.imageHolder.style.width = '';
        this.#ui.imageHolder.style.height = '';
        this.#ui.imageHolder.style.left = '';
        this.#ui.foreground.classList.remove('has-image');

        this.#buttons.forEach((button) => button.remove());
        this.#buttons = [];
        this.#okAction = null;
        this.#status.signUp = false;
    }

    #setTitle(title) {
        this.#ui.title.innerHTML = title;
    }

    #setMessage(message) {
        this.#ui.content.innerHTML = message;
    }

    /**
     * Adds an image to the pop-up window.
     * @param {string} image URL of the image.
     * @param {string} width width of the image, including units
     * @param {string} height height of the image, including units
     * @param {string} x left position of the image, including units
     */
    #setImage(image, width, height, x) {
        const img = document.createElement('img');
        img.src = image;
        img.id = 'pop-up-message-image';
        img.classList.add('img');
        // Sizes/offsets are authored for the fixed 720x480 frame; scale them to the displayed pano size.
        const scale = util.exploreDisplayScale();
        img.style.cursor = 'default';
        img.style.width = `${parseFloat(width) * scale}px`;
        img.style.height = `${parseFloat(height) * scale}px`;
        img.style.left = `${parseFloat(x) * scale}px`;
        this.#ui.imageHolder.append(img);
    }

    /**
     * Creates a button in the pop-up's button holder; clicking it runs the callback and then hides the pop-up.
     * @param {string} id HTML id for the button.
     * @param {string} classNames Space-separated CSS classes for the button.
     * @param {string} label HTML content of the button.
     * @param {Function} [callback] Called on click, before the pop-up is hidden.
     * @returns {HTMLButtonElement} The appended button.
     */
    #appendButton(id, classNames, label, callback) {
        const button = document.createElement('button');
        button.id = id;
        button.className = classNames;
        button.innerHTML = label;
        this.#ui.buttonHolder.append(button);

        button.addEventListener('click', (e) => {
            if (callback) callback(e);
            this.#hide();
        }, { once: true });
        this.#buttons.push(button);
        return button;
    }

    /**
     * Adds the OK button and wires up both dismissal paths (clicking OK and the Enter shortcut).
     * @param {Function} [callback] Called after the pop-up is hidden.
     */
    #appendOkButton(callback) {
        const handleClickOk = () => {
            this.#tracker.push('PopUpMessage_ClickOk');
            this.enableInteractions();
            document.getElementById('pop-up-message-ok-button')?.remove();
            document.getElementById('pop-up-message-image')?.remove();
        };
        const okButton = this.#appendButton(
            'pop-up-message-ok-button', 'button-ps button--medium button--primary', 'OK', handleClickOk,
        );
        if (callback) okButton.addEventListener('click', callback, { once: true });

        // Same sequence a click produces: dismiss internals, hide, then the caller's callback. Cleared in #reset().
        this.#okAction = () => {
            handleClickOk();
            this.#hide();
            if (callback) callback();
        };
    }
}
