/**
 * Responsible for Yes/No/Unsure buttons
 * @constructor
 */
function MenuButton(menuUI) {
    var self = this;

    menuUI.agreeButton.click(function() {
        console.log("Agree button clicked");
        svv.tracker.push("ValidationButtonClick_Agree");
        svv.panorama.getCurrentLabel().validate("Agree");
    });

    menuUI.disagreeButton.click(function() {
        console.log("Disagree button clicked");
        svv.tracker.push("ValidationButtonClick_Disagree");
        svv.panorama.getCurrentLabel().validate("Disagree");
    });

    menuUI.notSureButton.click(function() {
        console.log("Unsure button clicked");
        svv.tracker.push("ValidationButtonClick_Unsure");
        svv.panorama.getCurrentLabel().validate("Unsure");
    });

    return self;
}