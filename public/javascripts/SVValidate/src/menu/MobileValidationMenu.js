/**
 * Initializes the primary validation UI at the bottom of the mobile screen.
 */
class MobileValidationMenu {
    #menuUI;
    #disagreeReasonButtons;
    #unsureReasonButtons;

    /**
     * @param {object} menuUI Validation menu UI elements.
     */
    constructor(menuUI) {
        this.#menuUI = menuUI;
        this.#disagreeReasonButtons = menuUI.disagreeReasonOptions.children('.validation-reason-button');
        this.#unsureReasonButtons = menuUI.unsureReasonOptions.children('.validation-reason-button');

        this.#init();
    }

    #init() {
        const menuUI = this.#menuUI;

        // Add onclick for each validation button.
        menuUI.yesButton.click((e) => {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Agree' : 'ValidationButtonClick_Agree';
            svv.tracker.push(action);
            this.#setYesView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Agree');

            // Not adding comments on mobile when voting yes, just submit the validation.
            this.#validateLabel(svv.labelContainer.getCurrentLabel().getProperty('validationResult'), e.isTrigger);
        });
        menuUI.noButton.click((e) => {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Disagree' : 'ValidationButtonClick_Disagree';
            svv.tracker.push(action);
            this.#setNoView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Disagree');
        });
        menuUI.unsureButton.click((e) => {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Unsure' : 'ValidationButtonClick_Unsure';
            svv.tracker.push(action);
            this.#setUnsureView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Unsure');
        });

        // Add onclick for disagree and unsure reason buttons.
        for (const reasonButton of this.#disagreeReasonButtons) {
            reasonButton.onclick = (e) => {
                if (e.isTrigger) {
                    svv.tracker.push(`KeyboardShortcut_DisagreeReason_Option=${$(reasonButton).attr('id')}`);
                } else {
                    svv.tracker.push(`Click=DisagreeReason_Option=${$(reasonButton).attr('id')}`);
                }
                this.#setDisagreeReason($(reasonButton).attr('id'));
            };
        }
        for (const reasonButton of this.#unsureReasonButtons) {
            reasonButton.onclick = (e) => {
                if (e.isTrigger) {
                    svv.tracker.push(`KeyboardShortcut_UnsureReason_Option=${$(reasonButton).attr('id')}`);
                } else {
                    svv.tracker.push(`Click=UnsureReason_Option=${$(reasonButton).attr('id')}`);
                }
                this.#setUnsureReason($(reasonButton).attr('id'));
            };
        }

        // Log clicks to the two text boxes.
        menuUI.disagreeReasonTextBox.click((e) => {
            menuUI.disagreeReasonTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=DisagreeReasonTextbox' : 'Click=DisagreeReasonTextbox';
            svv.tracker.push(action);
        });
        menuUI.unsureReasonTextBox.click((e) => {
            menuUI.unsureReasonTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=UnsureReasonTextbox' : 'Click=UnsureReasonTextbox';
            svv.tracker.push(action);
        });

        // Add oninput for disagree and unsure other reason text boxes.
        menuUI.disagreeReasonTextBox.on('input', () => {
            if (menuUI.disagreeReasonTextBox.val() === '') {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
            } else {
                this.#setDisagreeReason('other');
            }
        });
        menuUI.unsureReasonTextBox.on('input', () => {
            if (menuUI.unsureReasonTextBox.val() === '') {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
            } else {
                this.#setUnsureReason('other');
            }
        });

        // Add onclick for the submit buttons in the no and unsure menus.
        $('#no-menu-submit-button').click((e) => {
            this.#validateLabel('Disagree', e.isTrigger);
        });
        $('#unsure-menu-submit-button').click((e) => {
            this.#validateLabel('Unsure', e.isTrigger);
        });

