function ContextMenu ($) {
    var self = { className: "ContextMenu" },
        status = {
            targetLabel: null,
            visibility: 'hidden'
        };
    var $menuWindow = svl.ui.contextMenu.holder,
        $connector = svl.ui.contextMenu.connector,
        $radioButtons = svl.ui.contextMenu.radioButtons,
        $temporaryProblemCheckbox = svl.ui.contextMenu.temporaryProblemCheckbox,
        windowWidth = $menuWindow.width();

    document.addEventListener("mousedown", hide);
    $menuWindow.on('mousedown', handleMenuWindowMouseDown);
    $radioButtons.on('change', handleRadioChange);
    $temporaryProblemCheckbox.on('change', handleTemporaryProblemCheckboxChange);


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

    /**
     *
     * @param e
     */
    function handleRadioChange (e) {
        var severity = parseInt($(this).val(), 10),
            label = getTargetLabel();

        if (label) {
            label.setProperty('severity', severity);
        }
    }

    /**
     *
     * @param e
     */
    function handleTemporaryProblemCheckboxChange (e) {
        var checked = $(this).is(":checked"),
            label = getTargetLabel();
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
        if (x && y && ('targetLabel' in param)) {
            var labelType = param.targetLabel.getLabelType();
            if (labelType == 'SurfaceProblem' || labelType == 'Obstacle') {
                setStatus('targetLabel', param.targetLabel);
                $menuWindow.css({
                    visibility: 'visible',
                    left: x - windowWidth / 2,
                    top: y + 20
                });

                if (param) {
                    if ('targetLabelColor' in param) { setBorderColor(param.targetLabelColor); }
                }

                setStatus('visibility', 'visible');
            }
        }
    }

    self.hide = hide;
    self.isOpen = isOpen;
    self.show = show;
    return self;
}