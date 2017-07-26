function ContextMenu (uiContextMenu) {
    var self = { className: "ContextMenu" },
        status = {
            targetLabel: null,
            visibility: 'hidden'
        };
    var $menuWindow = uiContextMenu.holder,
        $connector = uiContextMenu.connector,
        $radioButtons = uiContextMenu.radioButtons,
        $temporaryProblemCheckbox = uiContextMenu.temporaryProblemCheckbox,
        $descriptionTextBox = uiContextMenu.textBox,
        windowWidth = $menuWindow.width();
        windowHeight = $menuWindow.height();
    var $OKButton = $menuWindow.find("#context-menu-ok-button");
    var $radioButtonLabels = $menuWindow.find(".radio-button-labels");

    var lastShownLabelColor;

    var context_menu_el = document.getElementById('context-menu-holder');
    document.addEventListener('mousedown', function(event){
        //event.stopPropagation();
        var clicked_out = !(context_menu_el.contains(event.target));
        if (isOpen()){
            hide();
            wasOpen = true;
            if (clicked_out) _handleSeverityPopup();
        }
    }); //handles clicking outside of context menu holder
    //document.addEventListener("mousedown", hide);
    document.onkeypress= function(e){
        e= e || window.event;
        var key_pressed = e.which || e.keyCode;
        if (key_pressed == 13 && isOpen()){
            hide();
            _handleSeverityPopup();
        }
    };//handles pressing enter key to exit ContextMenu



    $menuWindow.on('mousedown', handleMenuWindowMouseDown);
    $radioButtons.on('change', _handleRadioChange);
    $temporaryProblemCheckbox.on('change', handleTemporaryProblemCheckboxChange);
    $descriptionTextBox.on('change', handleDescriptionTextBoxChange);
    $descriptionTextBox.on('focus', handleDescriptionTextBoxFocus);
    $descriptionTextBox.on('blur', handleDescriptionTextBoxBlur);
    uiContextMenu.closeButton.on('click', handleCloseButtonClick);
    $OKButton.on('click', _handleOKButtonClick);
    $radioButtonLabels.on('mouseenter', _handleRadioButtonLabelMouseEnter);
    $radioButtonLabels.on('mouseleave', _handleRadioButtonLabelMouseLeave);

    var down = {};
    var lastKeyPressed = 0;
    var lastKeyCmd = false;
    onkeydown = onkeyup = function(e){
        e = e || event; // to deal with IE
        var isMac = navigator.platform.indexOf('Mac') > -1;
        down[e.keyCode] = e.type == 'keydown';
        if (isMac){
            if (lastKeyCmd && down[91] && isOpen() && down[65]){
                $descriptionTextBox.select();
                down[65] = false; //reset A key
            }//A key, menu shown

        }//mac
        else{
            if (lastKeyPressed == 17 && isOpen() && down[65]){
                $descriptionTextBox.select();
            }//ctrl+A while context menu open
        }//windows
        if (e.type == 'keydown'){
            lastKeyPressed = e.keyCode;
            lastKeyCmd = e.metaKey;
        }else{
            lastKeyPressed = 0;
            lastKeyCmd = false;
        }
    }//handles both key down and key up events

    function checkRadioButton (value) {
        uiContextMenu.radioButtons.filter(function(){return this.value==value}).prop("checked", true).trigger("click");
    }

    function getContextMenuUI(){
        return uiContextMenu;
    }

    /**
     * Returns a status
     * @param key
     * @returns {null}
     */
    function getStatus (key) {
        return (key in status) ? status[key] : null;
    }

    /**
     * Get the current target label
     * @returns {null}
     */
    function getTargetLabel () {
        return getStatus('targetLabel');
    }

    /**
     * Combined with document.addEventListener("mousedown", hide), this method will close the context menu window
     * when user clicks somewhere on the window except for the area on the context menu window.
     * @param e
     */
    function handleMenuWindowMouseDown (e) {
        e.stopPropagation();
    }

    function handleDescriptionTextBoxChange(e) {
        var description = $(this).val(),
            label = getTargetLabel();
        if (label) {
            label.setProperty('description', description);
        }
    }

    function handleDescriptionTextBoxBlur() {
        svl.tracker.push('ContextMenu_TextBoxBlur');
        svl.ribbon.enableModeSwitch();
        svl.keyboard.setStatus('focusOnTextField', false);
    }

    function handleDescriptionTextBoxFocus() {
        svl.tracker.push('ContextMenu_TextBoxFocus');
        svl.ribbon.disableModeSwitch();
        svl.keyboard.setStatus('focusOnTextField', true);
    }

    function handleCloseButtonClick () {

        svl.tracker.push('ContextMenu_CloseButtonClick');
        hide();
        _handleSeverityPopup();

    }

    function _handleOKButtonClick () {

        svl.tracker.push('ContextMenu_OKButtonClick');
        hide();
        _handleSeverityPopup();

    }

    function _handleSeverityPopup (){
        var labels = svl.labelContainer.getCurrentLabels();
        var prev_labels = svl.labelContainer.getPreviousLabels();
        if (labels.length == 0){
            labels = prev_labels;
        }
        if (labels.length > 0) {
            var last_label = labels[labels.length - 1];
            var prop = last_label.getProperties();
            svl.ratingReminderAlert.ratingClicked(prop.severity);
        }
    }

    /**
     *
     * @param e
     */
    function _handleRadioChange (e) {
        var severity = parseInt($(this).val(), 10);
        var label = getTargetLabel();
        svl.tracker.push('ContextMenu_RadioChange', { LabelType: label.getProperty("labelType"), RadioValue: severity });

        self.updateRadioButtonImages();

        if (label) {
            label.setProperty('severity', severity);
        }
    }

    function _handleRadioButtonLabelMouseEnter () {
        var radioValue = parseInt($(this).find("input").attr("value"), 10);
        self.updateRadioButtonImages(radioValue);
    }

    function _handleRadioButtonLabelMouseLeave () {
        self.updateRadioButtonImages();
    }

    self.updateRadioButtonImages = function (hoveredRadioButtonValue) {
        var $radioButtonImages = $radioButtonLabels.find("input + img");
        var $selectedRadioButtonImage;
        var $hoveredRadioButtonImage;
        var imageURL;

        $radioButtonImages.each(function (i, element) {
            imageURL = $(element).attr("default-src");
            $(element).attr("src", imageURL);
        });

        // Update the hovered radio button image
        if (hoveredRadioButtonValue && hoveredRadioButtonValue > 0 && hoveredRadioButtonValue <= 5) {
            $hoveredRadioButtonImage = $radioButtonLabels.find("input[value='" + hoveredRadioButtonValue + "'] + img");
            imageURL = $hoveredRadioButtonImage.attr("default-src");
            imageURL = imageURL.replace("_BW.png", ".png");
            $hoveredRadioButtonImage.attr("src", imageURL);
        }

        // Update the selected radio button image
        $selectedRadioButtonImage = $radioButtonLabels.find("input:checked + img");
        if ($selectedRadioButtonImage.length > 0) {
            imageURL = $selectedRadioButtonImage.attr("default-src");
            imageURL = imageURL.replace("_BW.png", ".png");
            $selectedRadioButtonImage.attr("src", imageURL);
        }
    };


    /**
     *
     * @param e
     */
    function handleTemporaryProblemCheckboxChange (e) {
        var checked = $(this).is(":checked"),
            label = getTargetLabel();
        svl.tracker.push('ContextMenu_CheckboxChange', { checked: checked });

        if (label) {
            label.setProperty('temporaryProblem', checked);
        }
    }

    /**
     * Hide the context menu
     * @returns {hide}
     */
    function hide () {
        $menuWindow.css('visibility', 'hidden');
        setBorderColor('black');
        setStatus('visibility', 'hidden');
        return this;
    }

    /**
     * Unhide the context menu
     * @returns {hide}
     */
    function unhide () {
        $menuWindow.css('visibility', 'visible');
        if (lastShownLabelColor) {
            setBorderColor(lastShownLabelColor);
        }
        setStatus('visibility', 'visible');
        return this;
    }

    /**
     * Checks if the menu is open or not
     * @returns {boolean}
     */
    function isOpen() {
        return getStatus('visibility') == 'visible';
    }

    /**
     * Set the border color of the menu window
     * @param color
     */
    function setBorderColor(color) {
        $menuWindow.css('border-color', color);
        $connector.css('background-color', color);
    }

    /**
     * Sets a status
     * @param key
     * @param value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        status[key] = value;
        return this;
    }

    /**
     * Show the context menu
     * @param x x-coordinate on the canvas pane
     * @param y y-coordinate on the canvas pane
     * @param param a parameter object
     */
    function show (x, y, param) {

        setStatus('targetLabel', null);
        $radioButtons.prop('checked', false);
        $temporaryProblemCheckbox.prop('checked', false);
        $descriptionTextBox.val(null);
        if (x && y && ('targetLabel' in param)) {
            var labelType = param.targetLabel.getLabelType(),
                acceptedLabelTypes = ['SurfaceProblem', 'Obstacle', 'NoCurbRamp', 'Other', 'CurbRamp'];
            if (acceptedLabelTypes.indexOf(labelType) != -1) {
                setStatus('targetLabel', param.targetLabel);
                var topCoordinate = y + 20;
                var connectorCoordinate = -13;
                //if the menu is so far down the screen that it will get cut off
                if(topCoordinate>370){
                  topCoordinate = y - 40 - windowHeight;
                  connectorCoordinate = windowHeight + 13;
                }
                $menuWindow.css({
                    visibility: 'visible',
                    left: x - windowWidth / 2,
                    top: topCoordinate
                });
                $connector.css({
                  top: connectorCoordinate
                });

                if (param) {
                    if ('targetLabelColor' in param) {
                        setBorderColor(param.targetLabelColor);
                        lastShownLabelColor = param.targetLabelColor;
                    }
                }
                setStatus('visibility', 'visible');

                // Set the menu value if label has it's value set.
                var severity = param.targetLabel.getProperty('severity'),
                    temporaryProblem = param.targetLabel.getProperty('temporaryProblem'),
                    description = param.targetLabel.getProperty('description');
                if (severity) {
                    $radioButtons.each(function (i, v) {
                       if (severity == i + 1) { $(this).prop("checked", true); }
                    });
                }

                if (temporaryProblem) {
                    $temporaryProblemCheckbox.prop("checked", temporaryProblem);
                }

                if (description) {
                    $descriptionTextBox.val(description);
                } else {
                    var example = '', defaultText = "Description";
                    if (labelType == 'CurbRamp') {
                        example = " (e.g., narrow curb ramp)";
                    } else if (labelType == 'NoCurbRamp') {
                        example = " (e.g., unclear if a curb ramp is needed)";
                    } else if (labelType == 'Obstacle') {
                        example = " (e.g., light pole blocking sidewalk)";
                    } else if (labelType == 'SurfaceProblem') {
                        example = " (e.g., unleveled due to a tree root)";
                    }
                    $descriptionTextBox.prop("placeholder", defaultText + example);
                }
            }
        }
        self.updateRadioButtonImages();
    }

    self.getContextMenuUI = getContextMenuUI;
    self.checkRadioButton = checkRadioButton;
    self.getTargetLabel = getTargetLabel;
    self.hide = hide;
    self.unhide = unhide;
    self.isOpen = isOpen;
    self.show = show;
    return self;
}
