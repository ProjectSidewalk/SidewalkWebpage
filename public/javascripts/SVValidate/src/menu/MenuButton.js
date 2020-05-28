/**
 * Initializes a grouping of menu buttons. A group of menu-buttons also contain the same IDs.
 * The type of menu buttons that are currently in use are agree, disagree and not sure.
 * @param           ID of this group of buttons.
 * @constructor
 */
function MenuButton(id) {
    let agreeButtonId = "validation-agree-button-" + id;
    let disagreeButtonId = "validation-disagree-button-" + id;
    let notSureButtonId = "validation-not-sure-button-" + id;
    let self = this;

    self.agreeButton = $("#" + agreeButtonId);
    self.disagreeButton = $("#" + disagreeButtonId);
    self.notSureButton = $("#" + notSureButtonId);

    self.agreeButton.click(function() {
        validateLabel("Agree");
    });

    self.disagreeButton.click(function() {
        validateLabel("Disagree");
    });

    self.notSureButton.click(function() {
        validateLabel("NotSure");
    });

    /* 
        Sends data to database based on when user clicks the validation text area.
        A check must be performed in order to verify that the text area exists since it
        currently is not available on mobile.
    */
    if(document.getElementById('validation-label-comment')){
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

        // Resets CSS elements for all buttons to their default states
        self.agreeButton.removeClass("validate");
        self.disagreeButton.removeClass("validate");
        self.notSureButton.removeClass("validate");
        
        let comment = '';
        let validationTextArea = document.getElementById('validation-label-comment');
        if(validationTextArea && validationTextArea.value !== '') comment = validationTextArea.value;

        // If enough time has passed between validations, log validations
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.panoramaContainer.validateLabelFromPano(id, action, timestamp, comment);
        }
    }

    return self;
}
