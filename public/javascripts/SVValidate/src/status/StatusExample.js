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

    function _hideExamplePopup () {
        statusUI.popup.css('visibility', 'hidden');
    }

    function _showExamplePopup() {
        var imageSource = $(this).attr("src");
        var id = $(this).attr("id");
        statusUI.popupImage.attr('src', imageSource);
        console.log("Showing popup for " + id + ", image source = " + imageSource);

        _setPopupLocation(id);
        _setPopupTitle(id);

        statusUI.popup.css('visibility', 'visible');
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
            statusUI.popupPointer.css('margin-top', '-155px');
        } else if (id.includes("2")) {
            statusUI.popup.css('left', '580px');
            statusUI.popupPointer.css('margin-top', '-155px');
        } else if (id.includes("3")) {
            statusUI.popup.css('left', '480px');
            statusUI.popupPointer.css('margin-top', '-80px');
        } else if(id.includes("4")) {
            statusUI.popup.css('left', '580px');
            statusUI.popupPointer.css('margin-top', '-80px');
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