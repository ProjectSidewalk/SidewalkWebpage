/**
 * Updates the examples and counterexamples on the right side of the validation interface according
 * to the label that is currently displayed on the screen.
 * @returns {StatusExample}
 * @constructor
 */
function StatusExample (statusUI) {
    let self = this;
    let labelType = undefined;
    let labelName = undefined;
    let examplePath = '/assets/javascripts/SVValidate/img/ValidationExamples/';
    let counterExamplePath = '/assets/javascripts/SVValidate/img/ValidationCounterexamples/';

    let exampleImage = $(".example-image");
    exampleImage.on('mouseover', _showExamplePopup);
    exampleImage.on('mouseout', _hideExamplePopup);


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
        let description = undefined;

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
     * Sets the horizontal and vertical position of the popup and popup pointer based on the picture's position.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupLocation (id) {
        // 1 = upper left, 2 = upper right, 3 = bottom left, 4 = bottom right

        // Horizontal positioning.
        if (id.includes("1")) {
            statusUI.popup.css('left', '480px');
            statusUI.popupPointer.css('top', '50px');
        } else if (id.includes("2")) {
            statusUI.popup.css('left', '580px');
            statusUI.popupPointer.css('top', '50px');
        } else if (id.includes("3")) {
            statusUI.popup.css('left', '480px');
            statusUI.popupPointer.css('top', '135px');
        } else if(id.includes("4")) {
            statusUI.popup.css('left', '580px');
            statusUI.popupPointer.css('top', '135px');
        }

        // Vertical Positioning.
        if (id.includes("counterexample")) {
            statusUI.popup.css('top', '108px');
        } else {
            statusUI.popup.css('top', '-108px');
        }
    }

    /**
     * Sets the title of the popup based on which picture was hovered over.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupTitle (id) {
        if (id.includes("counterexample")) {
            statusUI.popupTitle.html(i18next.t(`right-ui.incorrect.${util.camelToKebab(labelType)}.title`));
        } else {
            statusUI.popupTitle.html(i18next.t(`right-ui.correct.${util.camelToKebab(labelType)}.title`));
        }
    }

    /**
     * Handles mouseover events on examples/counterexamples. Displays an popup that shows an image
     * of the label that was either correctly/incorrectly placed and a brief accompanying
     * description.
     * @private
     */
    function _showExamplePopup() {
        let imageSource = $(this).attr("src");
        let id = $(this).attr("id");
        statusUI.popupImage.attr('src', imageSource);

        _setPopupDescription(id);
        _setPopupLocation(id);
        _setPopupTitle(id);

        statusUI.popup.css('visibility', 'visible');
    }

    /**
     * Updates images that shows label counter-examples. Paths for label examples are found at:
     * src/assets/javascripts/SVValidate/img/ValidationCounterexamples/LabelTypeExampleX.png
     * @private
     */
    function _updateCounterExamples () {
        statusUI.example1.attr('src', examplePath + labelType + 'Example1.png');
        statusUI.example2.attr('src', examplePath + labelType + 'Example2.png');
        statusUI.example3.attr('src', examplePath + labelType + 'Example3.png');
        statusUI.example4.attr('src', examplePath + labelType + 'Example4.png');
    }

    /**
     * Updates images that show label examples. Paths for label examples are found at:
     * src/assets/javascripts/SVValidate/img/ValidationCounterexamples/LabelTypeCounterExampleX.png
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
