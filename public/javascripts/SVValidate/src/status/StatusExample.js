/**
 * Updates the examples and counterexamples on the right side of the validation interface according
 * to the label that is currently displayed on the screen.
 * @returns {StatusExample}
 * @constructor
 */
function StatusExample (statusUI) {
    var self = this;
    self.labelType = undefined;

    var labelName = undefined;
    var examplePath = 'assets/javascripts/SVValidate/img/ValidationExamples/';
    var counterExamplePath = 'assets/javascripts/SVValidate/img/ValidationCounterexamples/';

    $(".example-image").on('mouseover', showExamplePopup);
    $(".example-image").on('mouseout', hideExamplePopup);

    function hideExamplePopup () {
        statusUI.popup.css('visibility', 'hidden');
    }

    function showExamplePopup() {
        var imageSource = $(this).attr("src");
        var id = $(this).attr("id");
        var prefix = svv.statusField.createPrefix(self.labelType);
        statusUI.popupImage.attr('src', imageSource);
        console.log("Showing popup for " + id + ", image source = " + imageSource);

        if (id.includes("2") || id.includes("4")) {
            console.log("right image");
            statusUI.popup.css('left', '580px');
        } else {
            console.log("left image");
            statusUI.popup.css('left', '480px');
        }

        if (id.includes("counterexample")) {
            statusUI.popupTitle.html("Not a " + prefix + labelName);
            statusUI.popup.css('top', '375px');
        } else {
            statusUI.popupTitle.html(labelName);
            statusUI.popup.css('top', '175px');
        }

        statusUI.popup.css('visibility', 'visible');
    }

    /**
     * Updates the images on the side of the validation interface.
     * @param labelType Type of label being displayed on the interface.
     */
    function updateLabelImage (labelType) {
        self.labelType = labelType;
        labelName = svv.labelNames[labelType];

        // Temporary: for NoSidewalk, Other and Occlusion labels, just use curb ramp images.
        if (labelType === "NoSidewalk" || labelType === "Occlusion") {
            labelType = "CurbRamp";
        }

        _updateCounterExamples(labelType);
        _updateExamples(labelType);
    }

    /**
     * Updates images that shows label counter-examples.
     * @param labelType Type of label being displayed on the interface.
     * @private
     */
    function _updateCounterExamples (labelType) {
        statusUI.example1.attr('src', examplePath + labelType + 'Example1.png');
        statusUI.example2.attr('src', examplePath + labelType + 'Example2.png');
        statusUI.example3.attr('src', examplePath + labelType + 'Example3.png');
        statusUI.example4.attr('src', examplePath + labelType + 'Example4.png');
    }

    /**
     * Updates images that show label examples.
     * @param labelType being displayed on the interface.
     * @private
     */
    function _updateExamples (labelType) {
        statusUI.counterExample1.attr('src', counterExamplePath + labelType + 'CounterExample1.png');
        statusUI.counterExample2.attr('src', counterExamplePath + labelType + 'CounterExample2.png');
        statusUI.counterExample3.attr('src', counterExamplePath + labelType + 'CounterExample3.png');
        statusUI.counterExample4.attr('src', counterExamplePath + labelType + 'CounterExample4.png');
    }

    self.updateLabelImage = updateLabelImage;

    return this;
}