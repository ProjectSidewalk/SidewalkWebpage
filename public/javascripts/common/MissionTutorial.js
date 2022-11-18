/**
 * Provides structure for a slide based tutorial framework.
 *
 * @param tutorialDescriptor
 * Important JSON descriptor that defines the mission screens for all Label types.
 * Each key in this object is a LabelType.
 * And each value object contains the following:
 *     - missionInstruction1: Text to be shown at the very top, above the slides area.
 *     - missionInstruction2: Text to be shown below missionInstruction1, above the slides area.
 *     - slides: An array of 'slides'.
 *
 *     Each 'slide' contains the following:
 *         - isExampleCorrect: boolean, indicating whether the example type is correct or incorrect.
 *         - exampleTypeLabel: string, text indicating whether the example type is correct or incorrect.
 *         - exampleTypeIcon: string, ID of the SVG icon to be shown. A symbol with this ID should be present
 *                            in icons.scala.html.
 *         - slideTitle: string, title for the slide.
 *         - slideSubtitle: string, subtitle for the slide.
 *         - slideDescription: string, long form text description for the slide.
 *         - imageURL: string, URL to the image to be shown.
 *         - onImageLabel: object, containg the following:
 *             - title: string, title for the on-image label
 *             - description: string, description for the on-image label.
 *             - position: object, containing 'top' and 'left' attributes for the on-image label.
 *                         The 'top' and 'left' must be defined with respect to the top and left
 *                         of the 'image element.'
 *
 * @constructor
 */
function MissionTutorial(tutorialDescriptor) {
    let self = this;

    const EXAMPLE_TYPES = {
        CORRECT: 'correct',
        INCORRECT: 'incorrect'
    };

    let LabelType = param.labelList[0].getAuditProperty('labelType');

    // Initialize variables.
    let currentSlideIdx = 0;
    let nSlides = 2;

    let labelTypeModule = {};

    // Initializes the slide deck based on the LabelType.
    function initModule(LabelType) {

        if (!tutorialDescriptor[LabelType]) {
            // Log here
            console.log('Unknown labelType: ' + LabelType);
        }

        labelTypeModule = tutorialDescriptor[LabelType];
        nSlides = labelTypeModule.slides.length;
    }

    /**
     * Initializes the UI for the mission screens.
     * Renders the top level messages and slide location indicators.
     * Also renders the first slide.
     */
    function initUI() {

        function renderLocationIndicators() {
            const $missionCarouselIndicatorArea = $('.mission-carousel-location-indicator-area');
            for (let i = 0; i < nSlides; i++) {
                const $indicator = $('.mission-carousel-location-indicator.template').clone().removeClass('template');
                $indicator.attr('data-idx', i);
                $missionCarouselIndicatorArea.append($indicator);
            }
        }

        $('.mission-instruction-1').text(labelTypeModule.missionInstruction1);
        $('.mission-instruction-2').text(labelTypeModule.missionInstruction2);

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
         * @param onImageLabel info about the title, description, and position of the on-image label.
         * @param iconID ID of the SVG icon to be shown on the label.
         */
        function renderOnImageLabel(onImageLabel, iconID) {

            $onImageLabel.css({'top': onImageLabel.position.top, 'left': onImageLabel.position.left});
            $('.on-image-label-type-title', $onImageLabel).html(onImageLabel.title);
            $('.on-image-label-description', $onImageLabel).html(onImageLabel.description);

            $('.on-image-label-type-icon').find('use').attr('xlink:href', iconID);

            $onImageLabel.show();
        }

        const $missionTutorialSlide = $('.mission-tutorial-slide');
        const $labelTypeSubtitle = $('.label-type-subtitle');
        const $mtsImage = $('.mts-image');
        const $onImageLabel = $('.on-image-label');

        // Reset the UI first.
        $('.mission-carousel-location-indicator').removeClass('current-location');
        $missionTutorialSlide.removeClass(EXAMPLE_TYPES.CORRECT).removeClass(EXAMPLE_TYPES.INCORRECT);
        $mtsImage.attr('src', '');
        $labelTypeSubtitle.text('');
        $('.previous-slide-button, .next-slide-button').removeClass('disabled');
        $onImageLabel.hide();

        const slide = labelTypeModule.slides[idx];

        if (slide.isExampleCorrect) {
            $missionTutorialSlide.addClass('correct');
        } else {
            $missionTutorialSlide.addClass('incorrect');
        }

        // Set the text and the icons
        $('.example-type-label').text(slide.exampleTypeLabel);
        $('.example-type-icon').find('use').attr('xlink:href', slide.exampleTypeIcon);

        // Note: we should set this as HTML as some strings may contain HTML tags.
        $('.label-type-title').html(slide.slideTitle);
        $('.label-type-description').html(slide.slideDescription);


        if (slide.slideSubtitle) {  // Not all slides may contain a subtitle.
            $labelTypeSubtitle.html(slide.slideSubtitle);
        }

        $mtsImage.attr('src', slide.imageURL);

        $(`.mission-carousel-location-indicator[data-idx=${idx}]`).addClass('current-location');


        if (slide.onImageLabel) { // Just a defensive check.
            renderOnImageLabel(slide.onImageLabel, slide.exampleTypeIcon);
        }

        // Disable the previous/next buttons based on the current slide idx
        if (idx === 0) {
            $('.previous-slide-button').addClass('disabled');
        } else if (idx === nSlides - 1) {
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

    return this;
}
