/**
 * Responsible for Yes/No/Unsure buttons
 * @constructor
 */
function MenuButton(menuUI, form) {
    var properties = {
        labelId: undefined,
        labelType: undefined,
        validationResult: undefined
    };
    var self = this;

    menuUI.agreeButton.click(function() {
        console.log("Agree button clicked");
        recordAction(1);
        svv.panorama.setLabel();
    });

    menuUI.disagreeButton.click(function() {
        console.log("Disagree button clicked");
        recordAction(2);
        svv.panorama.setLabel();
    });

    menuUI.unsureButton.click(function() {
        console.log("Unsure button clicked");
        recordAction(3);
        svv.panorama.setLabel();
    });

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     *
     * @param validationResult  Result ID {1: agree, 2: disagree, 3: unsure}
     */
    function recordAction(validationResult) {
        setProperty("labelId", svv.panorama.getCurrentLabel().getProperty("labelId"));
        setProperty("labelType", svv.panorama.getCurrentLabel().getProperty("labelType"));
        setProperty("validationResult", validationResult);
        switch (validationResult) {
            case 1:
                svv.tracker.push("ValidationButtonClick_Agree");
                break;
            case 2:
                svv.tracker.push("ValidationButtonClick_Disagree");
                break;
            case 3:
                svv.tracker.push("ValidationButtonClick_Unsure");
                break;
        }

        // console.log("[MenuButton.js] labelId: " + getProperty("labelId") + ", labelType: " + getProperty("labelType") + ", validationResult: " + getProperty("validationResult"));
        // form.submit(data, true);
    }

    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    self.getProperty = getProperty;
    self.setProperty = setProperty;

    return self;
}