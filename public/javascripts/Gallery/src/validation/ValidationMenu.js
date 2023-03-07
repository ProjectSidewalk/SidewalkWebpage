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
 * @param uiCardImage The html element to append the validation menu to.
 * @param cardProperties Properties of the label the validation menu is being appended to
 * @param modal The Modal object; used to update the expanded view when modifying a card.
 * @param onExpandedView A boolean flag. If true, the ValidationMenu is a child of the expanded view.
 *                       If false, the ValidationMenu is a child of a card.
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(refCard, uiCardImage, cardProperties, modal, onExpandedView) {
    let self = this;
    let currCardProperties = cardProperties;
    let referenceCard = refCard;
    let currSelected = null;

    // A kind of wack way to do this, explore better options.
    const resultOptions = {
        "Agree": 1,
        "Disagree": 2,
        "NotSure": 3
    };
    const classToValidationOption = {
        "validate-agree": "Agree",
        "validate-disagree": "Disagree",
        "validate-not-sure": "NotSure"
    };
    const validationOptionToClass = {
        "Agree": "validate-agree",
        "Disagree": "validate-disagree",
        "NotSure": "validate-not-sure"
    };
    const validationOptionToColor = { // TODO put this somewhere more central at the very least.
        'Agree': '#78c9ab',
        'Disagree': '#eb734d',
        'NotSure': '#fbd78b'
    };

    const cardOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>`;
    const modalOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="modal-validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="modal-validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="modal-validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>`;
    let overlay = $(cardOverlayHTML);

    let validationButtons = undefined;
    // This is a regular DOM element, not jquery.
    let galleryCard = uiCardImage.parentElement;

    // Adds onClick functions for the validation buttons.
    function _init() {
        if (onExpandedView) {
            overlay = $(modalOverlayHTML)
        }

        validationButtons = {
            "validate-agree": overlay.find("#gallery-card-agree-button"),
            "validate-disagree": overlay.find("#gallery-card-disagree-button"),
            "validate-not-sure": overlay.find("#gallery-card-not-sure-button")
        };

        // If the signed in user had already validated this label before loading the page, style the card to show that.
        if (currCardProperties !== null && currCardProperties.user_validation) {
            if (onExpandedView) showValidationOnExpandedView(currCardProperties.user_validation);
            else showValidationOnCard(currCardProperties.user_validation);
        }

        // Add onClick functions for the validation buttons.
        for (const [valKey, button] of Object.entries(validationButtons)) {
            let validationOption = classToValidationOption[valKey];
            button.click(function() {
                // Change the look of the card/expanded view to match the new validation.
                if (onExpandedView) {
                    showValidationOnExpandedView(validationOption);
                    referenceCard.validationMenu.showValidationOnCard(validationOption);
                } else {
                    showValidationOnCard(validationOption);
                    if (currCardProperties.label_id === modal.getProperty('label_id')) {
                        modal.validationMenu.showValidationOnExpandedView(validationOption);
                    }
                }
                // Actually submit the new validation.
                validateLabel(validationOption);
            });
        }
        uiCardImage.append(overlay[0]);
    }

    /**
     * Adds the visual effects of validation to the small card (opaque button and fill color below image).
     *
     * @param validationOption
     */
    function showValidationOnCard(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // If the label had already been validated differently, remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            validationButtons[currSelected].attr('class', 'validation-button');
            if (galleryCard.classList.contains(currSelected)) {
                galleryCard.classList.remove(currSelected);
            }
        }
        currSelected = validationClass;

        // Add the visual effects from the new validation.
        galleryCard.classList.add(validationClass);
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
        uiCardImage.css('border-color', validationOptionToColor[validationOption]);
        uiCardImage.css('background-color', validationOptionToColor[validationOption]);
    }

    /**
     * Resets the border to be transparent and the buttons to be less opaque, indicating a lack of validation.
     * @private
     */
    function _removeExpandedValidationVisuals() {
        uiCardImage.css('border-color', 'transparent');
        uiCardImage.css('background-color', 'transparent');
        Object.values(validationButtons).forEach(valButton => valButton.attr('class', 'modal-validation-button'));
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * 
     * @param action Validation result.
     * @private
     */
    function validateLabel(action) {
        referenceCard.setProperty('user_validation', action);

        let actionStr = onExpandedView ? 'Validate_ExpandedMenuClick' + action : 'Validate_MenuClick' + action;
        sg.tracker.push(actionStr, {panoId: currCardProperties.gsv_panorama_id}, {labelId: currCardProperties.label_id});
        let validationTimestamp = new Date().getTime();

        let data = {
            label_id: currCardProperties.label_id,
            label_type: currCardProperties.label_type,
            validation_result: resultOptions[action],
            canvas_x: currCardProperties.canvas_x,
            canvas_y: currCardProperties.canvas_y,
            heading: currCardProperties.heading,
            pitch: currCardProperties.pitch,
            zoom: currCardProperties.zoom,
            canvas_height: sg.auditCanvasHeight,
            canvas_width: sg.auditCanvasWidth,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            is_mobile: false
        };

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
                _removeExpandedValidationVisuals();
            }
        }
    }

    self.updateCardProperties = updateCardProperties;
    self.updateReferenceCard = updateReferenceCard;
    self.showValidationOnCard = showValidationOnCard;
    self.showValidationOnExpandedView = showValidationOnExpandedView;

    _init();
    return self;
}
