/**
 * Prediction Model module. Used to predict if a label is likely correct, showing a training UI to the user if not.
 * @constructor
 */
function PredictionModel() {
    var self = { className: 'PredictionModel' };

    const labelTypesToPredict = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk'];
    const CLUSTERING_THRESHOLDS = {
        'CurbRamp': 0.0035,
        'NoCurbRamp': 0.0035,
        'SurfaceProblem': 0.01,
        'Obstacle': 0.01,
        'NoSidewalk': 0.01,
    }
    const LABEL_TYPE_ONE_HOT = {
        'CurbRamp': [1, 0, 0, 0, 0],
        'NoCurbRamp': [0, 1, 0, 0, 0],
        'NoSidewalk': [0, 0, 1, 0, 0],
        'Obstacle': [0, 0, 0, 1, 0],
        'SurfaceProblem': [0, 0, 0, 0, 1]
    }
    const WAY_TYPE_ONE_HOT = {
        'living_street': [1, 0, 0, 0, 0, 0, 0],
        'primary': [0, 1, 0, 0, 0, 0, 0],
        'residential': [0, 0, 1, 0, 0, 0, 0],
        'secondary': [0, 0, 0, 1, 0, 0, 0],
        'tertiary': [0, 0, 0, 0, 1, 0, 0],
        'trunk': [0, 0, 0, 0, 0, 1, 0],
        'unclassified': [0, 0, 0, 0, 0, 0, 1]
    }

    // Vertical distance between the label and the popup.
    const popupVerticalOffset = 55;

    const $predictionModelPopupContainer = $('.prediction-model-popup-container');
    const $commonMistakesPopup = $('.common-mistakes-popup-container');
    const $commonMistakesCurrentLabelImage = $('.common-mistakes-current-label-image');

    const $gsvLayer = $('.gsv-layer');

    const $panorama = $('.window-streetview');
    const panoWidth = $panorama.width();
    const panoHeight = $panorama.height();

    // Used in prediction.
    let session = null;
    let inputParam = null;
    let outputParam = null;
    let clusters = null;
    let intersections = null;

    // Important variable to track for logging.
    let currLabel = null;
    let uiStartTime = null;
    let currLabelLogs = {
        temporaryLabelId: null,
        severity: null,
        zoom: null,
        hasTags: null,
        hasDescription: null,
        wayType: null,
        closeToCluster: null,
        distanceToIntersection: null,
        distanceToRoad: null,
        predictedCorrect: null,
        prepTime: null,
        predictionTime: null,
        uiTime: null,
        viewedCommonMistakes: null,
        viewedCorrectExamples: null,
    }

    const predictionModelExamplesDescriptor  = {
        'CurbRamp': {
            'subtitle': 'Tip: The #1 curb ramp mistake is labeling <b>driveways</b> as curb ramps.',
            'correct-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Correct_CurbRamp_1.png',
                    'description': 'This is a good <b>curb ramp</b>. it’s wide, has a yellow tactile warning, and is not too steep.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_CurbRamp_2.png',
                    'description': 'This is an OK <b>curb ramp</b>. It’s missing a tactile warning strip and is angled into the street.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_CurbRamp_3.png',
                    'description': 'Label flat <b>curb ramps</b> with tactile warning strips.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_CurbRamp_4.png',
                    'description': 'Some corners have very wide <b>curb ramps</b> to support travel in both directions.'
                },
            ],
            'incorrect-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Mistake_CurbRamp_1.png',
                    'description': '<b>Driveways</b>. Driveways are <b>not</b> curb ramps. They are designed for vehicles and not pedestrians.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_CurbRamp_2.png',
                    'description': '<b>Curb Missing</b>. When a curb ramp is missing, use the Missing Curb Ramp label instead.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_CurbRamp_3.png',
                    'description': '<b>Not on pedestrian route</b>. Curb ramps are not needed at paths not intended for pedestrians.'
                },
            ],
        },
        'NoCurbRamp': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoCurbRamp_1.png',
                    'description': 'This marked crossing area is missing </b>two curb ramps</b>—one on each side.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoCurbRamp_2.png',
                    'description': 'This corner is </b>missing two curb ramps</b>–one for each direction to cross the street.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoCurbRamp_3.png',
                    'description': 'This </b>missing curb ramp</b> impacts this family’s ability to cross the street.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoCurbRamp_4.png',
                    'description': 'Any sidewalk to street transition should have curb ramps. This corner is </b>missing two</b>.'
                },
            ],
            'incorrect-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Mistake_NoCurbRamp_1.png',
                    'description': '<b>Curb ramp exists</b>. Do not label Missing Curb Ramps when curb ramps exist.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_NoCurbRamp_2.png',
                    'description': '<b>House-to-curb</b>. Residential walkways should <b>not</b> be labeled as Missing Curb Ramps.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_NoCurbRamp_3.png',
                    'description': '<b>Missing Sidewalk</b>. For corners with <b>no sidewalks</b>, use the No Sidewalk label.'
                },
            ],
        },
        'Obstacle': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Correct_Obstacle_1.png',
                    'description': 'This <b>pole</b> and <b>narrow sidewalk</b> create an impassable barrier for wheelchair users.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_Obstacle_2.png',
                    'description': 'This <b>severe vegetation overgrowth</b> impedes the sidewalk and is an obstacle.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_Obstacle_3.png',
                    'description': 'When a <b>bicycle</b> is parked in the sidewalk and there is <b>no room to pass</b>, it is an obstacle.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_Obstacle_4.png',
                    'description': 'These <b>trash</b> and <b>recycling bins</b> are blocking the sidewalk, creating impassable barriers.'
                },
            ],
            'incorrect-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Mistake_Obstacle_1.png',
                    'description': '<b>Space to avoid</b>. There is ample space for pedestrians on the remaining space of the sidewalk.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_Obstacle_2.png',
                    'description': '<b>Not on pedestrian route</b>. Only mark obstacles on pedestrian pathways.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_Obstacle_3.png',
                    'description': '<b>Not an obstacle</b>. Do not mark moving cars or people as obstacles.'
                },
            ],
        },
        'SurfaceProblem': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Correct_SurfaceProblem_1.png',
                    'description': '<b>Sidewalk uplifts</b> create tripping hazards and mobility barriers for wheelchairs.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_SurfaceProblem_2.png',
                    'description': '<b>Cobblestone pathways</b> create harmful vibrations for wheelchair users.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_SurfaceProblem_3.png',
                    'description': 'Grass and vegetation overgrowth on the sidewalk are <b>surface problems</b>.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_SurfaceProblem_4.png',
                    'description': 'This sidewalk has severe cracking and cross-slants that are <b>surface problems</b>.'
                },
            ],
            'incorrect-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Mistake_SurfaceProblem_1.png',
                    'description': '<b>Not on pedestrian route</b>. Only mark surface problems on pedestrian pathways.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_SurfaceProblem_2.png',
                    'description': '<b>Normal sidewalk tiling</b>. Sidewalk tiles without gaps, cracks or bumps are not surface problems.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_SurfaceProblem_3.png',
                    'description': '<b>Wrong Label Type</b>. Do not mark obstacles (e.g. construction sites) as surface problems.'
                },
            ],
        },
        'NoSidewalk': {
            'subtitle': '48% of curb ramps are missed by users.',
            'correct-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoSidewalk_1.png',
                    'description': 'A dirt path beside the road is a <b>missing sidewalk</b>.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoSidewalk_2.png',
                    'description': 'Many suburban streets are <b>missing sidewalks</b> on both sides of the street.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoSidewalk_3.png',
                    'description': ' A dirt path beside the road is not a replacement for a sidewalk.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Correct_NoSidewalk_4.png',
                    'description': 'This street is <b>missing sidewalks</b> on both sides of the street.'
                },
            ],
            'incorrect-examples': [
                {
                    'image': 'assets/images/tutorials/PM_Mistake_NoSidewalk_1.png',
                    'description': '<b>Sidewalk exists</b>. There is a sidewalk here. It should <b>not</b> be marked as Missing Sidewalk.'
                },
                {
                    'image': 'assets/images/tutorials/PM_Mistake_NoSidewalk_2.png',
                    'description': '<b>Wrong label type</b>. This should be marked as a Missing Curb Ramp instead of Missing Sidewalk.'
                },
            ],
        }
    };

    function _prepDataForPrediction(data) {
        // Check if the label is close to a cluster, and get the distance to the nearest street & intersection.
        let turfPoint = turf.point([data.lng, data.lat]);
        data.closeToCluster = isCloseToCluster(turfPoint, data.labelType);
        data.distanceToIntersection = util.math.kilometersToFeet(distanceToNearestIntersection(turfPoint));

        var closestStreet = distanceToNearestStreetWithWayType(turfPoint);
        data.distanceToRoad = util.math.kilometersToFeet(closestStreet[0]);
        data.wayType = closestStreet[1].getProperty('wayType');
        console.log(data);

        // Record data specifically for logging.
        currLabelLogs.closeToCluster = data.closeToCluster;
        currLabelLogs.distanceToIntersection = data.distanceToIntersection;
        currLabelLogs.distanceToRoad = data.distanceToRoad;
        currLabelLogs.wayType = data.wayType;
        currLabelLogs.temporaryLabelId = data.temporaryLabelId;
        currLabelLogs.zoom = data.zoom;
        currLabelLogs.severity = data.severity;
        currLabelLogs.hasTags = data.hasTags;
        currLabelLogs.hasDescription = data.hasDescription;

        return data;
    }

    async function predict(data) {
        // Use an async context to call onnxruntime functions.
        try {

            // Prepare inputs. A tensor need its corresponding TypedArray as data.
            var input = [data.severity, data.zoom, data.closeToCluster, data.distanceToRoad, data.distanceToIntersection, data.hasTags, data.hasDescription];
            input = input.concat(LABEL_TYPE_ONE_HOT[data.labelType]);
            input = input.concat(WAY_TYPE_ONE_HOT[data.wayType]);

            const dataA = Float32Array.from(data = input);
            const tensorA = new ort.Tensor('float32', dataA, [1, input.length]);

            // Prepare feeds. use model input names as keys.
            const feeds = { };
            feeds[inputParam] = tensorA;

            // Feed inputs and run.
            const results = await session.run(feeds, [outputParam]);

            // Output from results.
            return results.output_label.data[0];
        } catch (e) {
            alert(`failed to inference ONNX model: ${e}.`);
        }
    }

    // We may not support prediction for all label types. Hence this check.
    function isPredictionSupported(labelType) {
        // Simple logic to see if support a label type--if it is defined in the descriptor.
        return predictionModelExamplesDescriptor[labelType] !== undefined;
    }

    // Check if the label is close to a cluster.
    function isCloseToCluster (turfPoint, labelType) {
        if (clusters[labelType].features.length > 0) {
            var closest = turf.nearestPoint(turfPoint, clusters[labelType]);
            return closest.properties.distanceToPoint < CLUSTERING_THRESHOLDS[labelType];
        } else {
            return false;
        }
    }

    // Get the distance from the label to the nearest intersection.
    function distanceToNearestIntersection(turfPoint) {
        var closest = turf.nearestPoint(turfPoint, intersections);
        return closest.properties.distanceToPoint;
    }

    // Get the distance from the label to the nearest street.
    function distanceToNearestStreetWithWayType(turfPoint) {
        let streets = svl.taskContainer.getTasks();
        let closestStreet = streets[0];
        let closestDistance = turf.pointToLineDistance(turfPoint, closestStreet.getGeoJSON().features[0]);
        svl.taskContainer.getTasks().forEach(function (street, i) {
            let distance = turf.pointToLineDistance(turfPoint, street.getGeoJSON().features[0]);
            if (distance < closestDistance) {
                closestStreet = street;
                closestDistance = distance;
            }
        });
        return [closestDistance, closestStreet];
    }

    // Calls the predict function and depending on the result, shows the popup UI.
    function predictAndShowUI (data, label, svl) {
        disableInteractionsForPredictionModelPopup();

        // If prediction is not supported for the label type, return.
        // @Mikey, please check if this is correct.
        if (!isPredictionSupported(label.getProperties().labelType)) {
            return;
        }

        if (session === null || clusters === null || intersections === null) {
            alert('Please load a model first.');
            // Maybe we should log this.
        }

        const prepStartTime = new Date().getTime();
        data = _prepDataForPrediction(data);
        svl.tracker.push('PM_DataPrepped', currLabelLogs, null);

        const predictionStartTime = new Date().getTime();
        const predictedScore = predict(data);

        predictedScore.then((score) => {
            const predictionEndTime = new Date().getTime();
            console.log(score);

            currLabelLogs.predictedCorrect = score === 1n;
            currLabelLogs.prepTime = predictionStartTime - prepStartTime;
            currLabelLogs.predictionTime = predictionEndTime - predictionStartTime;
            console.log(`Prep time: ${currLabelLogs.prepTime} ms`);
            console.log(`Inference time: ${currLabelLogs.predictionTime} ms`);
            svl.tracker.push('PM_PredictionComplete', currLabelLogs, null);

            // Score can only be 0 or 1; 1 means label predicted to be correct, 0 means label predicted to be incorrect.
            currLabel = label;
            if (score === 1n) {
                _logPredictionData();
                enableInteractionsForPredictionModelPopup();
            } else {
                currLabelLogs.viewedCommonMistakes = false;
                currLabelLogs.viewedCorrectExamples = false;

                const labelProps = currLabel.getProperties();

                $('.label-type', $predictionModelPopupContainer).text(i18next.t(`common:${util.camelToKebab(labelProps.labelType)}`));
                $('.prediction-model-popup-text', $predictionModelPopupContainer).html(predictionModelExamplesDescriptor[labelProps.labelType].subtitle); // this could contain HTML.

                $predictionModelPopupContainer.show();
                uiStartTime = new Date().getTime();

                const popupHeight = $predictionModelPopupContainer.height();

                const left = labelProps.currCanvasXY.x - 24;
                const top = labelProps.currCanvasXY.y - popupHeight - popupVerticalOffset;
                $predictionModelPopupContainer.css({left: left, top: top});

            }
        });
    }

    function showExamples(labelType, correctOrIncorrect) {

        function renderExamples(examples) {

            $('.example-unit-container:not(.template)', $commonMistakesPopup).remove();

            for (let i = 0; i < examples.length; i++) {

                const $exampleUnit = $('.example-unit-container.template').clone().removeClass('template');

                const example = examples[i];
                $('img', $exampleUnit).attr('src', example.image);
                $('.example-unit-description', $exampleUnit).html(example.description);

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
                const currLabelProps = currLabel.getProperties();
                const labelCanvasXY = currLabelProps.currCanvasXY;
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

    function disableInteractionsForPredictionModelPopup() {
        svl.map.disablePanning();
        svl.map.disableWalking();
        svl.ribbon.disableModeSwitch();
        svl.zoomControl.disableZoomIn();
        svl.zoomControl.disableZoomOut();
    }

    function enableInteractionsForPredictionModelPopup() {
        svl.map.enablePanning();
        svl.map.enableWalking();
        svl.ribbon.enableModeSwitch();
        svl.zoomControl.enableZoomIn();
        svl.zoomControl.enableZoomOut();
    }

    function hidePredictionModelPopup() {
        $predictionModelPopupContainer.hide();
    }

    // Attaches all the UI event handlers. This should be called only once.
    // There should not be any other place where event handlers are attached.
    // Event handlers also take care of logging.
    function attachEventHandlers() {
        function isCommonMistakesPopupOpenShown() {
            return $commonMistakesPopup.is(':visible');
        }

        $('.prediction-model-mistake-keep-label-button', $predictionModelPopupContainer).on('click', function (e) {
            svl.tracker.push('PM_MistakeKeep_Click', currLabelLogs, null);
            _logPredictionData();
            hidePredictionModelPopup();
            enableInteractionsForPredictionModelPopup();
        });

        $('.prediction-model-mistake-remove-label-button', $predictionModelPopupContainer).on('click', function (e) {
            svl.tracker.push('PM_MistakeRemove_Click', currLabelLogs, null);
            svl.labelContainer.removeLabel(currLabel);
            _logPredictionData();
            hidePredictionModelPopup();
            enableInteractionsForPredictionModelPopup();
        });

        $('.popup-close-button', $commonMistakesPopup).on('click', function (e) {

            e.preventDefault();
            e.stopPropagation();  // Stop propagation as we don't want to close the popup.
            svl.tracker.push('PM_BackToLabelingX_Click', currLabelLogs, null);
            $predictionModelPopupContainer.show();
            $commonMistakesPopup.hide();
        });

        $('.back-to-labeling-button', $commonMistakesPopup).on('click', function (e) {

            e.preventDefault();
            e.stopPropagation(); // Stop propagation as we don't want to close the popup.
            svl.tracker.push('PM_BackToLabelingButton_Click', currLabelLogs, null);
            $predictionModelPopupContainer.show();
            $commonMistakesPopup.hide();
        });

        $('.prediction-model-view-examples-button').on('click', function (e) {
            currLabelLogs.viewedCommonMistakes = true;
            svl.tracker.push('PM_ViewExamplesPopup_Click', currLabelLogs, null);
            const labelType = currLabel.getProperties().labelType;
            showCommonMistakesPopup(labelType);
            hidePredictionModelPopup();
        });

        $('.common-mistakes-button').on('click', function (e) {
            currLabelLogs.viewedCommonMistakes = true;
            svl.tracker.push('PM_ViewCommonMistakes_Click', currLabelLogs, null);
            const labelType = currLabel.getProperties().labelType;
            showExamples(labelType, 'incorrect');
        });

        $('.correct-examples-button').on('click', function (e) {
            currLabelLogs.viewedCorrectExamples = true;
            svl.tracker.push('PM_ViewCorrectExamples_Click', currLabelLogs, null);
            const labelType = currLabel.getProperties().labelType;
            showExamples(labelType, 'correct');
        });
    }

    // Log all the data we've collected for the current label. Only called once user has finished with the UI.
    function _logPredictionData() {
        // Record the time spent in the UI, since we only log this data once the UI is closed.
        if (uiStartTime !== null) {
            const uiEndTime = new Date().getTime();
            currLabelLogs.uiTime = uiEndTime - uiStartTime;
            console.log(`Time spent in UI: ${currLabelLogs.uiTime} ms`);
        }

        // Record everything we care about in this one log for convenience.
        svl.tracker.push('PM_FullPredictionLog', currLabelLogs, null);

        // Reset the logs for the next label.
        currLabel = null;
        uiStartTime = null;
        for (let key in currLabelLogs) {
            currLabelLogs[key] = null;
        }
    }

    // Load the ONNX model for the appropriate city.
    async function loadModel(city) {
        session = await ort.InferenceSession.create(`assets/images/${city}_Prediction_MLP.onnx`);
        inputParam = session.inputNames[0];
        outputParam = session.outputNames[0];
    }

    // Load the cluster data for the appropriate city.
    async function loadClusters(city) {
        // Read cluster data from geojson file and split the clusters based on label type.
        const response = await fetch(`assets/images/user-study-${city}-cluster-centroids.json`);
        const data = await response.json();
        clusters = {};
        for (let labType of labelTypesToPredict) {
            clusters[labType] = { 'type': 'FeatureCollection', 'features': [] };
        }

        // Sort the clusters into separate arrays for each label type.
        for (let cluster of data.features) {
            let labType = cluster.properties.label_type;
            clusters[labType].features.push(cluster);
        }
    }

    // Load the intersection data for the appropriate city.
    async function loadIntersections(city) {
        // Read intersection data from geojson file.
        const response = await fetch(`assets/images/user-study-${city}-intersections_on_routes.json`);
        intersections = await response.json();
    }

    // Asynchronously load the model and necessary data for the appropriate city. We know that in our crowdstudy server,
    // the first 91 regions are from Seattle and the rest are from Oradell.
    let city = svl.regionId < 92 ? 'seattle' : 'oradell';
    loadModel(city);
    loadClusters(city);
    loadIntersections(city);
    attachEventHandlers();


    self.labelTypesToPredict = labelTypesToPredict;
    self.hidePredictionModelPopup = hidePredictionModelPopup;
    self.enableInteractionsForPredictionModelPopup = enableInteractionsForPredictionModelPopup;
    self.predictAndShowUI = predictAndShowUI;

    return self;
}
