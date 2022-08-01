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

    // This object holds the translations for all the correct/incorrect example descriptions.
    let descriptionTranslations = i18next.t('right-ui', { returnObjects: true });

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

    /**
     * Set the description for the popup at the given HTML id by building the key for the correct translation.
     *
     * HTML IDs look like '{example,counterexample}-image-{1,2,3,4}', and we use this ID to build the key to translate
     * that looks like 'right-ui.{correct,incorrect}.example-{list of dash-separated numbers}'. So if we have the same
     * text for 'example-image-{1,3, and 4}', then the translation key will be 'right-ui.correct.example-1-3-4'.
     * @param id
     * @private
     */
    function _setPopupDescription (id) {
        let correctness = id.startsWith('example') ? 'correct' : 'incorrect';
        let exampleNum = id.charAt(id.length - 1);
        let translations = descriptionTranslations[correctness][util.camelToKebab(labelType)];
        let key = Object.keys(translations).filter(k => k.startsWith('example') && k.includes(exampleNum));
        statusUI.popupDescription.html(translations[key]);
    }

    /**
     * Sets the horizontal and vertical position of the popup and popup pointer based on the picture's position.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupLocation (id) {
        // 1 = upper left, 2 = upper right, 3 = bottom left, 4 = bottom right

        // Positioning within the group of 4 examples (correct or incorrect).
        if (id.includes("1")) {
            statusUI.popup.css('left', '490px');
            statusUI.popupPointer.css('top', '50px');
        } else if (id.includes("2")) {
            statusUI.popup.css('left', '590px');
            statusUI.popupPointer.css('top', '50px');
        } else if (id.includes("3")) {
            statusUI.popup.css('left', '490px');
            statusUI.popupPointer.css('top', '135px');
        } else if(id.includes("4")) {
            statusUI.popup.css('left', '590px');
            statusUI.popupPointer.css('top', '135px');
        }

        // Position based on the correct v incorrect group.
        if (id.includes("counterexample")) {
            statusUI.popup.css('top', '196px');
        } else {
            statusUI.popup.css('top', '-10px');
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