        // Add onclick for the skip-reason buttons, which submit the validation without an associated reason.
        $('#no-menu-skip-reason-button').click((e) => {
            svv.tracker.push('Click=DisagreeReason_Skip');
            svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
            this.#validateLabel('Disagree', e.isTrigger);
        });
        $('#unsure-menu-skip-reason-button').click((e) => {
            svv.tracker.push('Click=UnsureReason_Skip');
            svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
            this.#validateLabel('Unsure', e.isTrigger);
        });
    }

    resetMenu(label) {
        const menuUI = this.#menuUI;
        const prevValResult = label.getProperty('validationResult');
        if (prevValResult === undefined) {
            // This is a new label (not returning from an undo), so reset everything.
            menuUI.yesButton.removeClass('chosen');
            menuUI.noButton.removeClass('chosen');
            menuUI.unsureButton.removeClass('chosen');
            menuUI.noMenu.css('display', 'none');
            menuUI.unsureMenu.css('display', 'none');
            menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-no mobile-popup-notch-unsure');
            this.#disagreeReasonButtons.removeClass('chosen');
            this.#unsureReasonButtons.removeClass('chosen');
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            menuUI.unsureReasonTextBox.val('');

            // Update the text and tooltips on each disagree and unsure reason buttons.
            const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
            for (const reasonButton of this.#disagreeReasonButtons.add(this.#unsureReasonButtons)) {
                const $reasonButton = $(reasonButton);
                const buttonInfo = svv.reasonButtonInfo[labelType][$reasonButton.attr('id')];
                if (buttonInfo) {
                    $reasonButton.html(buttonInfo.buttonText);

                    // Remove any old tooltip (from a previous label type) and add a new tooltip.
                    $reasonButton.tooltip('destroy');
                    if (buttonInfo.tooltipImage) {
                        util.getImage(buttonInfo.tooltipImage).then((img) => {
                            this.#addTooltip($reasonButton, buttonInfo.tooltipText, img);
                        });
                    } else {
                        this.#addTooltip($reasonButton, buttonInfo.tooltipText);
                    }

                    // Adds a class as a way to show that this button has associated text.
                    $reasonButton.addClass('defaultOption');
                    $reasonButton.css('display', 'flex');
                } else {
                    $reasonButton.css('display', 'none');
                    if ($reasonButton.hasClass('defaultOption')) {
                        $reasonButton.removeClass('defaultOption');
                    }
                }
            }
            menuUI.submitButton.prop('disabled', true);
        } else {
            // This is a validation that they are going back to, so update all the views to match what they had before.
            const disagreeOption = label.getProperty('disagreeOption');
            this.#disagreeReasonButtons.removeClass('chosen');
            if (disagreeOption === 'other') {
                menuUI.disagreeReasonTextBox.addClass('chosen');
                menuUI.disagreeReasonTextBox.val(label.getProperty('disagreeReasonTextBox'));
            } else {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                menuUI.disagreeReasonTextBox.val('');
                menuUI.disagreeReasonOptions.find(`#${disagreeOption}`).addClass('chosen');
            }

            const unsureOption = label.getProperty('unsureOption');
            this.#unsureReasonButtons.removeClass('chosen');
            if (unsureOption === 'other') {
                menuUI.unsureReasonTextBox.addClass('chosen');
                menuUI.unsureReasonTextBox.val(label.getProperty('unsureReasonTextBox'));
            } else {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                menuUI.unsureReasonTextBox.val('');
                menuUI.unsureReasonOptions.find(`#${unsureOption}`).addClass('chosen');
            }

            if (prevValResult === 'Agree') this.#setYesView();
            else if (prevValResult === 'Disagree') this.#setNoView();
            else if (prevValResult === 'Unsure') this.#setUnsureView();
        }
    }

    #setYesView() {
        const menuUI = this.#menuUI;
        menuUI.yesButton.addClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.removeClass('chosen');

        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-no mobile-popup-notch-unsure');
        menuUI.submitButton.prop('disabled', false); // TODO probably won't do this, just submit automatically.
    }

    #setNoView() {
        const menuUI = this.#menuUI;
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.addClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        menuUI.noMenu.css('display', 'flex');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-unsure').addClass('mobile-popup-notch-no');
        menuUI.submitButton.prop('disabled', false);
    }

    #setUnsureView() {
        const menuUI = this.#menuUI;
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.addClass('chosen');
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'flex');
        menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-no').addClass('mobile-popup-notch-unsure');
        menuUI.submitButton.prop('disabled', false);
    }

    /**
     * Adds a jquery tooltip to the given element with the given text and image (if given).
     * @param {jQuery} $elem Element to add the tooltip to, as jquery wrapped object.
     * @param {string} tooltipText Text to display in the tooltip.
     * @param {string} [img] Optional image to display in the tooltip.
     */
    #addTooltip($elem, tooltipText, img) {
        // Add the tooltip only on non-touch devices.
        if (window.matchMedia('(hover: hover)').matches) {
            const tooltipHtml = img ? `${tooltipText}<br/><img src="${img}" height="140"/>` : tooltipText;
            $elem.tooltip(({
                placement: 'top',
                html: true,
                container: 'body',
                delay: { show: 500, hide: 10 },
                title: tooltipHtml,
            })).tooltip('show').tooltip('hide');
        }
    }

    // VALIDATING 'NO' SECTION.
    #setDisagreeReason(id) {
        const menuUI = this.#menuUI;
        this.#disagreeReasonButtons.removeClass('chosen');
        if (id === 'other') {
            menuUI.disagreeReasonTextBox.addClass('chosen');
            svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', 'other');
        } else {
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', id);
            menuUI.disagreeReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    // VALIDATING 'UNSURE' SECTION.
    #setUnsureReason(id) {
        const menuUI = this.#menuUI;
        this.#unsureReasonButtons.removeClass('chosen');
        if (id === 'other') {
            menuUI.unsureReasonTextBox.addClass('chosen');
            svv.labelContainer.getCurrentLabel().setProperty('unsureOption', 'other');
        } else {
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.val('');
            svv.labelContainer.getCurrentLabel().setProperty('unsureOption', id);
            menuUI.unsureReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    saveValidationState() {
        const menuUI = this.#menuUI;
        const currLabel = svv.labelContainer.getCurrentLabel();
        currLabel.setProperty('disagreeReasonTextBox', menuUI.disagreeReasonTextBox.val());
        currLabel.setProperty('unsureReasonTextBox', menuUI.unsureReasonTextBox.val());
    }

    /**
     * Validates a single label from a button click.
     * @param {string} action Validation action - must be one of Agree, Disagree, or Unsure.
     * @param {boolean} keyboardShortcut Whether or not the validation was triggered by a keyboard shortcut.
     */
    #validateLabel(action, keyboardShortcut) {
        const menuUI = this.#menuUI;
        const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
        const timestamp = new Date();
        svv.tracker.push(actionStr + action);
        const currLabel = svv.labelContainer.getCurrentLabel();

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass('validate');
        menuUI.noButton.removeClass('validate');
        menuUI.unsureButton.removeClass('validate');

        // Save anything they typed in either text box so that it's there again if they undo their validation.
        this.saveValidationState();

        // Fill in the comment based on the disagree options they picked or one of the free form text boxes.
        let comment = '';
        if (action === 'Disagree') {
            const disagreeReason = currLabel.getProperty('disagreeOption');
            if (disagreeReason === 'other') {
                comment = currLabel.getProperty('disagreeReasonTextBox');
            } else if (disagreeReason) {
                comment = menuUI.disagreeReasonOptions.find(`#${disagreeReason}`).html().replace('<br>', ' ');
            } else {
                comment = '';
            }
        } else if (action === 'Unsure') {
            const unsureReason = currLabel.getProperty('unsureOption');
            if (unsureReason === 'other') {
                comment = currLabel.getProperty('unsureReasonTextBox');
            } else if (unsureReason) {
                comment = menuUI.unsureReasonOptions.find(`#${unsureReason}`).html().replace('<br>', ' ');
            } else {
                comment = '';
            }
        }
        currLabel.setProperty('comment', comment);

        // If enough time has passed between validations, log the new validation.
        if (timestamp - svv.labelContainer.getProperty('validationTimestamp') > 800) {
            svv.labelContainer.validateCurrentLabel(action, timestamp, comment);
        }
    }
}
