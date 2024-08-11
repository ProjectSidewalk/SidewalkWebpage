/**
 * A Validation Menu to be appended to a Card for validation purposes.
 *
 * There are two version of the validation menu that use this class. The first is the menu on the small cards and the
 * second is the menu on the expanded view of a card. There is one ValidationMenu instance for each small card, but
 * there is only one instance of the ValidationMenu for the expanded view (also called the "modal"). For the small
 * cards, the `referenceCard` remains the static. But for the menu in the expanded view, the `referenceCard` changes
 * whenever we switch to the expanded view for a new label.
 *
 * @param refCard Reference card. Stays the same for validation menus on small cards, changes for menu on expanded view.
 * @param gsvImage The html element to append the validation menu to.
 * @param cardProperties Properties of the label the validation menu is being appended to
 * @param modal The Modal object; used to update the expanded view when modifying a card.
 * @param onExpandedView A boolean flag. If true, the ValidationMenu is a child of the expanded view.
 *                       If false, the ValidationMenu is a child of a card.
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(refCard, gsvImage, cardProperties, modal, onExpandedView) {
    let self = this;
    let currCardProperties = cardProperties;
    let referenceCard = refCard;
    let currSelected = null;

    // A kind of wack way to do this, explore better options.
    const resultOptions = {
        "Agree": 1,
        "Disagree": 2,
        "Unsure": 3
    };
    const classToValidationOption = {
        "validate-agree": "Agree",
        "validate-disagree": "Disagree",
        "validate-unsure": "Unsure"
    };
    const validationOptionToClass = {
        "Agree": "validate-agree",
        "Disagree": "validate-disagree",
        "Unsure": "validate-unsure"
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
    const modalOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="modal-validation-button">${i18next.t('common:agree')}</button>
            <button id="gallery-card-disagree-button" class="modal-validation-button">${i18next.t('common:disagree')}</button>
            <button id="gallery-card-unsure-button" class="modal-validation-button">${i18next.t('common:unsure')}</button>
        </div>`;
    let overlay = $(cardOverlayHTML);

    let validationKeybindings = undefined;
    let validationButtons = undefined;
    let galleryCard = gsvImage.parent();

    // Adds onClick functions for the validation buttons and keybindings for validation actions.
    function _init() {
        if (onExpandedView) {
            overlay = $(modalOverlayHTML)
        }

        validationKeybindings = {
            "validate-agree": ["a", "y"],
            "validate-disagree": ["d", "n"],
            "validate-unsure": ["u"]
        };

        // Add key binding listeners if this is the menu for the expanded view.
        if (onExpandedView) {
            const keyToActionMap = {};

            for (const [valKey, keys] of Object.entries(validationKeybindings)) {
                const action = validateOnClickOrKeyPress(valKey, false);
                for (const key of keys) {
                    keyToActionMap[key] = action;
                }
            }

            document.addEventListener('keydown', (event) => {
                const action = keyToActionMap[event.key.toLowerCase()];
                if (action) {
                    action();
                }
            });
        }

        validationButtons = {
            "validate-agree": overlay.find("#gallery-card-agree-button"),
            "validate-disagree": overlay.find("#gallery-card-disagree-button"),
            "validate-unsure": overlay.find("#gallery-card-unsure-button")
        };

        // If the signed in user had already validated this label before loading the page, style the card to show that.
        if (currCardProperties !== null && currCardProperties.user_validation) {
            if (onExpandedView) showValidationOnExpandedView(currCardProperties.user_validation);
            else showValidationOnCard(currCardProperties.user_validation);
        }

        // Add onClick functions for the validation buttons.
        for (const [valKey, button] of Object.entries(validationButtons)) {
            button.click(validateOnClickOrKeyPress(valKey, false));
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
        valInfoDisplay.agreeContainer.onclick = validateOnClickOrKeyPress('validate-agree', true);
        valInfoDisplay.disagreeContainer.onclick = validateOnClickOrKeyPress('validate-disagree', true);
    }

    /**
     * OnClick function for validation buttons and thumbs up/down buttons.
     * @param newValKey
     * @param thumbsClick {Boolean} Whether the validation came from clicking the thumb icons.
     * @returns {(function(*): void)|*}
     */
    function validateOnClickOrKeyPress(newValKey, thumbsClick) {
        return function (e) {
            // If we aren't just doing what's already been selected, and we have the card properties and modal is open (this last predicate is only necessary if this is the expanded view validation menu).
            if (currSelected !== newValKey && currCardProperties && (!onExpandedView || document.getElementsByClassName("gallery-modal")[0].style.display !== "none")) {
                let validationOption = classToValidationOption[newValKey];

                // Change the look of the card/expanded view to match the new validation.
                referenceCard.updateUserValidation(validationOption);

                // Actually submit the new validation.
                _validateLabel(validationOption, thumbsClick);
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
     * Adds the visual effects of validation to the expanded view (opaque button and border color around GSV).
     *
     * @param validationOption
     */
    function showValidationOnExpandedView(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // If the label had already been validated differently, remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            validationButtons[currSelected].attr('class', 'modal-validation-button');
        }
        currSelected = validationClass;

        // Add the visual effects from the new validation.
        validationButtons[validationClass].attr('class', 'modal-validation-button-selected');
        gsvImage.css('border-color', validationOptionToColor[validationOption]);
        gsvImage.css('background-color', validationOptionToColor[validationOption]);
    }

    /**
     * Resets the border to be transparent and the buttons to be less opaque, indicating a lack of validation.
     * @private
     */
    function _removeValidationVisualsOnExpandedView() {
        currSelected = null;
        gsvImage.css('border-color', 'transparent');
        gsvImage.css('background-color', 'transparent');
        Object.values(validationButtons).forEach(valButton => valButton.attr('class', 'modal-validation-button'));
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     *
     * @param action Validation result.
     * @param thumbsClick {Boolean} Whether the validation came from clicking the thumb icons.
     * @private
     */
    function _validateLabel(action, thumbsClick) {
        // Log how the user validated (thumbs vs on-card menu) and what option they chose.
        let actionStr;
        let sourceStr;
        if (onExpandedView && thumbsClick) actionStr = 'Validate_ThumbsExpandedMenuClick', sourceStr = "GalleryExpandedThumbs";
        else if (onExpandedView && !thumbsClick) actionStr = 'Validate_ExpandedMenuClick', sourceStr = "GalleryExpandedImage";
        else if (!onExpandedView && thumbsClick) actionStr = 'Validate_ThumbsMenuClick', sourceStr = "GalleryThumbs";
        else if (!onExpandedView && !thumbsClick) actionStr = 'Validate_MenuClick', sourceStr = "GalleryImage";
        actionStr += action;
        sg.tracker.push(actionStr, { panoId: currCardProperties.gsv_panorama_id }, { labelId: currCardProperties.label_id });

        let validationTimestamp = new Date().getTime();
        let data = {
            label_id: currCardProperties.label_id,
            label_type: currCardProperties.label_type,
            validation_result: resultOptions[action],
            old_severity: currCardProperties.severity,
            new_severity: currCardProperties.severity,
            old_tags: currCardProperties.tags,
            new_tags: currCardProperties.tags,
            canvas_height: gsvImage.height(),
            canvas_width: gsvImage.width(),
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: sourceStr
        };

        // Record current POV and canvas X/Y position of the label at the current view. This does not change for the
        // static cards, but we need to calculate the current position if it's in the dynamic street view.
        if (!onExpandedView) {
            let labelIcon = refCard.labelIcon;
            data.heading = currCardProperties.heading;
            data.pitch = currCardProperties.pitch;
            data.zoom = currCardProperties.zoom;
            data.canvas_x = Math.round(labelIcon.offsetLeft + labelIcon.getBoundingClientRect().width / 2);
            data.canvas_y = Math.round(labelIcon.offsetTop + labelIcon.getBoundingClientRect().height / 2);
        } else {
            let currPov = modal.pano.panorama.getPov();
            data.heading = currPov.heading;
            data.pitch = currPov.pitch;
            data.zoom = currPov.zoom;

            // For some reason, the usual povToPixel_ route for finding the canvas_x/y isn't working in Gallery, so we
            // are using the actual left/top values for the HTML element instead.
            let labelIcon = $(modal.pano.labelMarker.marker.marker_);
            let labelIconRadius = labelIcon.outerWidth() / 2;
            let labelCanvasX = labelIcon.position().left + labelIconRadius;
            let labelCanvasY = labelIcon.position().top + labelIconRadius;

            // If the user has panned away from the label and it's no longer visible on the canvas, set canvasX/Y to
            // null. We add/subtract the radius of the label so that we still record these values when only a fraction of the
            // label is still visible.
            if (labelCanvasX + labelIconRadius > 0
                && labelCanvasX - labelIconRadius < gsvImage.width()
                && labelCanvasY + labelIconRadius > 0
                && labelCanvasY - labelIconRadius < gsvImage.height()) {
                data.canvas_x = labelCanvasX - labelIconRadius;
                data.canvas_y = labelCanvasY - labelIconRadius;
            } else {
                data.canvas_x = null;
                data.canvas_y = null;
            }
        }

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/validate",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /**
     * Updates the card properties necessary for validation.
     * @param {*} newProperties The properties to update to.
     */
    function updateCardProperties(newProperties) {
        currCardProperties = newProperties;
    }

    /**
     * Updates the reference card. This is only used for the expanded view, whose reference card necessarily changes.
     *
     * @param {Card} newCard The new card the Modal references.
     */
    function updateReferenceCard(newCard) {
        referenceCard = newCard;
        if (onExpandedView) {
            if (currCardProperties !== null && currCardProperties.user_validation) {
                showValidationOnExpandedView(currCardProperties.user_validation);
            } else {
                _removeValidationVisualsOnExpandedView();
            }
        }
    }

    self.updateCardProperties = updateCardProperties;
    self.updateReferenceCard = updateReferenceCard;
    self.showValidationOnCard = showValidationOnCard;
    self.showValidationOnExpandedView = showValidationOnExpandedView;
    self.addModalValInfoOnClicks = addValidationInfoOnClicks;

    _init();
    return self;
}
