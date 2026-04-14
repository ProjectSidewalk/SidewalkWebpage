/**
 * A Validation Menu appended to a small Gallery Card for validation purposes.
 *
 * @param {Card} referenceCard The Card this menu belongs to.
 * @param {jQuery} gsvImage The HTML element to append the validation menu to.
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(referenceCard, gsvImage) {
    const self = this;
    const refCard = referenceCard;
    let currSelected = null;

    const resultOptions = {
        'Agree': 1,
        'Disagree': 2,
        'Unsure': 3
    };
    const classToValidationOption = {
        'validate-agree': 'Agree',
        'validate-disagree': 'Disagree',
        'validate-unsure': 'Unsure'
    };
    const validationOptionToClass = {
        'Agree': 'validate-agree',
        'Disagree': 'validate-disagree',
        'Unsure': 'validate-unsure'
    };

    const cardOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('common:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('common:disagree')}</button>
            <button id="gallery-card-unsure-button" class="validation-button">${i18next.t('common:unsure')}</button>
        </div>`;
    const overlay = $(cardOverlayHTML);

    let validationButtons = undefined;
    const galleryCard = gsvImage.parent();

    /**
     * Adds onClick functions for the validation buttons. Read-only for labels contributed by the current user.
     */
    function _init() {
        validationButtons = {
            'validate-agree': overlay.find('#gallery-card-agree-button'),
            'validate-disagree': overlay.find('#gallery-card-disagree-button'),
            'validate-unsure': overlay.find('#gallery-card-unsure-button')
        };

        // If the signed-in user had already validated this label before loading the page, style the card.
        const userValidation = refCard ? refCard.getProperty('user_validation') : null;
        if (userValidation) {
            showValidationOnCard(userValidation);
        }

        const readonly = !!refCard.getProperty('from_current_user');
        if (readonly) {
            const tip = i18next.t('labelmap:own-label-disabled');
            galleryCard.addClass('gallery-card--readonly');

            // Disable validation buttons + add tooltip; skip attaching click handlers.
            for (const button of Object.values(validationButtons)) {
                button.prop('disabled', true).attr('title', tip);
            }

            // Add tooltip to thumb containers; skip attaching click handlers. Destroy the bootstrap tooltips on the
            // inner Agree/Disagree icons so the native readonly tooltip shows on hover instead.
            const valInfo = refCard.validationInfoDisplay;
            valInfo.agreeContainer.title = tip;
            valInfo.disagreeContainer.title = tip;
            $(valInfo.validationContainer).find('img[data-toggle="tooltip"]').tooltip('destroy');
        } else {
            // Add onClick functions for the validation buttons.
            for (const [valKey, button] of Object.entries(validationButtons)) {
                button.click(validateOnClickOrKeyPress(valKey, false, false));
            }

            addValidationInfoOnClicks(refCard.validationInfoDisplay);
        }
        gsvImage.append(overlay);
    }

    /**
     * Add onClick functions for the thumbs up/down buttons.
     * @param valInfoDisplay
     */
    function addValidationInfoOnClicks(valInfoDisplay) {
        valInfoDisplay.agreeContainer.onclick = validateOnClickOrKeyPress('validate-agree', true, false);
        valInfoDisplay.disagreeContainer.onclick = validateOnClickOrKeyPress('validate-disagree', true, false);
    }

    /**
     * OnClick or keyboard shortcut function for validation buttons and thumbs up/down buttons.
     * @param newValKey
     * @param {boolean} thumbsClick Whether the validation came from clicking the thumb icons.
     * @param {boolean} keyboardShortcut Whether the validation came from a keyboard shortcut.
     * @returns {(function(*): Promise)|*} A function returning a Promise that resolves after validation.
     */
    function validateOnClickOrKeyPress(newValKey, thumbsClick, keyboardShortcut) {
        return async function(e) {
            if (currSelected !== newValKey) {
                const validationOption = classToValidationOption[newValKey];

                const labelValidatedPromise = _validateLabel(validationOption, thumbsClick, keyboardShortcut);

                // Change the look of the card to match the new validation.
                // NOTE: done after calling _validateLabel() because it uses info that changes below.
                refCard.updateUserValidation(validationOption);

                return labelValidatedPromise;
            }
        };
    }

    /**
     * Adds the visual effects of validation to the small card (opaque button and fill color below image).
     * @param validationOption
     */
    function showValidationOnCard(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // Remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            validationButtons[currSelected].attr('class', 'validation-button');
            if (galleryCard.hasClass(currSelected)) {
                galleryCard.removeClass(currSelected);
            }
        }
        currSelected = validationClass;

        // Add the visual effects from the new validation.
        galleryCard.addClass(validationClass);
        validationButtons[validationClass].attr('class', 'validation-button-selected');
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * @param {string} action Validation result.
     * @param {boolean} thumbsClick Whether the validation came from clicking the thumb icons.
     * @param {boolean} keyboardShortcut Whether the validation came from a keyboard shortcut.
     * @return {Promise} A promise that resolves once the validation has been submitted.
     * @private
     */
    async function _validateLabel(action, thumbsClick, keyboardShortcut) {
        let actionStr;
        let sourceStr;
        if (thumbsClick) actionStr = 'Validate_ThumbsMenuClick', sourceStr = 'GalleryThumbs';
        else actionStr = 'Validate_MenuClick', sourceStr = 'GalleryImage';
        actionStr += action;
        if (keyboardShortcut) {
            actionStr = actionStr.replace('Click', 'KeyboardShortcut');
        }
        sg.tracker.push(actionStr, { panoId: refCard.getProperty('pano_id') }, { labelId: refCard.getProperty('label_id') });

        const validationTimestamp = new Date();
        const labelIcon = refCard.labelIcon;
        const data = {
            label_id: refCard.getProperty('label_id'),
            label_type: refCard.getProperty('label_type'),
            validation_result: resultOptions[action],
            old_severity: refCard.getProperty('severity'),
            new_severity: refCard.getProperty('severity'),
            old_tags: refCard.getProperty('tags'),
            new_tags: refCard.getProperty('tags'),
            canvas_height: Math.round(gsvImage.height()),
            canvas_width: Math.round(gsvImage.width()),
            heading: refCard.getProperty('heading'),
            pitch: refCard.getProperty('pitch'),
            zoom: refCard.getProperty('zoom'),
            canvas_x: Math.round(labelIcon.offsetLeft + labelIcon.getBoundingClientRect().width / 2),
            canvas_y: Math.round(labelIcon.offsetTop + labelIcon.getBoundingClientRect().height / 2),
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: sourceStr,
            undone: false,
            redone: refCard.getProperty('user_validation') !== null
        };

        return fetch('/labelmap/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }

    self.showValidationOnCard = showValidationOnCard;
    self.validateOnClickOrKeyPress = validateOnClickOrKeyPress;

    _init();
    return self;
}
