/**
 * Responsible for Yes/No/Unsure buttons
 * @constructor
 */
function MenuButton(menuUI, form) {
    var self = this;

    menuUI.agreeButton.click(function() {
        console.log("Agree button clicked");
        clickButton(1);
        svv.panorama.setLabel();
    });

    menuUI.disagreeButton.click(function() {
        console.log("Disagree button clicked");
        clickButton(2);
        svv.panorama.setLabel();
    });

    menuUI.unsureButton.click(function() {
        console.log("Unsure button clicked");
        clickButton(3);
        svv.panorama.setLabel();
    });

    /**
     *
     * @param validationResult  Result ID {1: agree, 2: disagree, 3: unsure}
     */
    function clickButton(validationResult) {
        var currentLabel = svv.panorama.getCurrentLabel();
        currentLabel.setProperty("validationResult", validationResult);
        currentLabel.setProperty("endTimestamp", new Date().getTime());

        switch (validationResult) {
            case 1:
                svv.labelContainer.push(currentLabel.getProperties());
                svv.tracker.push("ValidationButtonClick_Agree");
                break;
            case 2:
                svv.labelContainer.push(currentLabel.getProperties());
                svv.tracker.push("ValidationButtonClick_Disagree");
                break;
            case 3:
                svv.labelContainer.push(currentLabel.getProperties());
                svv.tracker.push("ValidationButtonClick_Unsure");
                break;
        }

        // console.log("[MenuButton.js] labelId: " + getProperty("labelId") + ", labelType: " + getProperty("labelType") + ", validationResult: " + getProperty("validationResult"));
        // form.submit(data, true);
    }

    return self;
}