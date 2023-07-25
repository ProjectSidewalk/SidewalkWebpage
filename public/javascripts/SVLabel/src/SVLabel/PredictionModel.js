
const PredictionModel = function () {

    const popupVerticalOffset = 60;

    const $predictionModelPopupContainer = $('.prediction-model-popup-container');
    const $commonMistakesPopup = $('.common-mistakes-popup-container');
    const $commonMistakesCurrentLabelImage = $('.common-mistakes-current-label-image');


    const predictionModelExamplesDescriptor  = {
        'CurbRamp': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [
                {
                    'image': 'assets/images/tutorials/curbramp-correct-1.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
                {
                    'image': 'assets/images/tutorials/curbramp-correct-1.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
                {
                    'image': 'assets/images/tutorials/curbramp-correct-1.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
                {
                    'image': 'assets/images/tutorials/curbramp-correct-1.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
            ],
            'incorrect-examples': [
                {
                    'image': 'assets/images/tutorials/curbramp-incorrect-2.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
                {
                    'image': 'assets/images/tutorials/curbramp-incorrect-2.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
                {
                    'image': 'assets/images/tutorials/curbramp-incorrect-2.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
                {
                    'image': 'assets/images/tutorials/curbramp-incorrect-2.png',
                    'description': 'The curb ramp is clearly visible and is not obstructed by any objects.'
                },
            ],
        },
        'NoCurbRamp': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [],
            'incorrect-examples': [],
        },
        'Obstacle': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [],
            'incorrect-examples': [],
        },
        'SurfaceProblem': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [],
            'incorrect-examples': [],
        },
        'NoSidewalk': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [],
            'incorrect-examples': [],
        },
        'Crosswalk': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [],
            'incorrect-examples': [],
        },
        'Signal': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [],
            'incorrect-examples': [],
        }
    };


    function showLabelPredictionFlag (mousePosition, labelType) {

        $('.label-type', $predictionModelPopupContainer).text(labelType);
        $('.prediction-model-popup-text', $predictionModelPopupContainer).text(predictionModelExamplesDescriptor[labelType].subtitle);

        $predictionModelPopupContainer.attr('data-label-type', labelType);

        $predictionModelPopupContainer.show();
        const popupWidth = $predictionModelPopupContainer.width();
        const popupHeight = $predictionModelPopupContainer.height();

        const left = mousePosition.leftUpX - popupWidth / 2;
        const top = mousePosition.leftUpY - popupHeight - popupVerticalOffset;
        $predictionModelPopupContainer.css({ left: left, top: top });

    }

    function showExamples(labelType, correctOrIncorrect) {

        function renderExamples(examples) {

            $('.example-unit-container:not(.template)', $commonMistakesPopup).remove();

            for (let i = 0; i < examples.length; i++) {

                const $exampleUnit = $('.example-unit-container.template').clone().removeClass('template');

                const example = examples[i];
                $('img', $exampleUnit).attr('src', example.image);
                $('.example-unit-description', $exampleUnit).text(example.description);

                $('.examples-panel-container', $commonMistakesPopup).append($exampleUnit);
            }
        }

        if (correctOrIncorrect === 'correct') {
            renderExamples(predictionModelExamplesDescriptor[labelType]['correct-examples']);

            $('.examples-panel-title-text').text('Correct Examples');

            $('.current-page', $commonMistakesPopup).text('2/2');
            $('.correct-examples-button', $commonMistakesPopup).css('visibility', 'hidden');
            $('.common-mistakes-button', $commonMistakesPopup).css('visibility', 'visible');
        } else {
            renderExamples(predictionModelExamplesDescriptor[labelType]['incorrect-examples']);

            $('.examples-panel-title-text').text('Common Mistakes');

            $('.current-page', $commonMistakesPopup).text('1/2');
            $('.correct-examples-button', $commonMistakesPopup).css('visibility', 'visible');
            $('.common-mistakes-button', $commonMistakesPopup).css('visibility', 'hidden');
        }

        $('.examples-panel-container').addClass(correctOrIncorrect);
    }

    function showCommonMistakesPopup(labelType) {

        // Show the current label screenshot from the GSV.

        var webglImage = (function convertCanvasToImage(canvas) {
            var image = new Image();
            image.src = canvas.toDataURL('image/jpeg', 0.8);
            return image;
        })($('.widget-scene-canvas')[0]);

        $('img', $commonMistakesCurrentLabelImage).attr('src', webglImage.src);

        // Show the common mistakes examples for the current label type.
        showExamples(labelType, 'incorrect');

        $commonMistakesPopup.show();
    }

    function attachEventHandlers() {
        $('.popup-close-button, .prediction-model-mistake-yes-button', $predictionModelPopupContainer).on('click', function () {
            $predictionModelPopupContainer.hide();
        });

        $('.popup-close-button', $commonMistakesPopup).on('click', function () {
            $commonMistakesPopup.hide();
        });

        $('.back-to-labeling-button', $commonMistakesPopup).on('click', function () {
            $commonMistakesPopup.hide();
        });

        $('.prediction-model-view-examples-button').on('click', function () {
            const labelType = $predictionModelPopupContainer.attr('data-label-type');
            showCommonMistakesPopup(labelType);
        });

        $('.common-mistakes-button').on('click', function () {
            const labelType = $predictionModelPopupContainer.attr('data-label-type');
            showExamples(labelType, 'incorrect');
        });

        $('.correct-examples-button').on('click', function () {
            const labelType = $predictionModelPopupContainer.attr('data-label-type');
            showExamples(labelType, 'correct');
        });
    }

    attachEventHandlers();

    return {
        showLabelPredictionFlag: showLabelPredictionFlag
    };
}();
