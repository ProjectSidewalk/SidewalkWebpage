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

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    function documentKeyDown(e) {
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
        // console.log(e.keyCode);

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
