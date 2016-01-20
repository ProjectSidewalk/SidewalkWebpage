var svl = svl || {};

/**
 * @memberof svl
 * @constructor
 */
function ExampleWindow ($, params) {
    var self = { className : 'ExampleWindow'},
        properties = {
            exampleCategories : ['StopSign_OneLeg', 'StopSign_TwoLegs', 'StopSign_Column', 'NextToCurb', 'AwayFromCurb']
        },
        status = {
            open : false
        };

        // jQuery elements
    var $divHolderExampleWindow;
    var $divHolderCloseButton;
    var $divExampleOneLegStopSign;
    var $divExampleTwoLegStopSign;
    var $divExampleColumnStopSign;
    var $divExampleNextToCurb;
    var $divExampleAwayFromCurb;
    var exampleWindows = {};

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init (params) {
        // Initialize jQuery elements
        $divHolderExampleWindow = $(params.domIds.holder);
        $divHolderCloseButton = $(params.domIds.closeButtonHolder);
        $divExampleOneLegStopSign = $(params.domIds.StopSign_OneLeg);
        $divExampleTwoLegStopSign = $(params.domIds.StopSign_TwoLegs);
        $divExampleColumnStopSign = $(params.domIds.StopSign_Column);
        $divExampleNextToCurb = $(params.domIds.NextToCurb);
        $divExampleAwayFromCurb = $(params.domIds.AwayFromCurb);

        exampleWindows = {
            StopSign_OneLeg : $divExampleOneLegStopSign,
            StopSign_TwoLegs : $divExampleTwoLegStopSign,
            StopSign_Column : $divExampleColumnStopSign,
            NextToCurb : $divExampleNextToCurb,
            AwayFromCurb : $divExampleAwayFromCurb
        };

        // Add listeners
        $divHolderCloseButton.bind({
            click : self.close,
            mouseenter : closeButtonMouseEnter,
            mouseleave : closeButtonMouseLeave
        });
    }


    function closeButtonMouseEnter () {
        // A callback function that is invoked when a mouse cursor enters the X sign.
        // This function changes a cursor to a pointer.
        $(this).css({
            cursor : 'pointer'
        });
        return this;
    }

    function closeButtonMouseLeave () {
        // A callback function that is invoked when a mouse cursor leaves the X sign.
        // This function changes a cursor to a 'default'.
        $(this).css({
            cursor : 'default'
        });
        return this;
    }


    self.close = function () {
        // Hide the example window.
        status.open = false;
        $divHolderExampleWindow.css({
            visibility : 'hidden'
        });
        $.each(exampleWindows, function (i, v) {
            v.css({visibility:'hidden'});
        });
        return this;
    };


    self.isOpen = function () {
        return status.open;
    };


    self.show = function (exampleCategory) {
        // Show the example window.
        // Return false if the passed category is not know.
        if (properties.exampleCategories.indexOf(exampleCategory) === -1) {
            return false;
        }

        status.open = true;
        $divHolderExampleWindow.css({
            visibility : 'visible'
        });

        $.each(exampleWindows, function (i, v) {
            console.log(i);
            if (i === exampleCategory) {
                v.css({visibility:'visible'});
            } else {
                v.css({visibility:'hidden'});
            }
        });

        return this;
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init(params);
    return self;
}
