/**
 * Initializes the primary validation UI at the bottom of the mobile screen.
 * @constructor
 */
function MobileValidationMenu(menuUI) {
    const self = this;

    const $disagreeReasonButtons = menuUI.disagreeReasonOptions.children('.validation-reason-button');
    const $unsureReasonButtons = menuUI.unsureReasonOptions.children('.validation-reason-button');

    function _init() {
        // Add onclick for each validation button.
        menuUI.yesButton.click(function(e) {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Agree' : 'ValidationButtonClick_Agree';
            svv.tracker.push(action);
            _setYesView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 1);

            // Not adding comments on mobile when voting yes, just submit the validation.
            _validateLabel(svv.validationOptions[svv.labelContainer.getCurrentLabel().getProperty('validationResult')], e.isTrigger);
        });
        menuUI.noButton.click(function(e) {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Disagree' : 'ValidationButtonClick_Disagree';
            svv.tracker.push(action);
            _setNoView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 2);
        });
        menuUI.unsureButton.click(function(e) {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Unsure' : 'ValidationButtonClick_Unsure';
            svv.tracker.push(action);
            _setUnsureView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 3);
        });

        // Add onclick for disagree and unsure reason buttons.
        for (const reasonButton of $disagreeReasonButtons) {
            reasonButton.onclick = function(e) {
                if (e.isTrigger) {
                    svv.tracker.push('KeyboardShortcut_DisagreeReason_Option=' + $(this).attr('id'));
                } else {
                    svv.tracker.push('Click=DisagreeReason_Option=' + $(this).attr('id'));
                }
                _setDisagreeReason($(this).attr('id'));
            };
        }
        for (const reasonButton of $unsureReasonButtons) {
            reasonButton.onclick = function(e) {
                if (e.isTrigger) {
                    svv.tracker.push('KeyboardShortcut_UnsureReason_Option=' + $(this).attr('id'));
                } else {
                    svv.tracker.push('Click=UnsureReason_Option=' + $(this).attr('id'));
                }
                _setUnsureReason($(this).attr('id'));
            };
        }

        // Log clicks to the two text boxes.
        menuUI.disagreeReasonTextBox.click(function(e) {
            menuUI.disagreeReasonTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=DisagreeReasonTextbox': 'Click=DisagreeReasonTextbox';
            svv.tracker.push(action);
        });
        menuUI.unsureReasonTextBox.click(function(e) {
            menuUI.unsureReasonTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=UnsureReasonTextbox': 'Click=UnsureReasonTextbox';
            svv.tracker.push(action);
        });

        // Add oninput for disagree and unsure other reason text boxes.
        menuUI.disagreeReasonTextBox.on('input', function() {
            if (menuUI.disagreeReasonTextBox.val() === '') {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
            } else {
                _setDisagreeReason('other');
            }
        });
        menuUI.unsureReasonTextBox.on('input', function() {
            if (menuUI.unsureReasonTextBox.val() === '') {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
            } else {
                _setUnsureReason('other');
            }
        });

        // Add onclick for the submit buttons in the no and unsure menus.
        $('#no-menu-submit-button').click(function(e) {
            _validateLabel('Disagree', e.isTrigger);
        });
        $('#unsure-menu-submit-button').click(function(e) {
            _validateLabel('Unsure', e.isTrigger);
        });
    }

    function resetMenu(label) {
        const prevValResult = label.getProperty('validationResult');
        if (prevValResult === undefined) {
            // This is a new label (not returning from an undo), so reset everything.
            menuUI.yesButton.removeClass('chosen');
            menuUI.noButton.removeClass('chosen');
            menuUI.unsureButton.removeClass('chosen');
            menuUI.noMenu.css('display', 'none');
            menuUI.unsureMenu.css('display', 'none');
            menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-no mobile-popup-notch-unsure');
            $disagreeReasonButtons.removeClass('chosen');
            $unsureReasonButtons.removeClass('chosen');
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            menuUI.unsureReasonTextBox.val('');

            // Update the text and tooltips on each disagree and unsure reason buttons.
            const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
            for (const reasonButton of $disagreeReasonButtons.add($unsureReasonButtons)) {
                const $reasonButton = $(reasonButton);
                const buttonInfo = svv.reasonButtonInfo[labelType][$reasonButton.attr('id')];
                if (buttonInfo) {
                    $reasonButton.html(buttonInfo.buttonText);

                    // Remove any old tooltip (from a previous label type) and add a new tooltip.
                    $reasonButton.tooltip('destroy');
                    if (buttonInfo.tooltipImage) {
                        util.getImage(buttonInfo.tooltipImage).then(img => {
                            _addTooltip($reasonButton, buttonInfo.tooltipText, img);
                        });
                    } else {
                        _addTooltip($reasonButton, buttonInfo.tooltipText);
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
            let disagreeOption = label.getProperty('disagreeOption');
            $disagreeReasonButtons.removeClass('chosen');
            if (disagreeOption === 'other') {
                menuUI.disagreeReasonTextBox.addClass('chosen');
                menuUI.disagreeReasonTextBox.val(label.getProperty('disagreeReasonTextBox'));
            } else {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                menuUI.disagreeReasonTextBox.val('');
                menuUI.disagreeReasonOptions.find(`#${disagreeOption}`).addClass('chosen');
            }

            let unsureOption = label.getProperty('unsureOption');
            $unsureReasonButtons.removeClass('chosen');
            if (unsureOption === 'other') {
                menuUI.unsureReasonTextBox.addClass('chosen');
                menuUI.unsureReasonTextBox.val(label.getProperty('unsureReasonTextBox'));
            } else {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                menuUI.unsureReasonTextBox.val('');
                menuUI.unsureReasonOptions.find(`#${unsureOption}`).addClass('chosen');
            }

            if (prevValResult === 1)      _setYesView();
            else if (prevValResult === 2) _setNoView();
            else if (prevValResult === 3) _setUnsureView();
        }
    }

    function _setYesView() {
        menuUI.yesButton.addClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.removeClass('chosen');

        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-no mobile-popup-notch-unsure');
        menuUI.submitButton.prop('disabled', false); // TODO probably won't do this, just submit automatically.
    }

    function _setNoView() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.addClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        menuUI.noMenu.css('display', 'flex');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.mobilePopupNotch.removeClass('mobile-popup-notch-unsure').addClass('mobile-popup-notch-no');
        menuUI.submitButton.prop('disabled', false);
    }

    function _setUnsureView() {
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
     * @param {string} img Optional image to display in the tooltip.
     * @private
     */
    function _addTooltip($elem, tooltipText, img) {
        // Add the tooltip only on non-touch devices.
        if (window.matchMedia('(hover: hover)').matches) {
            const tooltipHtml = img ? `${tooltipText}<br/><img src="${img}" height="140"/>` : tooltipText;
            $elem.tooltip(({
                placement: 'top',
                html: true,
                container: 'body',
                delay: {show: 500, hide: 10},
                title: tooltipHtml
            })).tooltip('show').tooltip('hide');
        }
    }

    // VALIDATING 'NO' SECTION.
    function _setDisagreeReason(id) {
        $disagreeReasonButtons.removeClass('chosen');
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
    function _setUnsureReason(id) {
        $unsureReasonButtons.removeClass('chosen');
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

    function saveValidationState() {
        let currLabel = svv.labelContainer.getCurrentLabel();
        currLabel.setProperty('disagreeReasonTextBox', menuUI.disagreeReasonTextBox.val());
        currLabel.setProperty('unsureReasonTextBox', menuUI.unsureReasonTextBox.val());
    }

    /**
     * Validates a single label from a button click.
     * @param {string} action Validation action - must be one of Agree, Disagree, or Unsure.
     * @param {boolean} keyboardShortcut Whether or not the validation was triggered by a keyboard shortcut.
     */
    function _validateLabel(action, keyboardShortcut) {
        const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
        let timestamp = new Date();
        svv.tracker.push(actionStr + action);
        let currLabel = svv.labelContainer.getCurrentLabel();

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass('validate');
        menuUI.noButton.removeClass('validate');
        menuUI.unsureButton.removeClass('validate');

        // Save anything they typed in either text box so that it's there again if they undo their validation.
        saveValidationState();

        // Fill in the comment based on the disagree options they picked or one of the free form text boxes.
        let comment = '';
        if (action === 'Disagree') {
            let disagreeReason = currLabel.getProperty('disagreeOption');
            if (disagreeReason === 'other') {
                comment = currLabel.getProperty('disagreeReasonTextBox');
            } else if (disagreeReason) {
                comment = menuUI.disagreeReasonOptions.find(`#${disagreeReason}`).html().replace('<br>', ' ');
            } else {
                comment = '';
            }
        } else if (action === 'Unsure') {
            let unsureReason = currLabel.getProperty('unsureOption');
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

    self.resetMenu = resetMenu;
    self.saveValidationState = saveValidationState;

    _init();
    return self;
}
