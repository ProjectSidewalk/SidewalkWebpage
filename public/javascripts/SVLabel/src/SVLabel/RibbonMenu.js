/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RibbonMenu ($, params) {
    var self = { className: 'RibbonMenu'},
        properties = {
            borderWidth : "3px",
            modeSwitchDefaultBorderColor : "rgba(200,200,200,0.75)",
            originalBackgroundColor: "white"
        },
        status = {
            disableModeSwitch: false,
            lockDisableModeSwitch: false,
            mode: 'Walk',
            selectedLabelType: undefined
        },
        blinkInterval;

    function _init () {
        var browser = getBrowser(), labelColors = svl.misc.getLabelColors();
        if (browser === 'mozilla') {
            properties.originalBackgroundColor = "-moz-linear-gradient(center top , #fff, #eee)";
        } else if (browser === 'msie') {
            properties.originalBackgroundColor = "#ffffff";
        } else {
            properties.originalBackgroundColor = "-webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee))";
        }

        // Initialize the jQuery DOM elements
        if (svl.ui && svl.ui.ribbonMenu) {
            // Initialize the color of the lines at the bottom of ribbon menu icons
            $.each(svl.ui.ribbonMenu.bottonBottomBorders, function (i, v) {
                var labelType = $(v).attr("val"), color = labelColors[labelType].fillStyle;
                if (labelType === 'Walk') { $(v).css('width', '56px'); }

                $(v).css('border-top-color', color);
                $(v).css('background', color);
            });

            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);

            svl.ui.ribbonMenu.buttons.bind({
                click: handleModeSwitchClickCallback,
                mouseenter: handleModeSwitchMouseEnter,
                mouseleave: handleModeSwitchMouseLeave
            });
            svl.ui.ribbonMenu.subcategories.on({
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


        // Handle info button click
        svl.ui.ribbonMenu.informationButtons.on("click", handleInfoButtonClick);
    }

    /**
     * This is a callback method that is invoked with a ribbon menu button click
     * @param mode
     */
    function modeSwitch (mode) {
        var labelType = (typeof mode === 'string') ? mode : $(this).attr("val"); // Do I need this???
        svl.tracker.push('ModeSwitch_' + labelType);
        if (status.disableModeSwitch === false) {
            var labelColors, ribbonConnectorPositions, borderColor;

            // Whenever the ribbon menu is clicked, cancel drawing.
            if ('canvas' in svl && svl.canvas && svl.canvas.isDrawing()) {
                svl.canvas.cancelDrawing();
            }

            labelColors = svl.misc.getLabelColors();
            ribbonConnectorPositions = svl.misc.getRibbonConnectionPositions();
            borderColor = labelColors[labelType].fillStyle;

            if ('map' in svl && svl.map) {
                if (labelType === 'Walk') {
                    // Switch to walking mode.
                    setStatus('mode', 'Walk');
                    setStatus('selectedLabelType', undefined);
                    if (svl.map) { svl.map.modeSwitchWalkClick(); }
                } else {
                    // Switch to labeling mode.
                    setStatus('mode', labelType);
                    setStatus('selectedLabelType', labelType);
                    if (svl.map) { svl.map.modeSwitchLabelClick(); }
                }
            }

            if (svl.ui && svl.ui.ribbonMenu) {
                setModeSwitchBorderColors(labelType);
                setModeSwitchBackgroundColors(labelType);


                svl.ui.ribbonMenu.connector.css("left", ribbonConnectorPositions[labelType].labelRibbonConnection);
                svl.ui.ribbonMenu.connector.css("border-left-color", borderColor);
                svl.ui.ribbonMenu.streetViewHolder.css("border-color", borderColor);
            }

            // Set the instructional message
            if (svl.overlayMessageBox) { svl.overlayMessageBox.setMessage(labelType); }

            // Play an audio effect
            if ('audioEffect' in svl) { svl.audioEffect.play('glug1'); }
        }
    }

    function handleInfoButtonClick (e) {
        e.stopPropagation();
        if ("modalExample" in svl) {
            var category = $(this).attr("val");
            svl.modalExample.show(category);
        }
    }

    function handleSubcategoryClick (e) {
        e.stopPropagation();
        var subcategory = $(this).attr("val");
        svl.tracker.push('Click_Subcategory_' + subcategory);
        modeSwitch(subcategory);
        hideSubcategories();
    }

    function handleModeSwitchClickCallback () {
        if (status.disableModeSwitch === false) {
            var labelType = $(this).attr('val');

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) { return false; }

            if (labelType === "Other") { return false; }  // Disable clicking "Other"

            // Track the user action
            svl.tracker.push('Click_ModeSwitch_' + labelType);
            modeSwitch(labelType);
        }
    }

    function handleModeSwitchMouseEnter () {
        if (status.disableModeSwitch === false) {
            // Change the background color and border color of menu buttons
            // But if there is no Bus Stop label, then do not change back ground colors.
            var labelType = $(this).attr("val");

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) { return false; }
            setModeSwitchBackgroundColors(labelType);
            setModeSwitchBorderColors(labelType);

            if (labelType === "Other") { showSubcategories(); }
        }
    }

    function handleModeSwitchMouseLeave () {
        if (status.disableModeSwitch === false) {
            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);
            hideSubcategories();
        }
    }

    function hideSubcategories () {
        svl.ui.ribbonMenu.subcategoryHolder.css('visibility', 'hidden');
    }

    function setModeSwitchBackgroundColors (mode) {
        // background: -moz-linear-gradient(center top , #fff, #eee);
        // background: -webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee));
        if ("ui" in svl && svl.ui && svl.ui.ribbonMenu) {
          var labelType;
          var labelColors;
          var borderColor;
          var browser;
          var backgroundColor;

          labelColors = svl.misc.getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
              labelType = $(v).attr("val");
              if (labelType === mode) {
                  if (labelType === 'Walk') {
                      backgroundColor = "#ccc";
                  } else {
                      backgroundColor = borderColor;
                  }
                  $(this).css({
                      "background" : backgroundColor
                  });
              } else {
                  backgroundColor = properties.originalBackgroundColor;
                  if (labelType !== status.mode) {
                      // Change background color if the labelType is not the currently selected mode.
                      $(this).css({
                          "background" : backgroundColor
                      });
                  }
              }
          });
      }
      return this;
    }

    function setModeSwitchBorderColors (mode) {
        // This method sets the border color of the ribbon menu buttons
        if (svl.ui && svl.ui.ribbonMenu) {
          var labelType, labelColors, borderColor;
          labelColors = svl.misc.getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
              labelType = $(v).attr("val");
              if (labelType=== mode) {
                  $(this).css({
                      "border-color" : borderColor,
                      "border-style" : "solid",
                      "border-width": properties.borderWidth
                  });
              } else {
                  if (labelType !== status.mode) {
                      // Change background color if the labelType is not the currently selected mode.
                      $(this).css({
                          "border-color" : properties.modeSwitchDefaultBorderColor,
                          "border-style" : "solid",
                          "border-width": properties.borderWidth
                      });

                  }
              }
          });
        }
        return this;
    }

    function showSubcategories () {
        svl.ui.ribbonMenu.subcategoryHolder.css('visibility', 'visible');
    }

    /**
     * Changes the mode to "walk"
     * @returns {backToWalk}
     */
    function backToWalk () {
        modeSwitch('Walk');
        return this;
    }

    /**
     * Disable switching modes
     * @returns {disableModeSwitch}
     */
    function disableModeSwitch () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            if (svl.ui && svl.ui.ribbonMenu) {
                svl.ui.ribbonMenu.buttons.css('opacity', 0.5);
            }
        }
        return this;
    }

    /**
     * This function dims landmark labels and also set status.disableLandmarkLabels to true
     * @returns {disableLandmarkLabels}
     */
    function disableLandmarkLabels () {
        if (svl.ui && svl.ui.ribbonMenu) {
            $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
                var labelType = $(v).attr("val");
                if (!(labelType === 'Walk' ||
                    labelType === 'StopSign' ||
                    labelType === 'Landmark_Shelter')
                ) {
                    $(v).css('opacity', 0.5);
                }
            });
        }
        status.disableLandmarkLabels = true;
        return this;
    }

    /**
     * This method enables mode switch.
     * @returns {enableModeSwitch}
     */
    function enableModeSwitch () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            if (svl.ui && svl.ui.ribbonMenu && svl.ui.ribbonMenu.buttons) {
                svl.ui.ribbonMenu.buttons.css('opacity', 1);
            }
        }
        return this;
    }

    /**
     * Enable clicking landmark buttons
     * @returns {enableLandmarkLabels}
     */
    function enableLandmarkLabels () {
        if (svl.ui && svl.ui.ribbonMenu) {
            $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
                $(v).css('opacity', 1);
            });
        }
        status.disableLandmarkLabels = false;
        return this;
    }

    function lockDisableModeSwitch () {
        status.lockDisableModeSwitch = true;
        return this;
    }

    function getStatus (key) {
        if (key in status) {
            return status[key];
        } else {
            console.warn(self.className, 'You cannot access a property "' + key + '".');
            return undefined;
        }
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    function setAllowedMode (mode) {
        // This method sets the allowed mode.
        status.allowedMode = mode;
        return this;
    }

    function setStatus (name, value) {
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
                    status[name] = value;
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

    function startBlinking (labelType, subLabelType) {
        var highlighted = false,
            button = svl.ui.ribbonMenu.holder.find('[val="' + labelType + '"]').get(0),
            dropdown;

        if (subLabelType) {
            dropdown = svl.ui.ribbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
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


    function stopBlinking () {
        clearInterval(blinkInterval);
        svl.ui.ribbonMenu.buttons.css("background",getProperty("originalBackgroundColor"));
        svl.ui.ribbonMenu.subcategories.css("background", "white");
    }

    function unlockDisableModeSwitch () {
        status.lockDisableModeSwitch = false;
        return this;
    }

    self.backToWalk = backToWalk;
    self.disableModeSwitch = disableModeSwitch;
    self.disableLandmarkLabels = disableLandmarkLabels;
    self.enableModeSwitch = enableModeSwitch;
    self.enableLandmarkLabels = enableLandmarkLabels;
    self.lockDisableModeSwitch = lockDisableModeSwitch;
    self.modeSwitch = modeSwitch;
    self.modeSwitchClick = modeSwitch;
    self.getStatus = getStatus;
    self.setAllowedMode = setAllowedMode;
    self.setStatus = setStatus;
    self.startBlinking = startBlinking;
    self.stopBlinking = stopBlinking;
    self.unlockDisableModeSwitch = unlockDisableModeSwitch;


    _init(params);

    return self;
}
