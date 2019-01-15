/**
 * Updates the examples and counterexamples on the right side of the validation interface according
 * to the label that is currently displayed on the screen.
 * @returns {StatusExample}
 * @constructor
 */
function StatusExample () {
    var self = this;

    // jQuery elements for example images.
    var example1 = $("#example-image-1");
    var example2 = $("#example-image-2");
    var example3 = $("#example-image-3");
    var example4 = $("#example-image-4");

    // jQuery elements for counter-example images.
    var counterExample1 = $("#counterexample-image-1");
    var counterExample2 = $("#counterexample-image-2");
    var counterExample3 = $("#counterexample-image-3");
    var counterExample4 = $("#counterexample-image-4");

    /**
     * Updates the images on the side of the validation interface.
     * @param labelType Type of label being displayed on the interface.
     */
    function updateLabelImage (labelType) {
        _updateCounterExamples(labelType);
        _updateExamples(labelType);
    }

    /**
     * Updates images that shows label counter-examples.
     * @param labelType Type of label being displayed on the interface.
     * @private
     */
    function _updateCounterExamples (labelType) {
        console.log("Label Type: " + labelType);
        example1.attr('src', 'assets/javascripts/SVValidate/img/ValidationExamples/' + labelType + 'Example1.png');
        example2.attr('src', 'assets/javascripts/SVValidate/img/ValidationExamples/' + labelType + 'Example2.png');
        example3.attr('src', 'assets/javascripts/SVValidate/img/ValidationExamples/' + labelType + 'Example3.png');
        example4.attr('src', 'assets/javascripts/SVValidate/img/ValidationExamples/' + labelType + 'Example4.png');
    }

    /**
     * Updates images that show label examples.
     * @param labelType being displayed on the interface.
     * @private
     */
    function _updateExamples (labelType) {
        counterExample1.attr('src', 'assets/javascripts/SVValidate/img/ValidationCounterexamples/' + labelType + 'CounterExample1.png');
        counterExample2.attr('src', 'assets/javascripts/SVValidate/img/ValidationCounterexamples/' + labelType + 'CounterExample2.png');
        counterExample3.attr('src', 'assets/javascripts/SVValidate/img/ValidationCounterexamples/' + labelType + 'CounterExample3.png');
        counterExample4.attr('src', 'assets/javascripts/SVValidate/img/ValidationCounterexamples/' + labelType + 'CounterExample4.png');
    }

    self.updateLabelImage = updateLabelImage;

    return this;
}