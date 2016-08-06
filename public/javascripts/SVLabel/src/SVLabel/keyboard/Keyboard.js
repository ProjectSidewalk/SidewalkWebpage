/**
 * A Keyboard module.
 *
 * Todo. Get rid of the dependency to svl.
 * @param $ jQuery
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Keyboard ($, canvas, contextMenu, ribbon, uiContextMenu, zoomControl, onboarding) {
    var self = {
            className : 'Keyboard'
        };
    var status = {
        focusOnTextField: false,
        isOnboarding: false,
        shiftDown: false
    };

    function init () {
        $(document).bind('keyup', documentKeyUp);
        $(document).bind('keydown', documentKeyDown);
    }
    function _toRadians (angle) {
        return angle * (Math.PI / 180);
    }

    // Move in the direction of a link closest to a given angle.
    // Todo: Get rid of dependency to svl.panorama. Inject a streetViewMap into this module and use its interface.
    function movePano(angle) {
        // take the cosine of the difference for each link to the current heading in radians and stores them to an array
        var cosines = svl.panorama.links.map(function(link) {
            return Math.cos(_toRadians(svl.panorama.pov.heading + angle) - _toRadians(link.heading))
        });
        var maxVal = Math.max.apply(null, cosines);
        var maxIndex = cosines.indexOf(maxVal);
        if(cosines[maxIndex] > 0.5){
            svl.panorama.setPano(svl.panorama.links[maxIndex].pano);
        }
    }
    // abstract movePano with more meaningful function name for the following two
    function moveForward(){
        movePano(0);
    }

    function moveBackward(){
        movePano(180);
    }
    // change the heading of the current panorama point of view by a particular degree value
    function rotatePov(degree){
        var heading =  svl.panorama.pov.heading;
        // pitch and zoom arent changed but are needed for the setPov call
        var pitch = svl.panorama.pov.pitch;
        var zoom = svl.panorama.pov.zoom;
        heading = (heading + degree + 360) % 360;
        svl.panorama.setPov({heading: heading, pitch: pitch, zoom: zoom});
    }

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    function documentKeyDown(e) {
        // The callback method that is triggered with a keyUp event.
        if (contextMenu.isOpen()) {
            return;
        } else if (!status.focusOnTextField) {
            // lock scrolling in response to key pressing
            switch (e.keyCode) {
                case 16:  // "Shift"
                    status.shiftDown = true;
                    break;
                case 37:  // "Left"
                    rotatePov(-2);
                    break;
                case 39:  // "Right"
                    rotatePov(2);
                    break;
                case 38:
                    moveForward();
                    break;
                // "down"
                case 40:
                    moveBackward();
                    break;
            }

            if([37, 38, 39, 40].indexOf(e.keyCode) > -1) {
                e.preventDefault();
            }
        } else {

        }
    }

    /**
     * This is a callback for a key up event.
     * @param {object} e An event object
     * @private
     */
    function documentKeyUp (e) {
        if (onboarding && onboarding.isOnboarding()) {
            // Don't allow users to use keyboard shortcut during the onboarding.
            return;
        }

        // This is a callback method that is triggered when a keyDown event occurs.
        if (!status.focusOnTextField) {
            var label;
            switch (e.keyCode) {
                // "Enter"
                case 13:
                    if (contextMenu.isOpen()) {
                        contextMenu.hide();
                    }
                    break;
                case 16:
                    // "Shift"
                    status.shiftDown = false;
                    break;
                case 27:
                    // "Escape"
                    if (canvas.getStatus('drawing')) {
                        canvas.cancelDrawing();
                    } else {
                        ribbon.backToWalk();
                    }
                    break;
                    case 49:  // "1"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(1);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 1);
                        }
                    }
                    else{
                        ribbon.modeSwitchClick("CurbRamp");
                        break;
                    }
                    break;
                case 50:  // "2"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(2);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 2);
                        }
                    } else {
                        ribbon.modeSwitchClick("NoCurbRamp");
                    }
                    break;
                case 51:  // "3"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(3);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 3);
                        }
                    } else {
                        ribbon.modeSwitchClick("Obstacle");
                    }
                    break;
                case 52:  // "4"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(4);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 4);
                        }
                    } else {
                        ribbon.modeSwitchClick("SurfaceProblem");
                    }
                    break;
                case 53:  // "5"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(5);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 5);
                        }
                    }
                    break;
                case 66:
                    // "b" for a blocked view
                    ribbon.modeSwitch("Occlusion");
                    break;
                case 67:
                    // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                    ribbon.modeSwitch("CurbRamp");
                    break;
                case 69:
                    // "e" for Explore. Switch the mode to Walk (camera) mode.
                    ribbon.modeSwitch("Walk");
                    break;
                case 77:
                    // "m" for MissingCurbRamp. Switch the mode to the MissingCurbRamp labeling mode.
                    ribbon.modeSwitch("NoCurbRamp");
                    break;
                case 78:
                    ribbon.modeSwitch("NoSidewalk");
                    break;
                case 79:
                    // "o" for Obstacle
                    ribbon.modeSwitch("Obstacle");
                    break;
                case 83:
                    ribbon.modeSwitch("SurfaceProblem");
                    break;
                case 90:
                    // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                    if (status.shiftDown) {
                        // Zoom out
                        if ("zoomControl" in svl) {
                            zoomControl.zoomOut();
                        }
                    } else {
                        // Zoom in
                        if ("zoomControl" in svl)
                            zoomControl.zoomIn();
                    }
            }
        }
    }

    /**
     * This is a callback function called when any of the text field is blurred.
     * @private
     */
    function textFieldBlur () {
        status.focusOnTextField = false
    }

    /**
     * This is a callback function called when any of the text field is focused.
     * @private
     */
    function textFieldFocus () {
        status.focusOnTextField = true;
    }

    /**
     * Get status
     * @param {string} key Field name
     * @returns {*}
     */
    function getStatus (key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    }

    /**
     * This method returns whether a shift key is currently pressed or not.
     * @returns {boolean}
     */
    function isShiftDown () {
        return status.shiftDown;
    }

    /**
     * Set status
     * @param key Field name
     * @param value Field value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        if (key in status) {
            status[key] = value;
        }
        return this;
    }


    self.getStatus = getStatus;
    self.isShiftDown = isShiftDown;
    self.setStatus = setStatus;

    init();
    return self;
}
