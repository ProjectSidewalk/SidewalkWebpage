var svl = svl || {};

/**
 * A Mouse module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Mouse ($) {
    var self = { className : 'Mouse' };

    function _init () {
        $(document).bind('mouseup', mouseUp);
    }

    function mouseUp (e) {
        // A call back method for mouseup. Capture a right click and do something.
        // Capturing right click in javascript.
        // http://stackoverflow.com/questions/2405771/is-right-click-a-javascript-event
        var isRightMB;
        e = e || window.event;

        if ("which" in e)  // Gecko (Firefox), WebKit (Safari/Chrome) & Opera
            isRightMB = e.which == 3;
        else if ("button" in e)  // IE, Opera
            isRightMB = e.button == 2;

        if (isRightMB) {

        }
    }


    _init();
    return self;
}
