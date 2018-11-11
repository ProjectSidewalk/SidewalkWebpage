/**
 * Responsible for Yes/No/Unclear buttons
 * @constructor
 */
function MenuButton(menuUI, form) {
    var currentLabel = undefined;

    menuUI.agreeButton.click(function() {
        currentLabel = svv.panorama.getCurrentLabel();
        console.log("Agree button clicked");
        logValidationAction(1);
        svv.panorama.setLabel();
    });

    menuUI.disagreeButton.click(function() {
        console.log("Disagree button clicked");
        logValidationAction(2);
        svv.panorama.setLabel();
    });

    menuUI.unclearButton.click(function() {
        console.log("Unclear button clicked");
        svv.panorama.setLabel();
    });

    /**
     *
     * @param validationResult  Result ID {1: agree, 2: disagree, 3: unclear}
     */
    function logValidationAction(validationResult) {
        var data = {
            "label_id" : currentLabel.getProperty('labelId'),
            "validation_result": validationResult
        };

        svv.tracker.push("ValidationButtonClick", data);
        // form.submit(data, true);
    }
}