$(function() {

    let inferenceStartTime = 0;
    let inferenceEndTime = 0;
    let isMouseDown = false;
    let DEBUG_MODE = false;

    const $panoramaContainer = $('#svv-panorama-holder'); // This element is included in the HTML and should be available from the start.

    const IMAGE_SIZE = 640; // This is the size of the image used for training and inference.

    const panoWidth = $panoramaContainer.width();
    const panoHeight = $panoramaContainer.height();

    let GSVScaleX = panoWidth/IMAGE_SIZE;
    let GSVScaleY = panoHeight/IMAGE_SIZE;


    // GSV size may potentially change. So we need to update the scale factor.
    // IMAGE_SIZE is the image size used for training and inference.
    function calculateGSVScale() {
        GSVScaleX = $panoramaContainer.width()/IMAGE_SIZE;
        GSVScaleY = $panoramaContainer.height()/IMAGE_SIZE;
    }

    function analyzeImageAndShowSuggestions(boundingBoxes) {

        // console.log(boundingBoxes);

        renderBoundingBoxes(boundingBoxes); // Draw boundingBoxes

        CVStats.totalInferenceTime += (inferenceEndTime - inferenceStartTime);
        CVStats.totalInferenceCount += 1;
    }

    function getBoundingBoxesFromLabels(labels, labelMap) {
        const boundingBoxes = [];

        for (let i = 0; i < labels.length; i++) {

            const labelStr = labels[i];
            const labelParts = labelStr.split(' ');

            let labelName;

            // labelMap is optional. If it is not provided, we will use the label as is.
            if (labelMap) {
                const idx = parseInt(labelParts[0]);
                if (idx < labelMap.length) {
                    labelName = labelMap[parseInt(labelParts[0])];
                } else {
                    labelName = labelParts[0];
                }
            } else {
                labelName = labelParts[0];
            }

            const x = parseFloat(labelParts[1]);
            const y = parseFloat(labelParts[2]);
            const w = parseFloat(labelParts[3]);
            const h = parseFloat(labelParts[4]);

            const score = parseFloat(labelParts[5]);

            boundingBoxes.push({
                label: labelName,
                probability: score,
                bounding: [x, y, w, h], // upscale box
            });
        }

        return boundingBoxes;
    }


    function setupEventHandlers() {

    }

    // Renders the bounding boxes around objects.
    // Handles scaling to match the panorama size.
    function renderBoundingBoxes(predictedBoundingBoxes) {

        function removeFocusOnLabel() {
            $('.object-boundary').removeClass('unfocused');
        }

        // We are going to re-render all the boxes. So, let's remove all the existing ones.
        $('.object-boundary:not(.template)').remove();

        // Go through all the boxes and render them.
        for (let i = 0; i < predictedBoundingBoxes.length; i++) {
            const box = predictedBoundingBoxes[i];
            const [x, y, w, h] = box.bounding;
            const label = box.label;
            const probability = box.probability.toFixed(2); // We are interested in only 2 decimal places.

            const scaledW = w * panoWidth;
            const scaledH = h * panoHeight;
            const scaledX = (x * panoWidth) - (scaledW/2);
            const scaledY = (y * panoHeight) - (scaledH/2);

            const $objectBoundary = $('.object-boundary.template').clone().removeClass('template').addClass('object-boundary-' + label);

            $objectBoundary.css({
                left: scaledX,
                top: scaledY,
                width: scaledW,
                height: scaledH
            });

            // Showing the confidence level as a tooltip.
            const formattedProbablity = Math.round(probability * 100) + '%';
            $objectBoundary.attr('title', 'Confidence: ' + formattedProbablity);

            $panoramaContainer.append($objectBoundary);

            $('.object-boundary-label-text', $objectBoundary).text(label);

            // If the bounding box is too close to the top edge of the screen, the label will be off the screen. So, we need to move it down.
            if ($('.object-boundary-label', $objectBoundary).offset().top < 0) {
                $('.object-boundary-label', $objectBoundary).css('top', '10px');
            }


            // // Restore the state if it is an existing marker.
            // if (existingMarker) {
            //     if (existingMarker.verificationState === HUMAN_VERIFICATION_STATE.VERIFIED_CORRECT) {
            //         $objectBoundary.addClass('confirmed');
            //     } else if (existingMarker.verificationState === HUMAN_VERIFICATION_STATE.VERIFIED_INCORRECT) {
            //         $objectBoundary.addClass('denied');
            //     }
            //
            //     // Since a marker with this ID already exists, we should remove it before placing a new one with the same id.
            //     // Note: this function will return null if the marker was not found.
            //     existingMarker = removeMarkerIfExists(existingMarker.id);
            // }

            // Place a dummy label in the center of the box. We will use this to determine if the user has already verified this object.
            // const marker = placeMarker(existingMarker ? existingMarker.id : null, centerX, centerY, LABEL_TYPES[label], existingMarker ? existingMarker.verificationState : HUMAN_VERIFICATION_STATE.NOT_VERIFIED, false, probability, 'cv-suggested');
            // $objectBoundary.attr('data-id', marker.id);
            //
            // // These fields should not be updated at any point.
            // marker.originalBoundingBox = [scaledX, scaledY, scaledW, scaledH];
            // marker.originalPitch = panorama.getPov().pitch;
            // marker.originalHeading = panorama.getPov().heading;


            // When the user hovers on a label we want all the other labels to be unfocused.
            // Note: the event handler needs to be added here as the $objectBoundary is not available until it is rendered and will be removed and re-rendered on the fly.
            $objectBoundary.on('mouseenter', function(e) {
                $objectBoundary.siblings().addClass('unfocused');
            }).on('mouseleave', function(e) {
                removeFocusOnLabel();
            });

        }
    }


    function main() {

        setupEventHandlers();
        calculateGSVScale();

        const modelLoad = loadModels();
        modelLoad.then(function () {
            console.log('Model loaded successfully.');
        });

        // Simulating a click right upon loading as we want to show the labeling interface by default.
        $('.show-labels-toolbar').click();
    }


    window.fetchCVResultsAndShow = function (labelId) {

        function showCVResults(data) {
            data = atob(data);
            data = JSON.parse(data);
            console.log(data);

            for (let i = 0; i < data.inferences.length; i++) {

                const boundingBoxes = getBoundingBoxesFromLabels(data.inferences[i].labels, data.inferences[i].labelMap);
                renderBoundingBoxes(boundingBoxes);

            }

        }

        $.ajax({
            type: 'GET',
            url: 'cvResults',
            data: `labelId=${labelId}`,
            success: function(data){
                showCVResults(data);
            }
        });
    };

    // main();
});
