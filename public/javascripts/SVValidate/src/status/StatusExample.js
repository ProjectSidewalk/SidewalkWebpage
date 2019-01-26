/**
 * Updates the examples and counterexamples on the right side of the validation interface according
 * to the label that is currently displayed on the screen.
 * @returns {StatusExample}
 * @constructor
 */
function StatusExample (statusUI) {
    var self = this;
    var labelType = undefined;
    var labelName = undefined;
    var examplePath = 'assets/javascripts/SVValidate/img/ValidationExamples/';
    var counterExamplePath = 'assets/javascripts/SVValidate/img/ValidationCounterexamples/';

    $(".example-image").on('mouseover', _showExamplePopup);
    $(".example-image").on('mouseout', _hideExamplePopup);


    /**
     * Updates the images on the side of the validation interface.
     * @param label Type of label being displayed on the interface.
     */
    function updateLabelImage (label) {
        labelType = label;
        labelName = svv.labelNames[labelType];

        _updateCounterExamples();
        _updateExamples();
    }

    function _hideExamplePopup () {
        statusUI.popup.css('visibility', 'hidden');
    }

    function _setPopupDescription (id) {
        var description = undefined;

        switch (labelType) {
            case "CurbRamp":
                description = svv.statusPopupDescriptions.getCurbRampDescription(id);
                break;
            case "NoCurbRamp":
                description = svv.statusPopupDescriptions.getMissingCurbRampDescription(id);
                break;
            case "Obstacle":
                description = svv.statusPopupDescriptions.getObstacleDescription(id);
                break;
            case "SurfaceProblem":
                description = svv.statusPopupDescriptions.getSurfaceProblemDescription(id);
                break;
            case "NoSidewalk":
                description = svv.statusPopupDescriptions.getNoSidewalkDescription(id);
                break;
        }

        statusUI.popupDescription.html(description);
    }

    /**
     * Sets the horizontal position and height of the popup based on which picture was hovered over.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupLocation (id) {
        // 1 = upper left, 2 = upper right, 3 = bottom left, 4 = bottom right
        if (id.includes("1")) {
            statusUI.popup.css('left', '480px');
            statusUI.popupPointer.css('margin-top', '-205px');
        } else if (id.includes("2")) {
            statusUI.popup.css('left', '580px');
            statusUI.popupPointer.css('margin-top', '-205px');
        } else if (id.includes("3")) {
            statusUI.popup.css('left', '480px');
            statusUI.popupPointer.css('margin-top', '-125px');
        } else if(id.includes("4")) {
            statusUI.popup.css('left', '580px');
            statusUI.popupPointer.css('margin-top', '-125px');
        }
    }

    /**
     * Sets the vertical position and title of the popup based on which picture was hovered over.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupTitle (id) {
        var prefix = svv.statusField.createPrefix(labelType);
        if (id.includes("counterexample")) {
            statusUI.popupTitle.html("Not " + prefix + labelName);
            statusUI.popup.css('top', '375px');
        } else {
            statusUI.popupTitle.html(labelName);
            statusUI.popup.css('top', '175px');
        }
    }

    function _showExamplePopup() {
        var imageSource = $(this).attr("src");
        var id = $(this).attr("id");
        statusUI.popupImage.attr('src', imageSource);

        _setPopupDescription(id);
        _setPopupLocation(id);
        _setPopupTitle(id);

        statusUI.popup.css('visibility', 'visible');
    }

    /**
     * Updates images that shows label counter-examples.
     * @param labelType Type of label being displayed on the interface.
     * @private
     */
    function _updateCounterExamples () {
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
    function _updateExamples () {
        statusUI.counterExample1.attr('src', counterExamplePath + labelType + 'CounterExample1.png');
        statusUI.counterExample2.attr('src', counterExamplePath + labelType + 'CounterExample2.png');
        statusUI.counterExample3.attr('src', counterExamplePath + labelType + 'CounterExample3.png');
        statusUI.counterExample4.attr('src', counterExamplePath + labelType + 'CounterExample4.png');
    }

    self.updateLabelImage = updateLabelImage;

    return this;
}