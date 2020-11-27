function ValidationMenu(uiCardImage, cardProperties) {
    console.log("Validation Menu instantiated");

    let resultOptions = {
        "Agree": 1, 
        "Disagree": 2,
        "NotSure": 3
    };

    const overlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">Agree</button>
            <button id="gallery-card-disagree-button" class="validation-button">Disagree</button>
            <button id="gallery-card-not-sure-button" class="validation-button">Not Sure</button>
        </div>
    `;

    let overlay = $(overlayHTML);

    let agreeButton = overlay.find("#gallery-card-agree-button");
    let disagreeButton = overlay.find("#gallery-card-disagree-button");
    let notSureButton = overlay.find("#gallery-card-not-sure-button");

    function _init() {
        // TODO: compress this code
        agreeButton.click(function() {
            validateLabel("Agree");
        });
        
        disagreeButton.click(function() {
            validateLabel("Disagree");
        });
        
        notSureButton.click(function() {
            validateLabel("NotSure");
        });

        uiCardImage.appendChild(overlay[0]);
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * @param action
     * @private
     */
    function validateLabel(action) {
        console.log("validate method called");
        let validationTimestamp = new Date().getTime();

        // TODO: fix this and make the ui stuff
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
            url: "/validationLabelMap",
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

    function showConfirmation(action) {
        console.log(action + ": validation submitted successfully :)");
    }

    _init();
    return this;
}