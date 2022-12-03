


function MissionStartTutorial(missionType, labelType, tracker) {
    let self = this;

    const EXAMPLE_TYPES = {
        CORRECT: 'correct',
        INCORRECT: 'incorrect'
    };

    const MISSION_TYPES = {
        VALIDATE: 'validate'
    };

    // Map of exampleType to ID of the smiley icon to be used.
    const SMILEYS = {};
    SMILEYS[EXAMPLE_TYPES.CORRECT] = '#smile-positive';
    SMILEYS[EXAMPLE_TYPES.INCORRECT] = '#smile-negative';

    /**
     * Provides structure for a slide based tutorial framework.
     *
     * This object contains the following:
     *     - missionInstruction1: Text to be shown at the very top, above the slides area.
     *     - missionInstruction2: Text to be shown below missionInstruction1, above the slides area.
     *     - slides: An array of 'slides'.
     *
     *     Each 'slide' contains the following:
     *         - isExampleCorrect: boolean, indicating whether the example type is correct or incorrect.
     *         - slideTitle: string, title for the slide.
     *         - slideSubtitle: string, subtitle for the slide.
     *         - slideDescription: string, long form text description for the slide.
     *         - imageURL: string, URL to the image to be shown.
     *         - labelOnImage: object, containing the following:
     *             - position: object, containing 'top' and 'left' attributes for the on-image label.
     *                         The 'top' and 'left' must be defined with respect to the top and left
     *                         of the 'image element.'
     */
    const validateMSTDescriptor = {
        'CurbRamp': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.curb-ramp.instruction',
                {'labelType': i18next.t('curb-ramp-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.curb-ramp.slide-1.title',
                        {'labelType': i18next.t('curb-ramp-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.curb-ramp.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/curbramp-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '238px',
                            'top': '222px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.curb-ramp.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.curb-ramp.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/curbramp-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '466px',
                            'top': '257px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.curb-ramp.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.curb-ramp.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/curbramp-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '435px',
                            'top': '257px'
                        }
                    }
                }
            ]
        },
        'NoCurbRamp': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.no-curb-ramp.instruction',
                {'labelType': i18next.t('missing-curb-ramp-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-1.title',
                        {'labelType': i18next.t('missing-curb-ramp-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '393px',
                            'top': '157px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '325px',
                            'top': '250px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '397px',
                            'top': '320px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '326px',
                            'top': '302px'
                        }
                    }
                }
            ]
        },
        'Obstacle': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.obstacle.instruction',
                {'labelType': i18next.t('obstacle-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-1.title',
                        {'labelType': i18next.t('obstacle-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '269px',
                            'top': '301px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '397px',
                            'top': '286px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '79.5px',
                            'top': '112px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '415px',
                            'top': '187px'
                        }
                    }
                }
            ]
        },
        'SurfaceProblem': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.surface-problem.instruction',
                {'labelType': i18next.t('surface-problem-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.surface-problem.slide-1.title',
                        {'labelType': i18next.t('surface-problem-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.surface-problem.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/surface-problem-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '458px',
                            'top': '203px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.surface-problem.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.surface-problem.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/surface-problem-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '400px',
                            'top': '190px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.surface-problem.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.surface-problem.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/surface-problem-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '334px',
                            'top': '221px'
                        }
                    }
                }
            ]
        },
        'NoSideWalk': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.no-sidewalk.instruction',
                {'labelType': i18next.t('no-sidewalk-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.no-sidewalk.slide-1.title',
                        {'labelType': i18next.t('no-sidewalk-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.no-sidewalk.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/no-sidewalk-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '290px',
                            'top': '132px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-sidewalk.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-sidewalk.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '352px',
                            'top': '312px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-sidewalk.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-sidewalk.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '185px',
                            'top': '299px'
                        }
                    }
                }
            ]
        },
        'Crosswalk': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.crosswalk.instruction',
                {'labelType': i18next.t('crosswalk-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-1.title',
                        {'labelType': i18next.t('crosswalk-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '175px',
                            'top': '159px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '354px',
                            'top': '241px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '249px',
                            'top': '302px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '271px',
                            'top': '102px'
                        }
                    }
                }
            ]
        },
        'Signal': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.signal.instruction',
                {'labelType': i18next.t('signal-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-1.title',
                        {'labelType': i18next.t('signal-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/signal-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '167px',
                            'top': '325px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/signal-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '377px',
                            'top': '86px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/signal-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '390px',
                            'top': '203px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/signal-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '359px',
                            'top': '332px'
                        }
                    }
                }
            ]
        }
    };

    // Initialize variables.
    let currentSlideIdx = 0;
    let nSlides = 0;
    let labelTypeModule = {};

    // Initializes the variables needed for this module.
    function initModule(missionType) {
        if (missionType === MISSION_TYPES.VALIDATE) {
            labelTypeModule = validateMSTDescriptor[labelType];
            nSlides = labelTypeModule.slides.length;
        }
    }


    /**
     * Initializes the UI for the mission screens.
     * Renders the top level messages and slide location indicators.
     * Also renders the first slide.
     */
    function initUI() {

        function renderLocationIndicators() {
            const $missionCarouselIndicatorArea = $('.mst-carousel-location-indicator-area');
            for (let i = 0; i < nSlides; i++) {
                const $indicator = $('.mst-carousel-location-indicator.template').clone().removeClass('template');
                $indicator.attr('data-idx', i);
                $missionCarouselIndicatorArea.append($indicator);
            }
        }

        $('.mst-instruction-1').text(labelTypeModule.missionInstruction1);
        $('.mst-instruction-2').text(labelTypeModule.missionInstruction2);

        renderLocationIndicators();
        renderSlide(currentSlideIdx);
    }

    /**
     * Renders the slide for the given idx which includes setting the title, subtitle, description,
     * image, and on-image label.
     * - Updates the current slide indicator.
     * - Disables/enables the next/previous buttons based on the idx of the slide rendered.
     * @param idx Index of the slide to be rendered.
     */
    function renderSlide(idx) {

        /**
         * Renders the 'on-image label' and positions it.
         * @param position info about the position of the on-image label as top and left attributes in px.
         * @param iconID ID of the SVG icon to be shown on the label.
         * @param labelOnImageTitle title to be shown on the label
         * @param labelOnImageDescription description to be shown on the label
         */
        function renderlabelOnImage(position, iconID, labelOnImageTitle, labelOnImageDescription) {

            $labelOnImage.css({'top': position.top, 'left': position.left});
            $('.label-on-image-type-title', $labelOnImage).html(labelOnImageTitle);
            $('.label-on-image-description', $labelOnImage).html(labelOnImageDescription);

            $('.label-on-image-type-icon').find('use').attr('xlink:href', iconID);

            $labelOnImage.show();
        }

        const $mstSlide = $('.mst-slide');
        const $labelTypeSubtitle = $('.label-type-subtitle');
        const $mstSlideImage = $('.msts-image');
        const $labelOnImage = $('.label-on-image');
        const $mstDoneButton = $('.mission-start-tutorial-done-btn');

        // Reset the UI first.
        $('.mst-carousel-location-indicator').removeClass('current-location');
        $mstSlide.removeClass(EXAMPLE_TYPES.CORRECT).removeClass(EXAMPLE_TYPES.INCORRECT);
        $mstSlideImage.attr('src', '');
        $labelTypeSubtitle.text('');
        $('.previous-slide-button, .next-slide-button').removeClass('disabled');
        $labelOnImage.hide();
        $mstDoneButton.removeClass('focus');

        const slide = labelTypeModule.slides[idx];

        if (slide.isExampleCorrect) {
            $mstSlide.addClass('correct');
        } else {
            $mstSlide.addClass('incorrect');
        }

        // The icon is the same on the left panel and the labelOnImage.
        let iconID = '';
        let exampleTypeLabel = '';
        let labelOnImageTitle = '';
        let labelOnImageDescription = '';
        if (slide.isExampleCorrect) {
            iconID = SMILEYS.CORRECT;
            exampleTypeLabel = i18next.t('mission-start-tutorial.example-type-label-correct');

            labelOnImageTitle = i18next.t('mission-start-tutorial.label-on-image-title-correct');
            labelOnImageDescription = i18next.t('mission-start-tutorial.label-on-image-description-correct');
        } else {
            iconID = SMILEYS.INCORRECT;
            exampleTypeLabel = i18next.t('mission-start-tutorial.example-type-label-incorrect');

            labelOnImageTitle = i18next.t('mission-start-tutorial.label-on-image-title-incorrect');
            labelOnImageDescription = i18next.t('mission-start-tutorial.label-on-image-description-incorrect');
        }


        // Now that the variables have been inited, let's set them for the UI.
        $('.example-type-label').text(exampleTypeLabel);
        $('.example-type-icon').find('use').attr('xlink:href', iconID);

        // Note: we should set this as HTML as some strings may contain HTML tags.
        $('.label-type-title').html(slide.slideTitle);
        $('.label-type-description').html(slide.slideDescription);


        if (slide.slideSubtitle) {  // Not all slides may contain a subtitle.
            $labelTypeSubtitle.html(slide.slideSubtitle);
        }

        $mstSlideImage.attr('src', slide.imageURL);

        $(`.mst-carousel-location-indicator[data-idx=${idx}]`).addClass('current-location');


        if (slide.labelOnImage) { // Just a defensive check.
            renderlabelOnImage(slide.labelOnImage.position, iconID, labelOnImageTitle, labelOnImageDescription);
        }

        // Disable the previous/next buttons based on the current slide idx
        if (idx === 0) {
            $('.previous-slide-button').addClass('disabled');
        } else if (idx === nSlides - 1) {
            $mstDoneButton.addClass('focus');
            $('.next-slide-button').addClass('disabled');
        }
    }

    /**
     * Attaches the event handlers required for the mission screen labelTypeModule.
     */
    function attachEventHandlers() {

        $('.previous-slide-button').click(function() {
            currentSlideIdx = Math.max(currentSlideIdx - 1, 0);
            renderSlide(currentSlideIdx);
            tracker.push('PreviousSlideButton_Click', {'currentSlideIdx': currentSlideIdx}, null);
        });

        $('.next-slide-button').click(function() {
            currentSlideIdx = Math.min(currentSlideIdx + 1, nSlides - 1);
            renderSlide(currentSlideIdx);
            tracker.push('NextSlideButton_Click', {'currentSlideIdx': currentSlideIdx}, null);
        });

        $('.mission-start-tutorial-done-btn').click(function() {
            $('.mission-start-tutorial-overlay').fadeOut(100);
            tracker.push('MSTDoneButton_Click', {'currentSlideIdx': currentSlideIdx}, null);
        });
    }

    initModule(missionType);
    initUI();
    attachEventHandlers();

    return this;
}
