/**
 * A Validation Menu to be appended to a Card for validation purposes.
 * 
 * @param uiCardImage The html element to append the validation menu to.
 * @param cardProperties Properties of the label the validation menu is being appended to
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(uiCardImage, cardProperties) {
    let resultOptions = {
        "Agree": 1, 
        "Disagree": 2,
        "NotSure": 3
    };

    // A kind of wack way to do this, explore better options.
    let classToResult = {
        "validate-agree": "Agree",
        "validate-disagree": "Disagree",
        "validate-not-sure": "NotSure"
    };

    let currSelected = null;

    const overlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>
    `;

    let overlay = $(overlayHTML);

    let validationButtons = {
        "validate-agree": overlay.find("#gallery-card-agree-button"),
        "validate-disagree": overlay.find("#gallery-card-disagree-button"),
        "validate-not-sure": overlay.find("#gallery-card-not-sure-button")
    };

    // let agreeButton = overlay.find("#gallery-card-agree-button");
    // let disagreeButton = overlay.find("#gallery-card-disagree-button");
    // let notSureButton = overlay.find("#gallery-card-not-sure-button");

    // This is a regular DOM element, not jquery.
    let galleryCard = uiCardImage.parentElement;

    function _init() {
        // TODO: compress this code.
        for (const [valKey, button] of Object.entries(validationButtons)) {
            button.click(function() {
                console.log(valKey);
                console.log(button);
                if (currSelected) {
                    validationButtons[currSelected].attr('class', 'validation-button');
                    if (galleryCard.classList.contains(currSelected)) {
                        galleryCard.classList.remove(currSelected);
                    }
                }

                currSelected = valKey;
                button.attr('class', 'validation-button-selected');
                galleryCard.classList.add(valKey);

                validateLabel(classToResult[valKey]);
            })
        }

        // agreeButton.click(function() {
        //     if (currSelected) {
        //         currSelected.attr('class', 'validation-button');
        //     }

        //     currSelected = agreeButton;
        //     agreeButton.attr('class', 'validation-button-selected');
        //     if (el.classList.contains("red")) {
        //         el.classList.remove("red");
        //     }
        //     galleryCard.className = 'gallery-card validate-agree';

        //     validateLabel("Agree");
        // });
        
        // disagreeButton.click(function() {
        //     if (currSelected) {
        //         currSelected.attr('class', 'validation-button');
        //     }

        //     currSelected = disagreeButton;
        //     disagreeButton.attr('class', 'validation-button-selected');
        //     galleryCard.className = 'gallery-card validate-disagree';

        //     validateLabel("Disagree");
        // });
        
        // notSureButton.click(function() {
        //     if (currSelected) {
        //         currSelected.attr('class', 'validation-button');
        //     }

        //     currSelected = notSureButton;
        //     notSureButton.attr('class', 'validation-button-selected');
        //     galleryCard.className = 'gallery-card validate-not-sure';

        //     validateLabel("NotSure");
        // });

        uiCardImage.append(overlay[0]);
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
            label_id: cardProperties.label_id,
            label_type: cardProperties.label_type,
            validation_result: resultOptions[action],
            canvas_x: cardProperties.canvas_x,
            canvas_y: cardProperties.canvas_y,
            heading: cardProperties.heading,
            pitch: cardProperties.pitch,
            zoom: cardProperties.zoom,
            canvas_height: cardProperties.canvas_height,
            canvas_width: cardProperties.canvas_width,
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

    _init();
    return this;
}
