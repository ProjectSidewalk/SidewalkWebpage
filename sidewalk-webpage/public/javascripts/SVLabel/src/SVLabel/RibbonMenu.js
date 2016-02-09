var svl = svl || {};

/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RibbonMenu ($, params) {
    var self = { className: 'RibbonMenu' };
    var properties = {
        borderWidth : "3px",
        modeSwitchDefaultBorderColor : "rgba(200,200,200,0.75)",
        originalBackgroundColor: "white"
    };
    var status = {
        disableModeSwitch: false,
        lockDisableModeSwitch: false,
        mode: 'Walk',
        selectedLabelType: undefined
    };

    // jQuery DOM elements
    var $divStreetViewHolder;
    var $ribbonButtonBottomLines;
    var $ribbonConnector;
    var $spansModeSwitches;


    function _init () {
        var browser = getBrowser();
        if (browser === 'mozilla') {
            properties.originalBackgroundColor = "-moz-linear-gradient(center top , #fff, #eee)";
        } else if (browser === 'msie') {
            properties.originalBackgroundColor = "#ffffff";
        } else {
            properties.originalBackgroundColor = "-webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee))";
        }


        var labelColors = svl.misc.getLabelColors();

        //
        // Initialize the jQuery DOM elements
        if (svl.ui && svl.ui.ribbonMenu) {
          // $divStreetViewHolder = $("#Holder_StreetView");

          $divStreetViewHolder = svl.ui.ribbonMenu.streetViewHolder;
          // $ribbonButtonBottomLines = $(".RibbonModeSwitchHorizontalLine");
          $ribbonButtonBottomLines = svl.ui.ribbonMenu.bottonBottomBorders;
          // $ribbonConnector = $("#StreetViewLabelRibbonConnection");
          $ribbonConnector = svl.ui.ribbonMenu.connector;
          // $spansModeSwitches = $('span.modeSwitch');
          $spansModeSwitches = svl.ui.ribbonMenu.buttons;

          //
          // Initialize the color of the lines at the bottom of ribbon menu icons
          $.each($ribbonButtonBottomLines, function (i, v) {
              var labelType = $(v).attr("value");
              var color = labelColors[labelType].fillStyle;
              if (labelType === 'Walk') {
                  $(v).css('width', '56px');
              }

              $(v).css('border-top-color', color);
              $(v).css('background', color);
          });

          setModeSwitchBorderColors(status.mode);
          setModeSwitchBackgroundColors(status.mode);

          $spansModeSwitches.bind('click', modeSwitchClickCallback);
          $spansModeSwitches.bind({
              'mouseenter': modeSwitchMouseEnter,
              'mouseleave': modeSwitchMouseLeave
          });
        }
    }

    /**
     * This is a callback method that is invoked with a ribbon menu button click
     * @param mode
     */
    function modeSwitch (mode) {
        var labelType;

        if (typeof mode === 'string') {
            labelType = mode;
        } else {
            labelType = $(this).attr('val');
        }

        if (status.disableModeSwitch === false) {
            // Check if a bus stop sign is labeled or not.
            // If it is not, do not allow a user to switch to modes other than
            // Walk and StopSign.
            var labelColors;
            var ribbonConnectorPositions;
            var borderColor;

            // Whenever the ribbon menu is clicked, cancel drawing.
            if ('canvas' in svl && svl.canvas && svl.canvas.isDrawing()) {
                svl.canvas.cancelDrawing();
            }

            labelColors = getLabelColors();
            ribbonConnectorPositions = getRibbonConnectionPositions();
            borderColor = labelColors[labelType].fillStyle;

            if ('map' in svl && svl.map) {
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
                }
            }

            if (svl.ui && svl.ui.ribbonMenu) {
              setModeSwitchBorderColors(labelType);
              setModeSwitchBackgroundColors(labelType);
              $ribbonConnector.css("left", ribbonConnectorPositions[labelType].labelRibbonConnection);
              $ribbonConnector.css("border-left-color", borderColor);
              $divStreetViewHolder.css("border-color", borderColor);
            }

            // Set the instructional message
            if (svl.overlayMessageBox) {
                svl.overlayMessageBox.setMessage(labelType);
            }

            if ('audioEffect' in svl) {
                svl.audioEffect.play('glug1');
            }
        }
    }

    function modeSwitchClickCallback () {
        if (status.disableModeSwitch === false) {
            var labelType;
            labelType = $(this).attr('val');

            // If allowedMode is set, mode ('walk' or labelType) except for
            // the one set is not allowed
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }

            // Track the user action
            svl.tracker.push('Click_ModeSwitch_' + labelType);
            modeSwitch(labelType);

        }
    }

    function modeSwitchMouseEnter () {
        if (status.disableModeSwitch === false) {
            // Change the background color and border color of menu buttons
            // But if there is no Bus Stop label, then do not change back ground colors.
            var labelType = $(this).attr("val");

            //
            // If allowedMode is set, mode ('walk' or labelType) except for
            // the one set is not allowed
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }
            setModeSwitchBackgroundColors(labelType);
            setModeSwitchBorderColors(labelType);
        }
    }

    function modeSwitchMouseLeave () {
        if (status.disableModeSwitch === false) {
            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);
        }
    }

    function setModeSwitchBackgroundColors (mode) {
        // background: -moz-linear-gradient(center top , #fff, #eee);
        // background: -webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee));
        if (svl.ui && svl.ui.ribbonMenu) {
          var labelType;
          var labelColors;
          var borderColor;
          var browser;
          var backgroundColor;

          labelColors = getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each($spansModeSwitches, function (i, v) {
              labelType = $(v).attr('val');
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
          labelColors = getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each($spansModeSwitches, function (i, v) {
              labelType = $(v).attr('val');
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

    /**
     * Changes the mode to "walk"
     * @returns {backToWalk}
     */
    function backToWalk () {
        modeSwitch('Walk');
        return this;
    }

    function disableModeSwitch () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            if (svl.ui && svl.ui.ribbonMenu) {
                $spansModeSwitches.css('opacity', 0.5);
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
            $.each($spansModeSwitches, function (i, v) {
                var labelType = $(v).attr('val');
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

    function enableModeSwitch () {
        // This method enables mode switch.
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            if (svl.ui && svl.ui.ribbonMenu) {
                $spansModeSwitches.css('opacity', 1);
            }
        }
        return this;
    }

    function enableLandmarkLabels () {
        if (svl.ui && svl.ui.ribbonMenu) {
            $.each($spansModeSwitches, function (i, v) {
                var labelType = $(v).attr('val');
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
    self.unlockDisableModeSwitch = unlockDisableModeSwitch;


    _init(params);

    return self;
}
