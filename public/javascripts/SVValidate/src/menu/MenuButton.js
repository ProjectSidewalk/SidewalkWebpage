/**
 * Responsible for Yes/No/Unsure buttons
 * @constructor
 */
function MenuButton(menuUI) {
    var self = this;

    menuUI.agreeButton.click(function() {
        validateLabel("Agree");
    });

    menuUI.disagreeButton.click(function() {
        validateLabel("Disagree");
    });

    menuUI.notSureButton.click(function() {
        validateLabel("NotSure");
    });

    /**
     * Validates a single label from a button click.
     * @param action    {String} Validation action - must be agree, disagree, or not sure.
     */
    function validateLabel (action) {
        var timestamp = new Date().getTime();
        menuUI.agreeButton.removeClass("validate");
        menuUI.disagreeButton.removeClass("validate");
        menuUI.notSureButton.removeClass("validate");
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.tracker.push("ValidationButtonClick_" + action);
            svv.panorama.getCurrentLabel().validate(action);
            svv.panorama.setProperty('validationTimestamp', timestamp);
        }
    }

    return self;
}
