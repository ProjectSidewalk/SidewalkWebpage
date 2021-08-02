/**
 * A Validation Menu to be appended to a Card for validation purposes.
 * 
 * @param uiCardImage The html element to append the validation menu to.
 * @param cardProperties Properties of the label the validation menu is being appended to
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(uiCardImage, cardProperties, onExpandedView) {
    const resultOptions = {
        "Agree": 1, 
        "Disagree": 2,
        "NotSure": 3
    };

    let self = this;

    let currentCardProperties = cardProperties;

    let referenceCard = null;

    // A kind of wack way to do this, explore better options.
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

    let currSelected = null;

    const cardOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>
    `;

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

        for (const [valKey, button] of Object.entries(validationButtons)) {
            button.click(function() {
                _showValidated(classToValidationOption[valKey]);
                validateLabel(classToValidationOption[valKey]);
            });
        }
        // If the signed in user had already validated this label before loading the page, style the card to show that.
        if (currentCardProperties !== null && currentCardProperties.user_validation) {
            _showValidated(currentCardProperties.user_validation);
        }
        uiCardImage.append(overlay[0]);
    }

    // Sets the look of the card to show that the label has been validated.
    function _showValidated(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // If the label had already been validated differently, remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            if (!onExpandedView) {
                validationButtons[currSelected].attr('class', 'validation-button');
                if (galleryCard.classList.contains(currSelected)) {
                    galleryCard.classList.remove(currSelected);
                }
            } else {
                validationButtons[currSelected].attr('class', 'modal-validation-button');
            }
           
        }

        // Add the visual effects from the new validation.
        currSelected = validationClass;
        if (referenceCard !== null) {
            referenceCard.setProperty('user_validation', validationOption);
        }
        if (!onExpandedView) {
            galleryCard.classList.add(validationClass);
            validationButtons[validationClass].attr('class', 'validation-button-selected');
        } else {
            referenceCard.validationMenu._showValidated(validationOption);
            validationButtons[validationClass].attr('class', 'modal-validation-button-selected');
        }
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * 
     * @param action Validation result.
     * @private
     */
    function validateLabel(action) {
        console.log("validate method called");

        // TODO: do we need this log?
        sg.tracker.push("Validate_MenuClick=" + action);
        let validationTimestamp = new Date().getTime();

        let data = {
            label_id: currentCardProperties.label_id,
            label_type: currentCardProperties.label_type,
            validation_result: resultOptions[action],
            canvas_x: currentCardProperties.canvas_x,
            canvas_y: currentCardProperties.canvas_y,
            heading: currentCardProperties.heading,
            pitch: currentCardProperties.pitch,
            zoom: currentCardProperties.zoom,
            canvas_height: currentCardProperties.canvas_height,
            canvas_width: currentCardProperties.canvas_width,
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
                showConfirmation(action);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /**
     * Confirm successful submit of validation.
     * TODO: Probably want to remove for prod or show confirmation through something else.
     * 
     * @param {*} action Validation result.
     */
    function showConfirmation(action) {
        console.log(action + ": validation submitted successfully :)");
    }

    /**
     * Updates the card properties neccesary for validation.
     * @param {*} newProperties The properties to update to.
     */
    function updateCardProperties(newProperties) {
        currentCardProperties = newProperties;
    }

    /**
     * When using the ValidationMenu as a part of the Modal, the card the Modal is expanding is updated.
     * 
     * @param {Card} newCard The new card the Modal references.
     */
    function updateReferenceCard(newCard) {
        referenceCard = newCard;
        if (currentCardProperties !== null && currentCardProperties.user_validation) {
            _showValidated(currentCardProperties.user_validation);
        }
    }

    self.updateCardProperties = updateCardProperties;
    self.updateReferenceCard = updateReferenceCard;
    self._showValidated = _showValidated;
    _init();
    return self;
}
