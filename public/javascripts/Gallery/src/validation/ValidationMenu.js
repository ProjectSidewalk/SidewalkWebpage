/**
 * A Validation Menu to be appended to a Card for validation purposes.
 *
 * There are two version of the validation menu that use this class: the menu on small cards and the menu on the
 * expanded view of a card. There is one ValidationMenu instance for each small card, but there is only one instance of
 * the ValidationMenu for the expanded view. For the small cards, the `refCard` remains static. But for the menu in the
 * expanded view, the `refCard` changes whenever we switch to the expanded view for a new label.
 *
 * @param referenceCard Stays the same for validation menus on small cards, changes for menu on expanded view.
 * @param gsvImage The HTML element to append the validation menu to.
 * @param expandedView The ExpandedView object; used to update the expanded view when modifying a card.
 * @param onExpandedView ValidationMenu is a child of the expanded view if true, is a child of a card if false.
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(referenceCard, gsvImage, expandedView, onExpandedView) {
    let self = this;
    let refCard = referenceCard;
    let currSelected = null;

    // A kind of wack way to do this, explore better options.
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
    const validationOptionToColor = { // TODO put this somewhere more central at the very least.
        'Agree': '#78c9ab',
        'Disagree': '#eb734d',
        'Unsure': '#fbd78b'
    };

    const cardOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('common:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('common:disagree')}</button>
            <button id="gallery-card-unsure-button" class="validation-button">${i18next.t('common:unsure')}</button>
        </div>`;
    const expandedViewOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="expanded-view-validation-button">
                ${i18next.t('common:agree')}
            </button>
            <button id="gallery-card-disagree-button" class="expanded-view-validation-button">
                ${i18next.t('common:disagree')}
            </button>
            <button id="gallery-card-unsure-button" class="expanded-view-validation-button">
                ${i18next.t('common:unsure')}
            </button>
        </div>`;
    let overlay = $(cardOverlayHTML);

    let validationButtons = undefined;
    let galleryCard = gsvImage.parent();

    // Adds onClick functions for the validation buttons and keybindings for validation actions.
    function _init() {
        if (onExpandedView) {
            overlay = $(expandedViewOverlayHTML)
        }

        validationButtons = {
            'validate-agree': overlay.find('#gallery-card-agree-button'),
            'validate-disagree': overlay.find('#gallery-card-disagree-button'),
            'validate-unsure': overlay.find('#gallery-card-unsure-button')
        };

        // If the signed-in user had already validated this label before loading the page, style the card to show that.
        let userValidation = refCard ? refCard.getProperty('user_validation') : null;
        if (userValidation) {
            if (onExpandedView) showValidationOnExpandedView(userValidation);
            else showValidationOnCard(userValidation);
        }

        // Add onClick functions for the validation buttons.
        for (const [valKey, button] of Object.entries(validationButtons)) {
            button.click(validateOnClickOrKeyPress(valKey, false, false));
        }

        // Add onClick for the validation thumbs up/down buttons.
        if (!onExpandedView) {
            addValidationInfoOnClicks(refCard.validationInfoDisplay);
        }
        gsvImage.append(overlay);
    }

    /**
     * Add onClick functions for the thumbs up/down buttons.
     *
     * @param valInfoDisplay
     */
    function addValidationInfoOnClicks(valInfoDisplay) {
        valInfoDisplay.agreeContainer.onclick = validateOnClickOrKeyPress('validate-agree', true, false);
        valInfoDisplay.disagreeContainer.onclick = validateOnClickOrKeyPress('validate-disagree', true, false);
    }

    /**
     * OnClick or keyboard shortcut function for validation buttons and thumbs up/down buttons.
     *
     * @param newValKey
     * @param thumbsClick {Boolean} Whether the validation came from clicking the thumb icons.
     * @param keyboardShortcut {Boolean} Whether the validation came from a keyboard shortcut.
     * @returns {(function(*): Promise)|*} A function returning a Promise that resolves after validation is submitted.
     */
    function validateOnClickOrKeyPress(newValKey, thumbsClick, keyboardShortcut) {
        return async function(e) {
            if (currSelected !== newValKey && (!onExpandedView || expandedView.open)) {
                let validationOption = classToValidationOption[newValKey];

                // Submit the new validation.
                return _validateLabel(validationOption, thumbsClick, keyboardShortcut).then(
                    // Change the look of the card/expanded view to match the new validation.
                    () => refCard.updateUserValidation(validationOption)
                    // TODO show some feedback if the validation fails to upload.
                );
            }
        }
    }

    /**
     * Adds the visual effects of validation to the small card (opaque button and fill color below image).
     *
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
     * Adds the visual effects of validation to the expanded view (opaque button and border color around pano).
     *
     * @param validationOption
     */
    function showValidationOnExpandedView(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // If the label had already been validated differently, remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            validationButtons[currSelected].attr('class', 'expanded-view-validation-button');
        }
        currSelected = validationClass;

        // Add the visual effects from the new validation.
        validationButtons[validationClass].attr('class', 'expanded-view-validation-button-selected');
        gsvImage.css('border-color', validationOptionToColor[validationOption]);
        gsvImage.css('background-color', validationOptionToColor[validationOption]);
    }

    /**
     * Resets the border to be transparent and the buttons to be less opaque, indicating a lack of validation.
     *
     * @private
     */
    function _removeValidationVisualsOnExpandedView() {
        currSelected = null;
        gsvImage.css('border-color', 'transparent');
        gsvImage.css('background-color', 'transparent');
        Object.values(validationButtons).forEach(valButton => valButton.attr('class', 'expanded-view-validation-button'));
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     *
     * @param {string} action Validation result.
     * @param {boolean} thumbsClick Whether the validation came from clicking the thumb icons.
     * @param {boolean} keyboardShortcut Whether the validation came from a keyboard shortcut.
     * @return {Promise} A promise that resolves once the validation has been submitted to the back end.
     * @private
     */
    async function _validateLabel(action, thumbsClick, keyboardShortcut) {
        // Log how the user validated (thumbs vs on-card menu) and what option they chose.
        let actionStr;
        let sourceStr;
        if (onExpandedView && thumbsClick) actionStr = 'Validate_ThumbsExpandedMenuClick', sourceStr = 'GalleryExpandedThumbs';
        else if (onExpandedView && !thumbsClick) actionStr = 'Validate_ExpandedMenuClick', sourceStr = 'GalleryExpandedImage';
        else if (!onExpandedView && thumbsClick) actionStr = 'Validate_ThumbsMenuClick', sourceStr = 'GalleryThumbs';
        else if (!onExpandedView && !thumbsClick) actionStr = 'Validate_MenuClick', sourceStr = 'GalleryImage';
        actionStr += action;
        if (keyboardShortcut) {
            actionStr = actionStr.replace('Click', 'KeyboardShortcut');
        }
        sg.tracker.push(actionStr, { panoId: refCard.getProperty('pano_id') }, { labelId: refCard.getProperty('label_id') });

        let validationTimestamp = new Date();
        let data = {
            label_id: refCard.getProperty('label_id'),
            label_type: refCard.getProperty('label_type'),
            validation_result: resultOptions[action],
            old_severity: refCard.getProperty('severity'),
            new_severity: refCard.getProperty('severity'),
            old_tags: refCard.getProperty('tags'),
            new_tags: refCard.getProperty('tags'),
            canvas_height: Math.round(gsvImage.height()),
            canvas_width: Math.round(gsvImage.width()),
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: sourceStr,
            undone: false,
            redone: refCard.getProperty('user_validation') !== null
        };

        // Record current POV and canvas X/Y position of the label at the current view. This does not change for the
        // static cards, but we need to calculate the current position if it's in the dynamic street view.
        if (!onExpandedView) {
            let labelIcon = refCard.labelIcon;
            data.heading = refCard.getProperty('heading');
            data.pitch = refCard.getProperty('pitch');
            data.zoom = refCard.getProperty('zoom');
            data.canvas_x = Math.round(labelIcon.offsetLeft + labelIcon.getBoundingClientRect().width / 2);
            data.canvas_y = Math.round(labelIcon.offsetTop + labelIcon.getBoundingClientRect().height / 2);
        } else {
            let currPov = expandedView.panoManager.getPov();
            data.heading = currPov.heading;
            data.pitch = currPov.pitch;
            data.zoom = currPov.zoom;

            // For some reason, the usual povToPixel_ route for finding the canvas_x/y isn't working in Gallery, so we
            // are using the actual left/top values for the HTML element instead.
            let labelIcon = $(expandedView.panoManager.labelMarker.marker.marker_);
            let labelIconRadius = labelIcon.outerWidth() / 2;
            let labelCanvasX = labelIcon.position().left + labelIconRadius;
            let labelCanvasY = labelIcon.position().top + labelIconRadius;

            // If the user has panned away from the label, and it's no longer visible on the canvas, set canvasX/Y to
            // null. We add/subtract the radius of the label so that we still record these values when only a fraction
            // of the label is still visible.
            if (labelCanvasX + labelIconRadius > 0
                && labelCanvasX - labelIconRadius < gsvImage.width()
                && labelCanvasY + labelIconRadius > 0
                && labelCanvasY - labelIconRadius < gsvImage.height()) {
                data.canvas_x = Math.round(labelCanvasX - labelIconRadius);
                data.canvas_y = Math.round(labelCanvasY - labelIconRadius);
            } else {
                data.canvas_x = null;
                data.canvas_y = null;
            }
        }

        // Submit the validation via POST request.
        return fetch('/labelmap/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }

    /**
     * Updates the reference card. This is only used for the expanded view, whose reference card necessarily changes.
     *
     * @param {Card} newCard The new card the ExpandedView references.
     */
    function updateReferenceCard(newCard) {
        refCard = newCard;
        if (onExpandedView) {
            if (refCard.getProperty('user_validation')) {
                showValidationOnExpandedView(refCard.getProperty('user_validation'));
            } else {
                _removeValidationVisualsOnExpandedView();
            }
        }
    }

    self.updateReferenceCard = updateReferenceCard;
    self.showValidationOnCard = showValidationOnCard;
    self.showValidationOnExpandedView = showValidationOnExpandedView;
    self.addExpandedViewValInfoOnClicks = addValidationInfoOnClicks;
    self.validateOnClickOrKeyPress = validateOnClickOrKeyPress;

    _init();
    return self;
}
