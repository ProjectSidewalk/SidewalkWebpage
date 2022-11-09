$(function() {

    const tutorialDescriptor = {
        'CurbRamp': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 Curb Ramp Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'Curb Ramp',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'Curb ramps are often found on both ends of crosswalks, ' +
                        'or when a sidewalk continue on the other side of the street, even without crosswalk.',
                    'imageURL': 'assets/images/tutorials/curbramp-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Driveway',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Driveways are <b>not</b> curb ramps. They are designed for' +
                        ' vehicles and not pedestrians. Driveways should <b>not</b> be labeled as Curb Ramp.',
                    'imageURL': 'assets/images/tutorials/curbramp-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Garage',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Driveways to garages are <b>not</b> curb ramps.' +
                        ' Driveways should <b>not</b> be labeled as Curb Ramp.',
                    'imageURL': 'assets/images/tutorials/curbramp-incorrect-2.png'
                }
            ]
        },
        'NoCurbRamp': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 Missing Curb Ramp Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'Missing Curb Ramp',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'Sidewalk intersections should have curb ramps—ideally two per corner. ' +
                        'If a corner has a sidewalk but does not have a curb ramp, place the Missing Curb Ramp label ' +
                        'where you think a curb ramp should exist.',
                    'imageURL': 'assets/images/tutorials/no-curbramp-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Residential walkways',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Residential walkways should <b>not</b> be labeled as Missing Curb Ramps.',
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Not on pedestrian path',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Curb ramps are not needed at paths <b>not</b> intended for ' +
                        'pedestrians to pass.',
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-2.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Missing sidewalk',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'For corners with <b>no sidewalks</b>, use' +
                        ' the No Sidewalk label rather than a Missing Curb Ramp label. ',
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-3.png'
                }
            ]
        },
        'Obstacle': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 Obstacle Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'Obstacle',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'Obstacles are barriers that impede <b>pedestrian' +
                        ' pathways</b> for people using wheelchairs, walkers, or other mobility aids.' +
                        ' Not all fire hydrants, poles, and signs are obstacles—only those that clearly' +
                        ' obstruct pedestrian paths.',
                    'imageURL': 'assets/images/tutorials/obstacle-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Ample space to maneuver around',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'The motorcycle is parked on the side' +
                        ' - there is ample space for pedestrians on the remaining space of the sidewalk.',
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Obstacle not on sidewalk',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'This traffic cone is not on a pedestrian pathway so it' +
                        ' should not be marked as an Obstacle.<br><br> Only mark obstacles on sidewalks, crosswalks,' +
                        ' and other pedestrian pathways.',
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-2.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Moving object',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'The car seems to be moving in the image' +
                        ' and should not be labelled as an Obstacle.',
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-3.png'
                }
            ]
        },
        'SurfaceProblem': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 Surface Problem Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'Surface Problem',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'If something on the sidewalk or crosswalk' +
                        ' surface  would make it <b>uncomfortable or impossible to cross,</b>' +
                        ' it should be labeled as a Surface Problem.',
                    'imageURL': 'assets/images/tutorials/surface-problem-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Normal sidewalk tiles',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Normal sidewalk tiles (without gaps, cracks or bumps)' +
                        ' are not surface problems.',
                    'imageURL': 'assets/images/tutorials/surface-problem-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Not on pedestrian path',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'This gravel is <b>not</b> on a pedestrian pathway so it' +
                        ' should not be marked as an Surface Problem.<br><br>Only mark surface problems' +
                        ' on sidewalks, crosswalks, and other pedestrian pathways.',
                    'imageURL': 'assets/images/tutorials/surface-problem-incorrect-2.png'
                }
            ]
        },
        'NoSideWalk': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 No Sidewalk Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'No Sidewalk',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'If a street side does not have a sidewalk, please' +
                        ' mark it with a <b>No Sidewalk</b> label.',
                    'imageURL': 'assets/images/tutorials/no-sidewalk-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Median',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'A median that separates two directions of a traffic' +
                        ' and is not intended for pedestirans should <b>not</b> be labeled as No Sidewalk.',
                    'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Pavement',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'There is a sidewalk here. It should <b>not</b> be marked as No Sidewalk.',
                    'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-2.png'
                }
            ]
        },
        'Crosswalk': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 Crosswalk Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'Crosswalk',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'A crosswalk is a legally defined space to cross a road.<br><br>' +
                        ' Crosswalks are often indicated by <b>zebra crossing or perpendicular dashed lines.</b>',
                    'imageURL': 'assets/images/tutorials/crosswalk-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'No visual indicator',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Crossings with no visual indicator should <b>not</b> be labeled as' +
                        ' Crosswalks.',
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Stop line',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Stop lines should not be labeled as Crosswalks.',
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-2.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Speed bump',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'Speed bumps should not be labeled as Crosswalks. ',
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-3.png'
                }
            ]
        },
        'Signal': {
            'missionInstruction1': 'YOUR MISSION',
            'missionInstruction2': 'Validate 10 Pedestrian Signal Labels',
            'slides': [
                {
                    'exampleType': 'correct',
                    'exampleTypeLabel': 'CORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-positive',
                    'labelTypeTitle': 'Pedestrian Signal',
                    'labelTypeSubtitle': '',
                    'labelTypeDescription': 'A pedestrian signal indicates when pedestrians can cross the street and' +
                        ' provides time for them to do so safely.<br><br> Some pedestrian signals are activated by a' +
                        ' pedestrian push button at waist height.',
                    'imageURL': 'assets/images/tutorials/signal-correct-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Signage',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'This sign does not indicate when pedestrians can cross the street.',
                    'imageURL': 'assets/images/tutorials/signal-incorrect-1.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Pole',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'This pole does not show traffic signals to pedestrians.',
                    'imageURL': 'assets/images/tutorials/signal-incorrect-2.png'
                },
                {
                    'exampleType': 'incorrect',
                    'exampleTypeLabel': 'INCORRECT EXAMPLE',
                    'exampleTypeIcon': '#smile-negative',
                    'labelTypeTitle': 'Traffic light for vehicles',
                    'labelTypeSubtitle': 'Why is this wrong?',
                    'labelTypeDescription': 'This traffic light is only for vehicles, not for pedestrians.',
                    'imageURL': 'assets/images/tutorials/signal-incorrect-3.png'
                }
            ]
        }
    };

    const EXAMPLE_TYPES = {
        CORRECT: 'correct',
        INCORRECT: 'incorrect'
    };

    console.log(param.labelList[0].getAuditProperty('labelType'));

    const LabelType = param.labelList[0].getAuditProperty('labelType'); // should come as an argument

    let currentSlideIdx = 0;
    let nSlides = 2;

    // console.log(tutorialDescriptor);
    let module = {};

    // Renders the initial mission screen and initializes the slide deck
    function initModule(LabelType) {

        if (!tutorialDescriptor[LabelType]) {
            // Log here
            console.log('Unknown labelType: ' + LabelType);
        }

        module = tutorialDescriptor[LabelType];
        nSlides = module.slides.length;
    }

    function initUI() {

        function renderLocationIndicators() {
            const $missionCarouselIndicatorArea = $('.mission-carousel-location-indicator-area');
            for (let i = 0; i < nSlides; i++) {
                const $indicator = $('.mission-carousel-location-indicator.template').clone().removeClass('template');
                $indicator.attr('data-idx', i);
                $missionCarouselIndicatorArea.append($indicator);
            }
        }

        $('.mission-instruction-1').text(module.missionInstruction1);
        $('.mission-instruction-2').text(module.missionInstruction2);

        renderLocationIndicators();
        renderSlide(currentSlideIdx);
    }

    function renderSlide(idx) {
        // {
        //     'exampleType': 'correct',
        //     'exampleTypeLabel': 'CORRECT EXAMPLE',
        //     'exampleTypeIcon': '#smile-positive',
        //     'labelTypeTitle': 'Curb Ramp',
        //     'labelTypeDescription': 'Curb ramps are often found on both ends of crosswalks, ' +
        // 'or when a sidewalk continue on the other side of the street, even without crosswalk.'
        // }

        const $missionTutorialSlide = $('.mission-tutorial-slide');
        const $labelTypeSubtitle = $('.label-type-subtitle');
        const $mtsImage = $('.mts-image');

        // Reset the UI first.
        $('.mission-carousel-location-indicator').removeClass('current-location');
        $missionTutorialSlide.removeClass(EXAMPLE_TYPES.CORRECT).removeClass(EXAMPLE_TYPES.INCORRECT);
        $mtsImage.attr('src', '');
        $labelTypeSubtitle.text('');
        $('.previous-slide-button, .next-slide-button').removeClass('disabled');

        const slide = module.slides[idx];

        // Adds class for both correct and incorrect examples. Note: the class names should be
        // exactly the same in the descriptor and CSS.
        $missionTutorialSlide.addClass(slide.exampleType);

        $('.example-type-label').text(slide.exampleTypeLabel);
        $('.example-type-icon').find('use').attr('xlink:href', slide.exampleTypeIcon);

        $('.label-type-title').html(slide.labelTypeTitle);
        $('.label-type-description').html(slide.labelTypeDescription);

        if (slide.labelTypeSubtitle) {
            $labelTypeSubtitle.html(slide.labelTypeSubtitle);
        }

        $mtsImage.attr('src', slide.imageURL);

        $(`.mission-carousel-location-indicator[data-idx=${idx}]`).addClass('current-location');

        // Disable the previous/next buttons based on the current slide idx
        if (idx === 0) {
            $('.previous-slide-button').addClass('disabled');
        } else if (idx === nSlides - 1) {
            $('.next-slide-button').addClass('disabled');
        }
    }

    function attachEventHandlers() {
        $('.previous-slide-button').click(function() {
            currentSlideIdx = Math.max(currentSlideIdx - 1, 0);
            renderSlide(currentSlideIdx);

        });

        $('.next-slide-button').click(function() {
            currentSlideIdx = Math.min(currentSlideIdx + 1, nSlides - 1);
            renderSlide(currentSlideIdx);
        });

        $('.mission-tutorial-done-btn').click(function() {
            $('.mission-tutorial-overlay').fadeOut(100);
        });
    }

    initModule(LabelType);
    initUI();
    attachEventHandlers();
});
