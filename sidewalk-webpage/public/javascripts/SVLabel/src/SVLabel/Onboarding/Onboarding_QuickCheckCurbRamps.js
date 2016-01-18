/**
 * Created with JetBrains PhpStorm.
 * User: kotarohara
 * Date: 8/23/13
 * Time: 10:38 AM
 * To change this template use File | Settings | File Templates.
 */

var svw = svw || {};

function Onboarding_QuickCheckCurbRamps (param, $) {
    var oPublic = {className: 'Onboarding_QuickCheckCurbRamps'};
    var status = {
        currentPage: 1,
        disableNext: true,
        page1NumMistakes: -1,
        page2NumMistakes: -1,
        page3NumMistakes: -1
    };
    var properties = {
        borderColorGreen: 'rgba(0, 252, 0, 1)',
        borderColorRed: 'rgba(255,0,128, 1)',
        fillColorRed: 'rgba(255,0,128,1)'
    };

    var $divQuickCheckHolder;
    var $quickCheckInstructionHolder;
    var $divQuickCheckImageHolder;
    var $divQuickCheckResultMessage;
    var $imagesQuickCheck;
    var $buttonSubmit;
    var $buttonNext;

    var pages = {};
    pages[1] = this.onboardingQuickCheckPage1;
    pages[2] = this.onboardingQuickCheckPage2;
    pages[3] = this.onboardingQuickCheckPage3;

    var nextBlinkInterval = undefined;
    var nextHighlighted = false;

    ////////////////////////////////////////
    // Private methods
    ////////////////////////////////////////
    function _init() {
        $divQuickCheckHolder = $("#Holder_QuickCheck");
        $quickCheckInstructionHolder = $("#QuickCheckInstructionHolder");
        $divQuickCheckImageHolder = $("#QuickCheckImageHolder");
        $divQuickCheckResultMessage = $("#QuickCheckMessageHolder");
        $buttonSubmit = $("#QuickCheckSubmit");
        $buttonNext = $("#QuickCheckNext");

        //
        // Set the instruction message
        $quickCheckInstructionHolder.html("You are doing great! Let's check up on what we have learned. Click on all the pictures that contain curb ramps and click <b>Submit</b>.");

        //
        // Initialize the quiz images. Randomize the order.
        setImages(1);

        //
        // Bind click events after generating html.
        $imagesQuickCheck = $(".QuickCheckImages");
        $imagesQuickCheck.bind("click", clickQuickCheckImages);

        //
        // Bind button clicks
        $buttonNext.bind("click", nextClick);

        enableSubmit();

        $divQuickCheckHolder.css('visibility', 'visible');

        disableNext();
    }

    function blinkNext () {
        //
        if (nextHighlighted) {
            $buttonNext.css('background', 'white');
            nextHighlighted = false;
        } else {
            $buttonNext.css('background', 'yellow');
            nextHighlighted = true;
        }

    }

    function clickQuickCheckImages (e) {
        // This is a callback method for clicking quick check images.
        var value = $(this).attr("value");
        var values = value.split(",");
        var page = values[0];
        var id = values[1];

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('OnboardingQuickCheck_clickQuickCheckImages', {quickCheckImageId: JSON.stringify(values)});
        }

        if (!pages[page][id].clicked) {
            pages[page][id].clicked = true;
        } else {
            pages[page][id].clicked = false;
        }

        updatePage(page);
    }

    function disableNext () {
        // Disable and turn Next button gray
        status.disableNext = true;
        $buttonNext.css('opacity', 0.5);
    }

    function disableSubmit () {
        // Disable a submit button and turn the color into gray.
        $buttonSubmit.unbind("click");
        $buttonSubmit.css('opacity', 0.5);
    }

    function enableNext () {
        // Enable a next button and turn the color into normal.
        status.disableNext = false;
        $buttonNext.css('opacity', 1);
    }

    function enableSubmit () {
        // Enable a submit button and turn the color into normal.
        $buttonSubmit.bind("click", submitClick);
        $buttonSubmit.css('opacity', 1);
    }

    function nextClick () {
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('OnboardingQuickCheck_nextClick');
        }
        window.clearInterval(nextBlinkInterval);
        $buttonNext.css('background', 'white');

        if (!status.disableNext) {
            disableNext();
            //
            // Clear the result message.
            $divQuickCheckResultMessage.html("");
            if (status.currentPage === 1) {
                status.currentPage = 2;
                setImages(2);

                //
                // Bind click events after generating html.
                enableSubmit();
                $imagesQuickCheck = $(".QuickCheckImages");
                $imagesQuickCheck.bind("click", clickQuickCheckImages);
            } else if (status.currentPage === 2) {
                //
                // If page1 accuracy and page 2 accuracy is 7/8 or higher, finish the quick check.
                // Other wise take them to the 3rd page.
                status.currentPage = 3;
                if (status.page1NumMistakes > 2 || status.page2NumMistakes > 2) {
                    setImages(3);
                    //
                    // Bind click events after generating html.
                    enableSubmit();
                    $imagesQuickCheck = $(".QuickCheckImages");
                    $imagesQuickCheck.bind("click", clickQuickCheckImages);
                } else {
                    submit();
                }
            } else {
                submit();
            }
        }
    }

    function randomIdArrayGenerator(pageNumber) {
        // this method generates an array of quiz ids in a random order
        var i;
        var name;
        var idArray = [];
        for (i = 1; i <= 8; i++) {
            name = pageNumber + '_' + i;
            idArray.push(name);
        }
        return shuffle(idArray);
    }

    function setImages (pageNumber) {
        // This method sets images
        var i;
        var html = "";
        var partial;
        var page = pageNumber;
        var id;
        var idArray = randomIdArrayGenerator(page)
        var idArrayLength = idArray.length;
        var path;

        for (i = 0; i < idArrayLength; i++) {
            id = idArray[i];
            path = pages[page][id].path;
            partial = '<div class="InlineBlock" style="position: relative;">' +
                // '<img src="public/img/QuickCheck_Images/Page' + page + '/Quiz_' + id + '.png" class="QuickCheckImages" value="' + page + ',' + id + '" name>' +
                '<img src="' + path + '" class="QuickCheckImages" value="' + page + ',' + id + '" name>' +
                '</div>';
            html += partial;
        }
        $divQuickCheckImageHolder.html(html);
    }

    function submit (e) {
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('OnboardingQuickCheck_submit');
        }
        svw.onboarding.submit();
    }

    function submitClick () {
        // This method shows correct/incorrect messages.
        var value;
        var values;
        var page;
        var id;
        var message;
        var numMistakes = 0;

        disableSubmit();
        $imagesQuickCheck.unbind("click");

        var note = "";
        $.each($imagesQuickCheck, function (index, image) {
            value = $(image).attr('value');
            values = value.split(',');
            page = values[0];
            id = values[1];

            note += "(" + page + "," + id + ",";
            //
            // If answer is correct, change the border to green.
            // Otherwise change the border to red and show an message.
            if (pages[page][id].isCurbRamp === pages[page][id].clicked) {
                $(image).css('border-color', properties.borderColorGreen);
                note += "1),";
            } else {
                message = '<p class="QuickCheckErrorMessages">' + pages[page][id].message + '</p>';
                $(image).css('border-color', properties.borderColorRed);
                $(message).insertAfter($(image));
                numMistakes++;
                note += "0),";
            }
        });
        $('.QuickCheckErrorMessages').css('background', properties.fillColorRed);

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('OnboardingQuickCheck_submitClick', {quickCheckCorrectness:note});
        }

        //
        // Update the result message and store how many mistakes the user has made
        if (numMistakes === 0) {
            message = "Perfect! You did not make any mistake. Click <b>Next</b> to proceed.";
        } else if (numMistakes === 1) {
            message = "You made 1 mistake. Please see the red image and read a message, then click <b>Next</b> to proceed.";
        } else {
            message = "You made " + numMistakes + " mistakes. Please see the red images and read why they are counted as mistakes, " +
                "then click <b>Next</b> to proceed.";
        }
        $divQuickCheckResultMessage.html(message);
        if (page == 1) {
            status.page1NumMistakes = numMistakes;
        } else if (page == 2) {
            status.page2NumMistakes = numMistakes;
        } else {
            status.page3NumMistakes = numMistakes;
        }

        //
        // Allow going to the next task.
        enableNext();

        nextBlinkInterval = setInterval(blinkNext, 500);
    }

    function updatePage(page) {
        // This method updates outlines around images based on check/uncheck of the images.
        var value;
        var values;
        var page;
        var id;
        var dom = '<img src="public/img/icons/Icon_OrangeCheckmark.png" class="QuickCheckCheckMarkIcons" />';

        //
        // First remove all the check marks, and re append check marks based on the current status.
        $('.QuickCheckCheckMarkIcons').remove();
        $.each($imagesQuickCheck, function (index, image) {
            value = $(image).attr('value');
            values = value.split(',');
            page = values[0];
            id = values[1];
            if (pages[page][id].clicked) {
                $(dom).insertAfter($(image));
            }
        });
    }
    ////////////////////////////////////////
    // Public methods
    ////////////////////////////////////////
    oPublic.hide = function () {
        $divQuickCheckHolder.css('visibility', 'hidden');
        return this;
    };

    oPublic.show = function () {
        $divQuickCheckHolder.css('visibility', 'visible');
        return this;
    };

    _init();

    return oPublic;
}

