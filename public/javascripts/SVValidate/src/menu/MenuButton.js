/**
 * Initializes a grouping of menu buttons (yes, no, and unsure).
 * @constructor
 */
function MenuButton(menuUI) {
    let self = this;

    menuUI.yesButton.click(function() {
        validateLabel("Agree");
    });
    menuUI.noButton.click(function() {
        validateLabel("Disagree");
    });
    menuUI.unsureButton.click(function() {
        validateLabel("Unsure");
    });

    // Sends data to database based on when user clicks the validation text area. A check must be performed in order to
    // verify that the text area exists since it currently is not available on mobile.
    if (menuUI.comment) {
        menuUI.comment.click(function() {
            svv.tracker.push("ValidationTextField_MouseClick");
        });
    }

    /**
     * Validates a single label from a button click.
     * @param action    {String} Validation action - must be agree, disagree, or unsure.
     */
    function validateLabel(action) {
        let timestamp = new Date().getTime();
        svv.tracker.push("ValidationButtonClick_" + action);

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass("validate");
        menuUI.noButton.removeClass("validate");
        menuUI.unsureButton.removeClass("validate");
        
        let comment = '';
        let validationTextArea = menuUI.comment[0];
        if (validationTextArea && validationTextArea.value !== '') comment = validationTextArea.value;

        // If enough time has passed between validations, log validations.
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.panoramaContainer.validateLabel(action, timestamp, comment);
        }
    }

    return self;
}
