/**
 * RibbonMenu module
 * Todo. Split the RibbonMenu UI component and the label type switching logic
 * Todo. Consider moving this under menu instead of ribbon.
 * @param overlayMessageBox
 * @param tracker
 * @param uiRibbonMenu
 * @returns {{className: string}}
 * @constructor
 */
function RibbonMenu(overlayMessageBox, tracker, uiRibbonMenu) {
    var self = {className: 'RibbonMenu'},
        properties = {
            borderWidth: "3px",
            modeSwitchDefaultBorderColor: "rgba(200,200,200,0.75)",
            originalBackgroundColor: "white"
        },
        status = {
            disableModeSwitch: false,
            lockDisableModeSwitch: false,
            disableMode: {
                Walk: false,
                CurbRamp: false,
                NoCurbRamp: false,
                Obstacle: false,
                SurfaceProblem: false,
                OuterOther: false,
                Occlusion: false,
                NoSidewalk: false,
                Other: false,
            },
            lockDisableMode: false,
            mode: 'Walk',
            selectedLabelType: undefined
        },
        blinkInterval;

    function _init() {
        var browser = getBrowser(),
            labelColors = util.misc.getLabelColors();
        if (browser === 'mozilla') {
            properties.originalBackgroundColor = "-moz-linear-gradient(center top , #fff, #eee)";
        } else if (browser === 'msie') {
            properties.originalBackgroundColor = "#ffffff";
        } else {
            properties.originalBackgroundColor = "-webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee))";
        }

        // Initialize the jQuery DOM elements
        if (uiRibbonMenu) {
            // Initialize the color of the lines at the bottom of ribbon menu icons
            $.each(uiRibbonMenu.bottonBottomBorders, function (i, v) {
                var labelType = $(v).attr("val"), color = labelColors[labelType].fillStyle;
                if (labelType === 'Walk') {
                    $(v).css('width', '56px');
                }

                $(v).css('border-top-color', color);
                $(v).css('background', color);
            });

            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);

            uiRibbonMenu.buttons.bind({
                click: handleModeSwitchClickCallback,
                mouseenter: handleModeSwitchMouseEnter,
                mouseleave: handleModeSwitchMouseLeave
            });
            uiRibbonMenu.subcategories.on({
                click: handleSubcategoryClick
            });
        }

        // Disable mode switch when sign in modal is open
        if ($("#sign-in-modal-container").length != 0) {
            var $signInModalTextBoxes = $("#sign-in-modal-container input[type='text']"),
                $signInModalPassword = $("#sign-in-modal-container input[type='password']");
            $signInModalTextBoxes.on('focus', disableModeSwitch);
            $signInModalTextBoxes.on('blur', enableModeSwitch);
            $signInModalPassword.on('focus', disableModeSwitch);
            $signInModalPassword.on('blur', enableModeSwitch);
        }
    }

    /**
     * This is a callback method that is invoked with a ribbon menu button click
     * @param mode
     */
    function modeSwitch(mode) {
        var labelType = (typeof mode === 'string') ? mode : $(this).attr("val"); // Do I need this???
        tracker.push('ModeSwitch_' + labelType);

        if (status.disableModeSwitch === false || status.disableMode[labelType] === false) {
            // Used to trigger onboarding states
            $(document).trigger('ModeSwitch_' + labelType);

            var labelColors, ribbonConnectorPositions, borderColor;

            // Whenever the ribbon menu is clicked, cancel drawing.
            if ('canvas' in svl && svl.canvas && svl.canvas.isDrawing()) {
                svl.canvas.cancelDrawing();
            }

            labelColors = util.misc.getLabelColors();
            ribbonConnectorPositions = util.misc.getRibbonConnectionPositions();
            borderColor = labelColors[labelType].fillStyle;

            if (labelType === 'Walk') {
                // Switch to walking mode.
                setStatus('mode', 'Walk');
                setStatus('selectedLabelType', undefined);
                if (svl.map) {
                    svl.map.modeSwitchWalkClick();
                }
            } else {
                // Switch to labeling mode.
                setStatus('mode', labelType);
                setStatus('selectedLabelType', labelType);
                if (svl.map) {
                    svl.map.modeSwitchLabelClick();
                }

                // Change cursor before mouse is moved
                if (svl.ui.canvas.drawingLayer) {
                    svl.ui.canvas.drawingLayer.triggerHandler('mousemove');
                }
            }

            if (uiRibbonMenu) {
                setModeSwitchBorderColors(labelType);
                setModeSwitchBackgroundColors(labelType);


                uiRibbonMenu.connector.css("left", ribbonConnectorPositions[labelType].labelRibbonConnection);
                uiRibbonMenu.connector.css("border-left-color", borderColor);
                uiRibbonMenu.streetViewHolder.css("border-color", borderColor);
            }



            // Set the instructional message
            overlayMessageBox.setMessage(labelType);
            overlayMessageBox.setHelpLink(labelType);
        }
    }

    function handleSubcategoryClick(e) {
        e.stopPropagation();
        var subcategory = $(this).attr("val");
        if (status.disableMode[subcategory] === false) {
            tracker.push('Click_Subcategory_' + subcategory);
            svl.keyboardShortcutAlert.modeSwitchButtonClicked(subcategory);
            modeSwitch(subcategory);
            hideSubcategories();
        }
    }

    function handleModeSwitchClickCallback() {
        var labelType = $(this).attr('val');
        if (status.disableModeSwitch === false || status.disableMode[labelType] === false) {

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }

            // Track the user action
            tracker.push('Click_ModeSwitch_' + labelType);
            svl.keyboardShortcutAlert.modeSwitchButtonClicked(labelType);
            modeSwitch(labelType);

            }
    }

    function handleModeSwitchMouseEnter() {
        var labelType = $(this).attr("val");

        var modeDisabled;
        if(svl.isOnboarding() && labelType === "Other") {
            modeDisabled = status.disableMode["OuterOther"];
        } else {
            modeDisabled = status.disableMode[labelType];
        }

        if (status.disableModeSwitch === false || !modeDisabled) {
            // Change the background color and border color of menu buttons
            // But if there is no Bus Stop label, then do not change back ground colors.

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }
            setModeSwitchBackgroundColors(labelType);
            setModeSwitchBorderColors(labelType);

            if (labelType === "Other") {
                showSubcategories();
            }
        }
    }

    function handleModeSwitchMouseLeave() {
        // Always activate during onboarding as everything is disabled
        // So will only be useful for 'Other' dropdown
        if (status.disableModeSwitch === false || svl.isOnboarding()) {
            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);
            hideSubcategories();
        }
    }

    function hideSubcategories() {
        uiRibbonMenu.subcategoryHolder.css('visibility', 'hidden');
    }

    function setModeSwitchBackgroundColors(mode) {
        // background: -moz-linear-gradient(center top , #fff, #eee);
        // background: -webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee));
        if (uiRibbonMenu) {
            var labelType;
            var labelColors;
            var borderColor;
            var browser;
            var backgroundColor;

            labelColors = util.misc.getLabelColors();
            borderColor = labelColors[mode].fillStyle;

            $.each(uiRibbonMenu.buttons, function (i, v) {
                labelType = $(v).attr("val");
                if (labelType === mode) {
                    if (labelType === 'Walk') {
                        backgroundColor = "#ccc";
                    } else {
                        backgroundColor = borderColor;
                    }
                    $(this).css({
                        "background": backgroundColor
                    });
                } else {
                    backgroundColor = properties.originalBackgroundColor;
                    if (labelType !== status.mode) {
                        // Change background color if the labelType is not the currently selected mode.
                        $(this).css({
                            "background": backgroundColor
                        });
                    }
                }
            });
        }
        return this;
    }

    function setModeSwitchBorderColors(mode) {
        // This method sets the border color of the ribbon menu buttons
        if (uiRibbonMenu) {
            var labelType, labelColors, borderColor;
            labelColors = util.misc.getLabelColors();
            borderColor = labelColors[mode].fillStyle;

            $.each(uiRibbonMenu.buttons, function (i, v) {
                labelType = $(v).attr("val");
                if (labelType === mode) {
                    $(this).css({
                        "border-color": borderColor,
                        "border-style": "solid",
                        "border-width": properties.borderWidth
                    });
                } else {
                    if (labelType !== status.mode) {
                        // Change background color if the labelType is not the currently selected mode.
                        $(this).css({
                            "border-color": properties.modeSwitchDefaultBorderColor,
                            "border-style": "solid",
                            "border-width": properties.borderWidth
                        });

                    }
                }
            });
        }
        return this;
    }

    function showSubcategories() {
        uiRibbonMenu.subcategoryHolder.css('visibility', 'visible');
    }

    /**
     * Changes the mode to "walk"
     * @returns {backToWalk}
     */
    function backToWalk() {
        modeSwitch('Walk');
        return this;
    }

    /**
     * Disable switching modes
     * @returns {disableModeSwitch}
     */
    function disableModeSwitch() {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            status.disableMode = {
                Walk: true,
                CurbRamp: true,
                NoCurbRamp: true,
                Obstacle: true,
                SurfaceProblem: true,
                OuterOther: true,
                Occlusion: true,
                NoSidewalk: true,
                Other: true
            };
            if (uiRibbonMenu) {
                uiRibbonMenu.buttons.css('opacity', 0.5);
                uiRibbonMenu.buttons.css('cursor', 'default');

                uiRibbonMenu.subcategories.css('opacity', 0.5);
                uiRibbonMenu.subcategories.css('cursor', 'default');
            }
        }
        return this;
    }

    /**
     * This method disables a specific label type
     * @param labelType
     * @param subLabelType
     */
    function disableMode(labelType, subLabelType) {
        if (!status.lockDisableMode) {
            var button = uiRibbonMenu.holder.find('[val="' + labelType + '"]').get(0),
                dropdown;

            // So that outer category Other is disabled
            if (labelType === "Other") {
                status.disableMode["OuterOther"] = true;
            } else {
                status.disableMode[labelType] = true;
            }

            if (subLabelType) {
                status.disableMode[subLabelType] = true;
                dropdown = uiRibbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
            }

            if (button) {
                $(button).css('opacity', 0.5);
                $(button).css('cursor', 'default');
                if (dropdown) {
                    $(dropdown).css('opacity', 0.5);
                    $(dropdown).css('cursor', 'default');
                }
            }
        }
    }

    /**
     * This method enables mode switch.
     * @returns {enableModeSwitch}
     */
    function enableModeSwitch() {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            status.disableMode = {
                Walk: false,
                CurbRamp: false,
                NoCurbRamp: false,
                Obstacle: false,
                SurfaceProblem: false,
                OuterOther: false,
                Occlusion: false,
                NoSidewalk: false,
                Other: false
            };
            if (uiRibbonMenu) {
                uiRibbonMenu.buttons.css('opacity', 1);
                uiRibbonMenu.buttons.css('cursor', 'pointer');

                uiRibbonMenu.subcategories.css('opacity', 1);
                uiRibbonMenu.subcategories.css('cursor', 'pointer');
                uiRibbonMenu.subcategories.hover(function (e) {
                    $(this).css('background-color', e.type === 'mouseenter' ? '#eee' : 'transparent')
                });

            }
        }
        return this;
    }

    /**
     * This method enables a specific label type
     * @param labelType
     * @param subLabelType
     */
    function enableMode(labelType, subLabelType) {
        if (!status.lockDisableMode) {
            var button = uiRibbonMenu.holder.find('[val="' + labelType + '"]').get(0),
                dropdown;

            // So that sub category Other is not enabled
            if (labelType === "Other") {
                status.disableMode["OuterOther"] = false;
            } else {
                status.disableMode[labelType] = false;
            }

            if (subLabelType) {
                status.disableMode[subLabelType] = false;
                dropdown = uiRibbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
            }

            if (button) {
                $(button).css('opacity', 1);
                $(button).css('cursor', 'pointer');

                if (dropdown) {
                    $(dropdown).css('opacity', 1);
                    $(dropdown).css('cursor', 'pointer');
                }
            }
        }

    }

    function lockDisableModeSwitch() {
        status.lockDisableModeSwitch = true;
        return this;
    }

    function lockDisableMode() {
        status.lockDisableMode = true;
        return this;
    }

    function getStatus(key, subkey) {
        if (key in status) {
            if (subkey) {
                return status[key][subkey];
            } else {
                return status[key];
            }
        } else {
            console.warn(self.className, 'You cannot access a property "' + key + '".');
            return undefined;
        }
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    function setAllowedMode(mode) {
        // This method sets the allowed mode.
        status.allowedMode = mode;
        return this;
    }

    function setStatus(name, value, subname) {
        try {
            if (name in status) {
                if (name === 'disableModeSwitch') {
                    if (typeof value === 'boolean') {
                        if (value) {
                            disableModeSwitch();
                        } else {
                            enableModeSwitch();
                        }
                        return this;
                    } else {
                        return false
                    }
                } else {
                    if (subname) {
                        status[name][subname] = value;
                    } else {
                        status[name] = value;
                    }
                    return this;
                }
            } else {
                var errMsg = '"' + name + '" is not a modifiable status.';
                throw errMsg;
            }
        } catch (e) {
            console.error(self.className, e);
            return false;
        }

    }

    function startBlinking(labelType, subLabelType) {
        var highlighted = false,
            button = uiRibbonMenu.holder.find('[val="' + labelType + '"]').get(0),
            dropdown;

        if (subLabelType) {
            dropdown = uiRibbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
        }

        stopBlinking();
        if (button) {
            blinkInterval = window.setInterval(function () {
                if (highlighted) {
                    highlighted = !highlighted;
                    $(button).css("background", "rgba(255, 255, 0, 1)");
                    if (dropdown) {
                        $(dropdown).css("background", "rgba(255, 255, 0, 1)");
                    }
                    // $(button).css("background", "rgba(255, 255, 166, 1)");
                    // if (dropdown) {
                    //     $(dropdown).css("background", "rgba(255, 255, 166, 1)");
                    // }
                } else {
                    highlighted = !highlighted;
                    $(button).css("background", getProperty("originalBackgroundColor"));
                    if (dropdown) {
                        $(dropdown).css("background", "white");
                    }
                }
            }, 500);
        }
    }


    function stopBlinking() {
        clearInterval(blinkInterval);
        uiRibbonMenu.buttons.css("background", getProperty("originalBackgroundColor"));
        uiRibbonMenu.subcategories.css("background", "white");
    }

    function unlockDisableModeSwitch() {
        status.lockDisableModeSwitch = false;
        return this;
    }

    function unlockDisableMode() {
        status.lockDisableMode = false;
        return this;
    }

    self.backToWalk = backToWalk;
    self.disableModeSwitch = disableModeSwitch;
    self.disableMode = disableMode;
    self.enableModeSwitch = enableModeSwitch;
    self.enableMode = enableMode;
    self.lockDisableMode = lockDisableMode;
    self.lockDisableModeSwitch = lockDisableModeSwitch;
    self.modeSwitch = modeSwitch;
    self.modeSwitchClick = modeSwitch;
    self.getStatus = getStatus;
    self.setAllowedMode = setAllowedMode;
    self.setStatus = setStatus;
    self.startBlinking = startBlinking;
    self.stopBlinking = stopBlinking;
    self.unlockDisableMode = unlockDisableMode;
    self.unlockDisableModeSwitch = unlockDisableModeSwitch;


    _init();

    return self;
}
