/**
 * Initializes a grouping of menu buttons (agree, disagree, and not sure).
 * @constructor
 */
function MenuButton(menuUI) {
    let self = this;

    menuUI.agreeButton.click(function() {
        validateLabel("Agree");
    });

    menuUI.disagreeButton.click(function() {
        validateLabel("Disagree");
    });

    menuUI.notSureButton.click(function() {
        validateLabel("NotSure");
    });

    // Sends data to database based on when user clicks the validation text area. A check must be performed in order to
    // verify that the text area exists since it currently is not available on mobile.
    if (document.getElementById('validation-label-comment')) {
        document.getElementById('validation-label-comment').onclick = () => {
                svv.tracker.push("ValidationTextField_MouseClick");
        }
    }

    /**
     * Validates a single label from a button click.
     * @param action    {String} Validation action - must be agree, disagree, or not sure.
     */
    function validateLabel (action) {
        let timestamp = new Date().getTime();
        svv.tracker.push("ValidationButtonClick_" + action);

        // Resets CSS elements for all buttons to their default states.
        menuUI.agreeButton.removeClass("validate");
        menuUI.disagreeButton.removeClass("validate");
        menuUI.notSureButton.removeClass("validate");
        
        let comment = '';
        let validationTextArea = document.getElementById('validation-label-comment');
        if (validationTextArea && validationTextArea.value !== '') comment = validationTextArea.value;

        // If enough time has passed between validations, log validations.
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.panoramaContainer.validateLabel(action, timestamp, comment);
        }
    }

    return self;
}