Onboarding_QuickCheckCurbRamps.prototype.onboardingQuickCheckPage1 = {
    "1_1": {
        id: "1_1",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_1.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "1_2": {
        id: "1_2",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_2.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "1_3": {
        id: "1_3",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_3.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "1_4": {
        id: "1_4",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_4.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "1_5": {
        id: "1_5",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_5.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "1_6": {
        id: "1_6",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_6.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "1_7": {
        id: "1_7",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_7.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    },
    "1_8": {
        id: "1_8",
        path: "public/img/QuickCheck_Images/Page1/Quiz_1_8.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    }
};

Onboarding_QuickCheckCurbRamps.prototype.onboardingQuickCheckPage2 = {
    "2_1": {
        id: "2_1",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_1.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    },
    "2_2": {
        id: "2_2",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_2.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture even though the sidewalk is not visible because of the truck." //  So, you cannot be sure if there is a curb ramp."
    },
    "2_3": {
        id: "2_3",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_3.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "2_4": {
        id: "2_4",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_4.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "2_5": {
        id: "2_5",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_5.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "2_6": {
        id: "2_6",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_6.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "2_7": {
        id: "2_7",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_7.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "2_8": {
        id: "2_8",
        path: "public/img/QuickCheck_Images/Page2/Quiz_2_8.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    }
};

Onboarding_QuickCheckCurbRamps.prototype.onboardingQuickCheckPage3 = {
    "3_1": {
        id: "3_1",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_1.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "3_2": {
        id: "3_2",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_2.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have curb ramps and should have been clicked.'
    },
    "3_3": {
        id: "3_3",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_3.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "3_4": {
        id: "3_4",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_4.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "3_5": {
        id: "3_5",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_5.png",
        isCurbRamp: true,
        clicked: false,
        message: 'This picture does have a curb ramp and should have been clicked.'
    },
    "3_6": {
        id: "3_6",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_6.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    },
    "3_7": {
        id: "3_7",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_7.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    },
    "3_8": {
        id: "3_8",
        path: "public/img/QuickCheck_Images/Page3/Quiz_3_8.png",
        isCurbRamp: false,
        clicked: false,
        message: "You clicked on this picture but it dose not contain a curb ramp."
    }
};