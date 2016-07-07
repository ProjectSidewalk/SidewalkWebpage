/**
 * A Keyboard module
 * @param $ jQuery
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Keyboard ($) {
    var self = {
            className : 'Keyboard'
        };
    var status = {
        focusOnTextField: false,
        shiftDown: false
    };

    var $textareaComment;

    function init () {
        if ('ui' in svl && 'form' in svl.ui) {
            $textareaComment = (svl.ui.form.commentField.length) > 0 ? svl.ui.form.commentField : null;
        }

        if ($textareaComment) {
          $textareaComment.bind('focus', textFieldFocus);
          $textareaComment.bind('blur', textFieldBlur);
        }

        $(document).bind('keyup', documentKeyUp);
        $(document).bind('keydown', documentKeyDown);
    }
    function toRadians (angle) {
        return angle * (Math.PI / 180);
    }
    // Move in the direction of a link closest to a given angle
    function movePano(angle) {
        // take the cosine of the difference for each link to the current heading in radians and stores them to an array
        var cosines = svl.panorama.links.map(function(link) { return Math.cos(toRadians(svl.panorama.pov.heading + angle) - toRadians(link.heading))});
        // finds index of greatest value in cosines array
        var maxVal = Math.max.apply(null, cosines);
        var maxIndex = cosines.indexOf(maxVal);
        //in the case of one link, this prevents you from moving in that direction if you press the opposite
        if(cosines[maxIndex] > 0.5){
            // transitions panorama to the link of the greatest cosine (closest to direction)
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
        // lock scrolling in response to key pressing
        if([37, 38, 39, 40].indexOf(e.keyCode) > -1) { 
            e.preventDefault();
        }
    
        switch (e.keyCode) {
            // "left"
            // rotate pano
            case 37:
                rotatePov(-2);
                break;
             // "right"
            // rotate pano
            case 39:
                rotatePov(2);
                break;

        }
        // The callback method that is triggered with a keyUp event.
        if (!status.focusOnTextField) {
            switch (e.keyCode) {
                case 16:
                    // "Shift"
                    status.shiftDown = true;
                    break;
            }
        }
    }

    /**
     * This is a callback for a key up event.
     * @param {object} e An event object
     * @private
     */
    function documentKeyUp (e) {
        switch (e.keyCode) {
            // "up"
            case 38:
                moveForward();
                break;
            // "down"
            case 40:
                moveBackward();
                break;
        }
        if ("onboarding" in svl && svl.onboarding && svl.onboarding.isOnboarding()) {
            // Don't allow users to use keyboard shortcut during the onboarding.
            return;
        }

        // This is a callback method that is triggered when a keyDown event occurs.
        if (!status.focusOnTextField) {
            // if ("contextMenu" in svl && svl.contextMenu) {
            //     svl.contextMenu.hide();
            // }

            switch (e.keyCode) {
                // "Enter"
                case 13:
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.contextMenu.hide();
                    }
                    break;
                case 16:
                    // "Shift"
                    status.shiftDown = false;
                    break;
                case 27:
                    // "Escape"
                    if (svl.canvas.getStatus('drawing')) {
                        svl.canvas.cancelDrawing();
                    } else {
                        svl.ribbon.backToWalk();
                    }
                    break;
                    case 49:
                    // "1"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='1'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("CurbRamp");
                        break;
                    }
                    break;
                case 50:
                    // "2"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='2'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("NoCurbRamp");
                    }
                    break;
                case 51:
                    // "3"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='3'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("Obstacle");
                    }
                    break;
                case 52:
                    // "4"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='4'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("SurfaceProblem");
                    }
                    break;
                case 53:
                    // "5"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='5'}).prop("checked", true).trigger("click");
                    }
                    else{

                    }
                    break;
                case 66:
                    // "b" for a blocked view
                    svl.ribbon.modeSwitch("Occlusion");
                    break;
                case 67:
                    // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                    svl.ribbon.modeSwitch("CurbRamp");
                    break;
                case 69:
                    // "e" for Explore. Switch the mode to Walk (camera) mode.
                    svl.ribbon.modeSwitch("Walk");
                    break;
                case 77:
                    // "m" for MissingCurbRamp. Switch the mode to the MissingCurbRamp labeling mode.
                    svl.ribbon.modeSwitch("NoCurbRamp");
                    break;
                case 78:
                    svl.ribbon.modeSwitch("NoSidewalk");
                    break;
                case 79:
                    // "o" for Obstacle
                    svl.ribbon.modeSwitch("Obstacle");
                    break;
                case 83:
                    svl.ribbon.modeSwitch("SurfaceProblem");
                    break;
                case 90:
                    // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                    if (status.shiftDown) {
                        // Zoom out
                        if ("zoomControl" in svl) {
                            svl.zoomControl.zoomOut();
                        }
                    } else {
                        // Zoom in
                        if ("zoomControl" in svl)
                            svl.zoomControl.zoomIn();
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
