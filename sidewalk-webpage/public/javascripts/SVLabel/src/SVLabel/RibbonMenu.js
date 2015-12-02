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
            'disableModeSwitch' : false,
            'lockDisableModeSwitch' : false,
            'mode' : 'Walk',
            'selectedLabelType' : undefined
        };

    // jQuery DOM elements
    var $divStreetViewHolder;
    var $ribbonButtonBottomLines;
    var $ribbonConnector;
    var $spansModeSwitches;


    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function _init () {
        //
        /// Set some of initial properties
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

    function modeSwitch (mode) {
        // This is a callback method that is invoked with a ribbon menu button click
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

            //
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
                    self.setStatus('mode', 'Walk');
                    self.setStatus('selectedLabelType', undefined);
                    if (svl.map) {
                      svl.map.modeSwitchWalkClick();
                    }
                } else {
                    // Switch to labeling mode.
                    self.setStatus('mode', labelType);
                    self.setStatus('selectedLabelType', labelType);
                    if (svl.map) {
                      svl.map.modeSwitchLabelClick();
                    }
                }
            }
            // Set border color

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
        }
    }

    function modeSwitchClickCallback () {
        if (status.disableModeSwitch === false) {
            var labelType;
            labelType = $(this).attr('val');

            //
            // If allowedMode is set, mode ('walk' or labelType) except for
            // the one set is not allowed
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }

            //
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

    ////////////////////////////////////////
    // Public Functions
    ////////////////////////////////////////
    self.backToWalk = function () {
        // This function simulates the click on Walk icon
        modeSwitch('Walk');
        return this;
    };


    self.disableModeSwitch = function () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            if (svl.ui && svl.ui.ribbonMenu) {
              $spansModeSwitches.css('opacity', 0.5);
            }
        }
        return this;
    };

    self.disableLandmarkLabels = function () {
        // This function dims landmark labels and
        // also set status.disableLandmarkLabels to true
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
    };

    self.enableModeSwitch = function () {
        // This method enables mode switch.
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            if (svl.ui && svl.ui.ribbonMenu) {
              $spansModeSwitches.css('opacity', 1);
            }
        }
        return this;
    };

    self.enableLandmarkLabels = function () {
      if (svl.ui && svl.ui.ribbonMenu) {
        $.each($spansModeSwitches, function (i, v) {
            var labelType = $(v).attr('val');
            $(v).css('opacity', 1);
        });
      }
      status.disableLandmarkLabels = false;
      return this;
    };


    self.lockDisableModeSwitch = function () {
        status.lockDisableModeSwitch = true;
        return this;
    };

    self.modeSwitch = function (labelType) {
        // This function simulates the click on a mode switch icon
        modeSwitch(labelType);
    };

    self.modeSwitchClick = function (labelType) {
        // This function simulates the click on a mode switch icon
        // Todo. Deprecated. Delete when you will refactor this code.
        modeSwitch(labelType);
    };


    self.getStatus = function(key) {
            if (key in status) {
                return status[key];
            } else {
              console.warn(self.className, 'You cannot access a property "' + key + '".');
              return undefined;
            }
    };

    self.setAllowedMode = function (mode) {
        // This method sets the allowed mode.
        status.allowedMode = mode;
        return this;
    };

    self.setStatus = function(name, value) {
        try {
            if (name in status) {
                if (name === 'disableModeSwitch') {
                    if (typeof value === 'boolean') {
                        if (value) {
                            self.disableModeSwitch();
                        } else {
                            self.enableModeSwitch();
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

    };

    self.unlockDisableModeSwitch = function () {
        status.lockDisableModeSwitch = false;
        return this;
    };


    _init(params);

    return self;
}
