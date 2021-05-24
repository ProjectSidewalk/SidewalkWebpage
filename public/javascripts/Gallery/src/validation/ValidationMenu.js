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

    let currSelected = null;
    let card = null;

    const overlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>
    `;

    let overlay = $(overlayHTML);

    let agreeButton = overlay.find("#gallery-card-agree-button");
    let disagreeButton = overlay.find("#gallery-card-disagree-button");
    let notSureButton = overlay.find("#gallery-card-not-sure-button");

    function _init() {
        // TODO: compress this code.
        let card = $(uiCardImage)
        agreeButton.click(function() {
            if (currSelected) {
                currSelected.attr('class', 'validation-button');
            }

            currSelected = agreeButton;
            agreeButton.attr('class', 'validation-button-selected');
            card.css('background-color', '#99ff99')
            validateLabel("Agree");
        });
        
        disagreeButton.click(function() {
            if (currSelected) {
                currSelected.attr('class', 'validation-button');
            }

            currSelected = disagreeButton;
            disagreeButton.attr('class', 'validation-button-selected');
            card.css('background-color', '#ff9999')
            validateLabel("Disagree");
        });
        
        notSureButton.click(function() {
            if (currSelected) {
                currSelected.attr('class', 'validation-button');
            }

            currSelected = notSureButton;
            notSureButton.attr('class', 'validation-button-selected');
            card.css('background-color', '#fdebc5')
            validateLabel("NotSure");
        });
        
        uiCardImage.appendChild(overlay[0]);
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
