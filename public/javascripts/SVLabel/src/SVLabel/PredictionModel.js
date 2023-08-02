
const PredictionModel = function () {

    // Vertical distance between the label and the popup.
    const popupVerticalOffset = 55;

    const $predictionModelPopupContainer = $('.prediction-model-popup-container');
    const $commonMistakesPopup = $('.common-mistakes-popup-container');
    const $commonMistakesCurrentLabelImage = $('.common-mistakes-current-label-image');

    const $gsvLayer = $('.gsv-layer');

    const $panorama = $('.window-streetview');
    const panoWidth = $panorama.width();
    const panoHeight = $panorama.height();

    let svlLocal = null; // SVLabel instance.


    let session = null;


    // Important variable to track the current label.
    let currentLabel = null;

    const predictionModelExamplesDescriptor  = {
        'CurbRamp': {
            'subtitle': 'Tip: The #1 curb ramp mistake is labeling <b>driveways</b> as curb ramps.',
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


    async function predict(data) {
        // use an async context to call onnxruntime functions.
        try {

            // prepare inputs. a tensor need its corresponding TypedArray as data
            const dataA = Float32Array.from(data = [data.severity, data.zoom, 0, 0, 10, 0, data.has_description, data.tag_count, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            const tensorA = new ort.Tensor('float32', dataA, [1, 23]);

            // prepare feeds. use model input names as keys.
            const feeds = { dense_input: tensorA };

            // feed inputs and run
            const results = await session.run(feeds, ['dense_2']);

            // read from results
            const dataC = results.dense_2.data[0];

            return dataC;

        } catch (e) {
            alert(`failed to inference ONNX model: ${e}.`);
        }
    }

    // We may not support prediction for all label types. Hence this check.
    function isPredictionSupported(labelType) {
        // Simple logic to see if support a label type--if it is defined in the descriptor.
        return predictionModelExamplesDescriptor[labelType] !== undefined;
    }


    // Calls the predict function and depending on the result, shows the popup UI.
    function predictAndShowUI (data, label, svl) {

        // If prediction is not supported for the label type, return.
        // @Mikey, please check if this is correct.
        if (!isPredictionSupported(label.getProperties().labelType)) {
            return;
        }

        if (session === null) {
            alert('Please load a model first.');
        }

        const t1 = new Date().getTime();

        const predictedScore = predict(data);

        predictedScore.then((score) => {
            console.log(score);

            console.log('Time elapsed: ' + (new Date().getTime() - t1).toString());

            currentLabel = label;

            // We probably don't want to reassign. Not sure if it has any implications.
            // @Mikey please check.
            if (svlLocal === null)
                svlLocal = svl;

            const labelProps = currentLabel.getProperties();

            $('.label-type', $predictionModelPopupContainer).text(i18next.t(`common:${util.camelToKebab(labelProps.labelType)}`));
            $('.prediction-model-popup-text', $predictionModelPopupContainer).html(predictionModelExamplesDescriptor[labelProps.labelType].subtitle); // this could contain HTML.

        $predictionModelPopupContainer.show();

            const popupHeight = $predictionModelPopupContainer.height();

            const left = labelProps.currCanvasXY.x - 24;
            const top = labelProps.currCanvasXY.y - popupHeight - popupVerticalOffset;
            $predictionModelPopupContainer.css({ left: left, top: top });

        });
    }

    function showExamples(labelType, correctOrIncorrect) {

        function renderExamples(examples) {

            $('.example-unit-container:not(.template)', $commonMistakesPopup).remove();

            for (let i = 0; i < examples.length; i++) {

                const $exampleUnit = $('.example-unit-container.template').clone().removeClass('template');

                const example = examples[i];
                $('img', $exampleUnit).attr('src', example.image);
                $('.example-unit-description', $exampleUnit).text(example.description);

                $exampleUnit.addClass(`unit-${i.toString()}`);

                $('.examples-panel-container', $commonMistakesPopup).append($exampleUnit);
            }
        }

        if (correctOrIncorrect === 'correct') {
            renderExamples(predictionModelExamplesDescriptor[labelType]['correct-examples']);

            $('.examples-panel-title-text').text('Correct Examples');
            $('.examples-panel-title-icon.common-mistakes-icon').hide();
            $('.examples-panel-title-icon.correct-examples-icon').show();

            $('.current-page', $commonMistakesPopup).text('2/2');
            $('.correct-examples-button', $commonMistakesPopup).addClass('disabled');
            $('.common-mistakes-button', $commonMistakesPopup).removeClass('disabled');

            $('.examples-panel-container').removeClass('common-mistakes').addClass('correct-examples');

        } else {
            renderExamples(predictionModelExamplesDescriptor[labelType]['incorrect-examples']);

            $('.examples-panel-title-text').text('Common Mistakes');
            $('.examples-panel-title-icon.correct-examples-icon').hide();
            $('.examples-panel-title-icon.common-mistakes-icon').show();

            $('.current-page', $commonMistakesPopup).text('1/2');
            $('.correct-examples-button', $commonMistakesPopup).removeClass('disabled');
            $('.common-mistakes-button', $commonMistakesPopup).addClass('disabled');

            $('.examples-panel-container').removeClass('correct-examples').addClass('common-mistakes');
        }

        $('.examples-panel-container').addClass(correctOrIncorrect);
    }

    function showCommonMistakesPopup(labelType) {

        // Shows and positions the icon on the current label screenshot.
        function showCurrentLabelScreenshot() {

            // Only positions the icon on the pano screenshot.
            // Should be called once the image is loaded.
            function positionCurrentLabelIcon() {
                const currentLabelProps = currentLabel.getProperties();
                const labelCanvasXY = currentLabelProps.currCanvasXY;
                const scaledX = (labelCanvasXY.x * $gsvLayer.width()) / panoWidth;
                const scaledY = (labelCanvasXY.y * $gsvLayer.height()) / panoHeight;

                $('.common-mistakes-current-label-icon', $commonMistakesCurrentLabelImage).css({
                    'left': scaledX,
                    'top': scaledY,
                });
            }

            // Show the current label screenshot from the GSV.
            const gsvLayerSrc = (function convertCanvasToImage(canvas) {
                return canvas.toDataURL('image/png', 1);
            })($('.widget-scene-canvas')[0]);

            $('img.gsv-layer', $commonMistakesCurrentLabelImage).attr('src', gsvLayerSrc).on('load', function () {
                positionCurrentLabelIcon();
            });

            const iconImagePath = util.misc.getIconImagePaths(labelType).iconImagePath;
            $('.common-mistakes-current-label-icon', $commonMistakesCurrentLabelImage)
                .attr('src', iconImagePath).show();

        }

        $('.common-mistakes-current-label-title .current-label-type', $commonMistakesPopup).text(i18next.t(`common:${util.camelToKebab(labelType)}`));

        // Shows the current label screenshot along with the label.
        showCurrentLabelScreenshot();

        // Show the common mistakes examples for the current label type.
        showExamples(labelType, 'incorrect');

        $commonMistakesPopup.show();
    }

    // Attaches all the UI event handlers. This should be called only once.
    // There should not be any other place where event handlers are attached.
    // Event handlers also take care of logging.
    function attachEventHandlers() {

        function hidePredictionModelPopup() {
            $predictionModelPopupContainer.hide();
        }

        function isCommonMistakesPopupOpenShown() {
            return $commonMistakesPopup.is(':visible');
        }

        // @Mikey, I think this way of attaching multiple event handlers on document is not the best way.
        // But I am following the other modules for now to keep the consistency. - Minchu
        $(document).on('mousedown', (e) => {

            // If the user clicks anywhere outside the popup, hide the popup.
            if (!isCommonMistakesPopupOpenShown() && $(e.target).closest('.prediction-model-popup-container').length === 0) {
                hidePredictionModelPopup();
            }
        });

        $('.prediction-model-mistake-no-button', $predictionModelPopupContainer).on('click', function (e) {
            svlLocal.tracker.push('PMMistakeNo_Click', { 'labelProps': JSON.stringify(currentLabel.getProperties()) }, null);
            hidePredictionModelPopup();
        });

        $('.prediction-model-mistake-yes-button', $predictionModelPopupContainer).on('click', function (e) {
            svlLocal.tracker.push('PMMistakeYes_Click', { 'labelProps': JSON.stringify(currentLabel.getProperties()) }, null);
            svl.labelContainer.removeLabel(currentLabel);
            currentLabel = null;
            hidePredictionModelPopup();
        });

        $('.popup-close-button', $commonMistakesPopup).on('click', function (e) {

            e.preventDefault();
            e.stopPropagation();  // Stop propagation as we don't want to close the popup.

            // I don't think we need to log this. - Minchu.
            $commonMistakesPopup.hide();
        });

        $('.back-to-labeling-button', $commonMistakesPopup).on('click', function (e) {

            e.preventDefault();
            e.stopPropagation(); // Stop propagation as we don't want to close the popup.

            // I don't think we need to log this. - Minchu.
            $commonMistakesPopup.hide();
        });

        $('.prediction-model-view-examples-button').on('click', function (e) {
            svlLocal.tracker.push('PMViewExamplesPopup_Click', { 'labelProps': JSON.stringify(currentLabel.getProperties()) }, null);
            const labelType = currentLabel.getProperties().labelType;
            showCommonMistakesPopup(labelType);
        });

        $('.common-mistakes-button').on('click', function (e) {
            svlLocal.tracker.push('PMViewCommonMistakes_Click', { 'labelProps': JSON.stringify(currentLabel.getProperties()) }, null);
            const labelType = currentLabel.getProperties().labelType;
            showExamples(labelType, 'incorrect');
        });

        $('.correct-examples-button').on('click', function (e) {
            svlLocal.tracker.push('PMViewCorrectExamples_Click', { 'labelProps': JSON.stringify(currentLabel.getProperties()) }, null);
            const labelType = currentLabel.getProperties().labelType;
            showExamples(labelType, 'correct');
        });
    }

    async function loadModel() {
        session = await ort.InferenceSession.create('assets/images/predictionModel.onnx');
    }

    loadModel();
    attachEventHandlers();

    return {
        predictAndShowUI: predictAndShowUI
    };
}();
