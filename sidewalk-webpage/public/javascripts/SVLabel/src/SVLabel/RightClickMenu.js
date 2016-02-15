var svl = svl || {};

/**
 *
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RightClickMenu (params) {
    var oPublic = {
        'className' : 'RightClickMenu'
        };
    var properties = {

        };
    var status = {
            'currentLabel' : undefined,
            'disableLabelDelete' : false,
            'disableMenuClose' : false,
            'disableMenuSelect' : false,
            'lockDisableMenuSelect' : false,
            'visibilityDeleteMenu' : 'hidden',
            'visibilityBusStopLabelMenu' : 'hidden',
            'visibilityBusStopPositionMenu' : 'hidden',
            'menuPosition' : {
                'x' : -1,
                'y' : -1
            }
        };
    var mouseStatus = {
            currX:0,
            currY:0,
            prevX:0,
            prevY:0,
            leftDownX:0,
            leftDownY:0,
            leftUpX:0,
            leftUpY:0,
            mouseDownOnBusStopLabelMenuBar : false,
            mouseDownOnBusStopPositionMenuBar : false
        };
    var canvas;
    var ribbonMenu;

        // jQuery doms
    // Todo. Do not hard cord dom ids.
    var $divLabelMenu;
    var $divLabelMenuBar;
    var $divDeleteLabelMenu;
    var $divHolderRightClickMenu;
    var $radioBusStopSignTypes;
    var $deleteMenuDeleteButton;
    var $deleteMenuCancelButton;
    var $divBusStopLabelMenuItems;
    var $divBusStopPositionMenu;
    var $divBusStopPositionMenuBar;
    var $divBusStopPositionMenuItems;
    var $btnBusStopPositionMenuBack;
    var $divHolderLabelMenuClose;
    var $divHolderPositionMenuClose;
    var $menuBars;
    var $spanHolderBusStopLabelMenuQuestionMarkIcon;
    var $spanHolderBusStopPositionMenuQuestionMarkIcon;


    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init (params) {
        canvas = params.canvas;
        ribbonMenu = params.ribbonMenu;

        // Todo. Do not hard cord dom ids.
        $divLabelMenu = $("div#labelDrawingLayer_LabelMenu");
        $divLabelMenuBar = $("#labelDrawingLayer_LabelMenuBar");
        $divDeleteLabelMenu = $("div#LabelDeleteMenu");
        $divHolderRightClickMenu = $("div#Holder_RightClickMenu");
        $radioBusStopSignTypes = $("input.Radio_BusStopType");
        $deleteMenuDeleteButton = $("button#LabelDeleteMenu_DeleteButton");
        $deleteMenuCancelButton = $("button#LabelDeleteMenu_CancelButton");

        $divBusStopLabelMenuItems = $(".BusStopLabelMenuItem");
        $divHolderLabelMenuClose = $("#Holder_BusStopLabelMenuOptionCloseIcon");


        // Bus stop relative position menu
        $divBusStopPositionMenu = $("#BusStopPositionMenu");
        $divBusStopPositionMenuBar = $("#BusStopPositionMenu_MenuBar");
        $divBusStopPositionMenuItems = $(".BusStopPositionMenu_MenuItem");
        $btnBusStopPositionMenuBack = $("#BusStopPositinoMenu_BackButton");
        $divHolderPositionMenuClose = $("#Holder_BusStopPositionMenuCloseIcon");

        $menuBars = $(".RightClickMenuBar");

        $spanHolderBusStopLabelMenuQuestionMarkIcon = $('.Holder_BusStopLabelMenuQuestionMarkIcon');
        $spanHolderBusStopPositionMenuQuestionMarkIcon = $('.Holder_BusStopPositionMenuQuestionMarkIcon');

        // Attach listenters
        // $radioBusStopSignTypes.bind('mousedown', radioBusStopSignTypeMouseUp);
        // $deleteMenuDeleteButton.bind('mousedown', deleteMenuDeleteClicked);
        // $deleteMenuCancelButton.bind('mousedown', deleteMenuCancelClicked);

        // Bus stop label menu listeners
        $divBusStopLabelMenuItems.bind('mouseup', divBusStopLabelMenuItemsMouseUp);
        $divBusStopLabelMenuItems.bind('mouseenter', divBusStopLabelMenuItemsMouseEnter);
        $divBusStopLabelMenuItems.bind('mouseleave', divBusStopLabelMenuItemsMouseLeave);

        // Bus stop label menu menu-bar
        $divLabelMenuBar.bind('mousedown', divBusStopLabelMenuBarMouseDown);
        $divLabelMenuBar.bind('mouseup', divBusStopLabelMenuBarMouseUp);
        $divLabelMenuBar.bind('mousemove', divBusStopLabelMenuBarMouseMove);
        $divHolderLabelMenuClose.bind('click', divBusHolderLabelMenuCloseClicked);
        $divHolderLabelMenuClose.bind('mouseenter', divBusHolderLabelMenuCloseMouseEnter);
        $divHolderLabelMenuClose.bind('mouseleave', divBusHolderLabelMenuCloseMouseLeave);

        // Position menu listeners
        $divBusStopPositionMenuItems.bind('mouseup', divBusStopPositionMenuItemsMouseUp);
        $divBusStopPositionMenuItems.bind('mouseenter', divBusStopPositionMenuItemsMouseEnter);
        $divBusStopPositionMenuItems.bind('mouseleave', divBusStopPositionMenuItemsMouseLeave);

        $divBusStopPositionMenuBar.bind('mousedown', divBusStopPositionMenuBarMouseDown);
        $divBusStopPositionMenuBar.bind('mouseup', divBusStopPositionMenuBarMouseUp);
        $divBusStopPositionMenuBar.bind('mousemove', divBusStopPositionMenuBarMouseMove);
        $divHolderPositionMenuClose.bind('click', divBusHolderPositionMenuCloseClicked);
        $divHolderPositionMenuClose.bind('mouseenter', divBusHolderPositionMenuCloseMouseEnter);
        $divHolderPositionMenuClose.bind('mouseleave', divBusHolderPositionMenuCloseMouseLeave);


        // Question marks
        $spanHolderBusStopLabelMenuQuestionMarkIcon.bind({
            'mouseenter' : questionMarkMouseEnter,
            'mouseleave' : questionMarkMouseLeave,
            'mouseup' : questionMarkMouseUp
        });
        $spanHolderBusStopPositionMenuQuestionMarkIcon.bind({
            'mouseenter' : questionMarkMouseEnter,
            'mouseleave' : questionMarkMouseLeave,
            'mouseup' : questionMarkMouseUp
        });
        // menu bars
        $menuBars.bind('mouseenter', menuBarEnter);


        $btnBusStopPositionMenuBack.bind('click', busStopPositionMenuBackButtonClicked);
    }

    function questionMarkMouseEnter (e) {
        $(this).find('.tooltip').css('visibility', 'visible');
    }

    function questionMarkMouseLeave () {
        $(this).find('.tooltip').css('visibility', 'hidden');
    }

    function questionMarkMouseUp (e) {
        // Stopping propagation
        // http://stackoverflow.com/questions/13988427/add-event-listener-to-child-whose-parent-has-event-disabled
        e.stopPropagation();
        var category = $(this).parent().attr('value');
        myExamples.show(category);
    }

    function radioBusStopSignTypeMouseUp (e) {
        // This function is invoked when a user click a radio button in
        // the menu.
        // Show current bus stop label's tag and set subLabelType
        // (e.g. one-leg stop sign, two-leg stop sign)
        // canvas.getCurrentLabel().setStatus('visibilityTag', 'visible');
        oPublic.hideBusStopType();

        // Set the subLabelType of the label (e.g. "StopSign_OneLeg"
        var subLabelType = $(this).attr("val");
        canvas.getCurrentLabel().setSubLabelDescription(subLabelType);
        canvas.clear().render();

        // Snap back to walk mode.
        myMenu.backToWalk();
    }


    ////////////////////////////////////////
    // Private Functions (Bus stop label menu)
    ////////////////////////////////////////
    function menuBarEnter () {
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/openhand.cur) 4 4, move");
    }


    function divBusStopLabelMenuItemsMouseUp () {
        if (!status.disableMenuSelect) {
            // This function is invoked when a user click on a bus stop label menu
            var color, iconImagePath, subLabelType, $menuItem;
            color = svl.misc.getLabelColors()['StopSign'].fillStyle;
            // currentLabel.setStatus('visibilityTag', 'visible');


            // Give a slight mouse click feedback to a user
            $menuItem = $(this);
            $menuItem.css('background','transparent');

            setTimeout(function () {
                $menuItem.css('background', color);
                setTimeout(function() {
                    $menuItem.css('background', 'transparent');

                    // Hide the menu
                    oPublic.hideBusStopType();

                    subLabelType = $menuItem.attr("value");
                    if (!subLabelType) {
                        subLabelType = 'StopSign';
                    }

                    // Set the subLabelType of the label (e.g. "StopSign_OneLeg"
                    status.currentLabel.setSubLabelDescription(subLabelType);
                    iconImagePath = getLabelIconImagePath()[subLabelType].iconImagePath;
                    status.currentLabel.setIconPath(iconImagePath);

                    canvas.clear().render();

                    showBusStopPositionMenu();
                }, 100)
            },100);
        }
    }


    function divBusStopLabelMenuItemsMouseEnter () {
        if (!status.disableMenuSelect) {
            var color = svl.misc.getLabelColors()['StopSign'].fillStyle;
            $(this).css({
                'background': color,
                'cursor' : 'pointer'
            });
            return this;
        }
        return false;
    }


    function divBusStopLabelMenuItemsMouseLeave () {
        if (!status.disableMenuSelect) {
            $(this).css({
                'background' : 'transparent',
                'cursor' : 'default'
            });
            return this;
        }
    }


    //
    // Bus stop label menu menu bar
    //
    function divBusStopLabelMenuBarMouseDown () {
        mouseStatus.mouseDownOnBusStopLabelMenuBar = true;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/closedhand.cur) 4 4, move");
    }


    function divBusStopLabelMenuBarMouseUp () {
        mouseStatus.mouseDownOnBusStopLabelMenuBar = false;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/openhand.cur) 4 4, move");
    }


    function divBusStopLabelMenuBarMouseMove (e) {
        if (mouseStatus.mouseDownOnBusStopLabelMenuBar) {
            var left = $divLabelMenu.css('left');
            var top = $divLabelMenu.css('top');
            var dx, dy;

            top = parseInt(top.replace("px", ""));
            left = parseInt(left.replace("px",""));

            dx = e.pageX - mouseStatus.prevX;
            dy = e.pageY - mouseStatus.prevY;
            left += dx;
            top += dy;

            // console.log(left, top, dx, dy);

            $divLabelMenu.css({
                'left' : left,
                'top' : top
            });
        }
        mouseStatus.prevX = e.pageX;
        mouseStatus.prevY = e.pageY;
    }


    function divBusHolderLabelMenuCloseClicked () {
        // Label menu close is clicked
        // First close the menu, then delete the generated label.
        if (!status.disableMenuClose) {
            var prop;

            // Check if Bus stop type and bus stop position is set.
            // If not, set the label as deleted, so when a user do
            // Undo -> Redo the label will be treated as deleted and won't show up
            if (status.currentLabel) {
                prop = status.currentLabel.getProperties();
                if (prop.labelProperties.busStopPosition === 'DefaultValue' ||
                    prop.labelProperties.subLabelDescription === 'DefaultValue') {
                    myCanvas.removeLabel(status.currentLabel);
                    myActionStack.pop();
                }
            }
            mouseStatus.mouseDownOnBusStopLabelMenuBar = false;
            oPublic.hideBusStopType();
            canvas.enableLabeling();
            myMenu.setStatus('disableModeSwitch', false);
        }
    }


    function divBusHolderLabelMenuCloseMouseEnter () {
        if (!status.disableMenuClose) {
            $(this).css('cursor', 'pointer');
        }
    }


    function divBusHolderLabelMenuCloseMouseLeave () {
        $(this).css('cursor', 'default');
    }


    function divBusStopPositionMenuItemsMouseUp () {
        if (!status.disableMenuSelect) {
            // Set label values
            var busStopPosition, color, currentLabel, $menuItem;
            color = svl.misc.getLabelColors()['StopSign'].fillStyle;

            status.currentLabel.setStatus('visibilityTag', 'visible');

            $menuItem = $(this);
            $menuItem.css('background','transparent');

            // Set bus stop position (e.g. Next
            busStopPosition = $menuItem.attr('value');
            status.currentLabel.setBusStopPosition(busStopPosition);

            setTimeout(function () {
                $menuItem.css('background', color);
                setTimeout(function() {
                    $menuItem.css('background', 'transparent');

                    // Close the menu
                    hideBusStopPositionMenu();
                    // Snap back to walk mode.
                    myMap.enableWalking();
                    myMenu.backToWalk();
                    // myMap.setStatus('disableWalking', false);
                }, 100)
            },100);
        }
    }


    function divBusStopPositionMenuItemsMouseEnter () {
        if (!status.disableMenuSelect) {
            var color = svl.misc.getLabelColors()['StopSign'].fillStyle;
            $(this).css({
                'background': color,
                'cursor' : 'pointer'
            });
            return this;
        }
    }


    function divBusStopPositionMenuItemsMouseLeave () {
        if (!status.disableMenuSelect) {
            $(this).css({
                'background': 'transparent',
                'cursor' : 'default'
            });
            return this;
        }
    }


    function divBusHolderPositionMenuCloseMouseEnter () {
        if (!status.disableMenuClose) {
            $(this).css({
                'cursor' : 'pointer'
            });
        }
    }


    function divBusHolderPositionMenuCloseMouseLeave () {
        $(this).css({
            'cursor' : 'default'
        });
    }


    function divBusHolderPositionMenuCloseClicked () {
        // Label position menu close is clicked
        // First close the menu, then delete the generated label.
        if (!status.disableMenuClose &&
            status.currentLabel) {
            var prop;

            // Check if Bus stop type and bus stop position is set.
            // If not, set the label as deleted, so when a user do
            // Undo -> Redo the label will be treated as deleted and won't show up
            prop = status.currentLabel.getProperties();
            if (prop.labelProperties.busStopPosition === 'DefaultValue' ||
                prop.labelProperties.subLabelDescription === 'DefaultValue') {
                myCanvas.removeLabel(status.currentLabel);
                myActionStack.pop();
            }

            // Hide the menu
            mouseStatus.mouseDownOnBusStopPositionMenuBar = false;
            hideBusStopPositionMenu();
            canvas.enableLabeling();
            myMenu.setStatus('disableModeSwitch', false);
        }
    }


    //
    // Menu bar
    //
    function divBusStopPositionMenuBarMouseDown (e) {
        mouseStatus.mouseDownOnBusStopPositionMenuBar = true;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/closedhand.cur) 4 4, move");
    }


    function divBusStopPositionMenuBarMouseUp (e) {
        mouseStatus.mouseDownOnBusStopPositionMenuBar = false;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/openhand.cur) 4 4, move");
    }


    function divBusStopPositionMenuBarMouseMove (e) {
        if (mouseStatus.mouseDownOnBusStopPositionMenuBar) {
            var left = $divBusStopPositionMenu.css('left');
            var top = $divBusStopPositionMenu.css('top');
            var dx, dy;

            top = parseInt(top.replace("px", ""));
            left = parseInt(left.replace("px",""));

            dx = e.pageX - mouseStatus.prevX;
            dy = e.pageY - mouseStatus.prevY;
            left += dx;
            top += dy;

            // console.log(left, top, dx, dy);

            $divBusStopPositionMenu.css({
                'left' : left,
                'top' : top
            });
        }
        mouseStatus.prevX = e.pageX;
        mouseStatus.prevY = e.pageY;
    }

    function hideBusStopPositionMenu () {
        status.visibilityBusStopPositionMenu = 'hidden';

        $divHolderRightClickMenu.css('visibility', 'hidden');
        $divBusStopPositionMenu.css('visibility', 'hidden');

        if (oPublic.isAllClosed()) {
            canvas.setStatus('disableLabeling', false);
            myMenu.setStatus('disableModeSwitch', false);

            status.disableLabelDelete = false;
            status.currentLabel = undefined;

            myActionStack.unlockDisableRedo().enableRedo().lockDisableRedo();
            myActionStack.unlockDisableUndo().enableUndo().lockDisableUndo();
            myForm.unlockDisableSubmit().enableSubmit().lockDisableSubmit();
            myForm.unlockDisableNoBusStopButton().enableNoBusStopButton().lockDisableNoBusStopButton();
        }
    }


    function showBusStopPositionMenu () {
        var menuX = status.menuPosition.x,
            menuY = status.menuPosition.y;
        status.visibilityBusStopPositionMenu = 'visible';

        // Show the right-click menu layer
        // $divHolderRightClickMenu.css('visibility', 'visible');


        // Set the menu bar color
        $divBusStopPositionMenuBar.css({
            'background' : svl.misc.getLabelColors()['StopSign'].fillStyle
        });


        // If menu position is to low or to much towards right,
        // adjust the position
        if (menuX > 400) {
            menuX -= 300;
        }
        if (menuY > 300) {
            menuY -= 200;
        }

        // Show the bus stop position menu
        $divBusStopPositionMenu.css({
            'visibility': 'visible',
            'position' : 'absolute',
            'left' : menuX,
            'top' : menuY,
            'z-index' : 4
        });

        canvas.setStatus('visibilityMenu', 'visible');
        canvas.disableLabeling();
        myMenu.setStatus('disableModeSwitch', true);
        myActionStack.unlockDisableRedo().disableRedo().lockDisableRedo();
        myActionStack.unlockDisableUndo().disableUndo().lockDisableUndo();
    }


    //
    // Back button
    //
    function busStopPositionMenuBackButtonClicked () {
        // Hide bus stop position menu and show sign label menu.
        var currentLabel = status.currentLabel;
        hideBusStopPositionMenu();
        oPublic.showBusStopType(currentLabel.getCoordinate().x, currentLabel.getCoordinate().y);
    }


    ////////////////////////////////////////
    // Private Functions (Deleting labels)
    ////////////////////////////////////////
    function deleteMenuDeleteClicked() {
        canvas.removeLabel(canvas.getCurrentLabel());
        oPublic.hideDeleteLabel();
        myActionStack.push('deleteLabel', canvas.getCurrentLabel());
    }


    function deleteMenuCancelClicked () {
        oPublic.hideDeleteLabel();
    }


    ////////////////////////////////////////
    // oPublic functions
    ////////////////////////////////////////
    oPublic.close = function () {
        // Esc pressed. close all menu windows
        divBusHolderLabelMenuCloseClicked();
        divBusHolderPositionMenuCloseClicked();
    };


    oPublic.disableMenuClose = function () {
        status.disableMenuClose = true;
        return this;
    };


    oPublic.disableMenuSelect = function () {
        if (!status.lockDisableMenuSelect) {
            status.disableMenuSelect = true;
        }
        return this;
    };


    oPublic.enableMenuClose = function () {
        status.disableMenuClose = false;
        return this;
    };


    oPublic.enableMenuSelect = function () {
        if (!status.lockDisableMenuSelect) {
            status.disableMenuSelect = false;
        }
        return this;
    };


    oPublic.getMenuPosition = function () {
        return {
            x : status.menuPosition.x,
            y : status.menuPosition.y
        };
    };


    oPublic.hideBusStopPosition = function () {
        // Hide the right click menu for choosing a bus stop position.
        hideBusStopPositionMenu();
        return this;
    };


    oPublic.hideBusStopType = function () {
        // Hide the right click menu for choosing a bus stop type.

        // Hide the right-click menu layer
        $divHolderRightClickMenu.css('visibility', 'hidden');

        // Hide the bus stop label menu
        $divLabelMenu.css('visibility', 'hidden');
        status.visibilityBusStopLabelMenu = 'hidden';

        canvas.setStatus('visibilityMenu', 'hidden');

        if (oPublic.isAllClosed()) {
            myActionStack.unlockDisableRedo().enableRedo().lockDisableRedo();
            myActionStack.unlockDisableUndo().enableUndo().lockDisableUndo();
            myForm.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
            myForm.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();
        }
    };


    oPublic.hideDeleteLabel = function () {
        // Hide the right-click menu layer
        $divHolderRightClickMenu.css('visibility', 'hidden');
        status.visibilityDeleteMenu = 'hidden';

        $divDeleteLabelMenu.css('visibility', 'hidden');
        canvas.setStatus('visibilityMenu', 'hidden');

        if (oPublic.isAllClosed()) {
            canvas.enableLabeling();
            myMenu.setStatus('disableModeSwitch', false);
        }
    };


    oPublic.isAllClosed = function () {
        // This function checks if all the menu windows are hidden and return true/false
        if (status.visibilityBusStopLabelMenu === 'hidden' &&
            status.visibilityDeleteMenu === 'hidden' &&
            status.visibilityBusStopPositionMenu === 'hidden') {
            return true;
        } else {
            return false;
        }
    };


    oPublic.isAnyOpen = function () {
        // This function checks if any menu windows is open and return true/false
        return !oPublic.isAllClosed();
    };


    oPublic.lockDisableMenuSelect = function () {
        status.lockDisableMenuSelect = true;
        return this;
    };

    oPublic.setStatus = function (key, value) {
        if (key in status) {
            if (key === 'disableMenuClose') {
                if (typeof value === 'boolean') {
                    if (value) {
                        oPublic.enableMenuClose();
                    } else {
                        oPublic.disableMenuClose();
                    }
                    return this;
                } else {
                    return false;
                }
            } else {
                status[key] = value;
                return this;
            }
        }
        return false;
    };


    oPublic.showBusStopType = function (x, y) {
        status.currentLabel = canvas.getCurrentLabel();

        if (status.currentLabel &&
            status.currentLabel.getLabelType() === 'StopSign') {
            // Show bus stop label menu
            var menuX, menuY;

            // Show the right-click menu layer
            $divHolderRightClickMenu.css('visibility', 'visible');
            status.visibilityBusStopLabelMenu = 'visible';

            // Set the menu bar color
            $divLabelMenuBar.css({
                'background' : svl.misc.getLabelColors()['StopSign'].fillStyle
            });


            menuX = x + 25;
            menuY = y + 25;

            // If menu position is to low or to much towards right,
            // adjust the position
            if (menuX > 400) {
                menuX -= 300;
            }
            if (menuY > 300) {
                menuY -= 200;
            }

            status.menuPosition.x = menuX;
            status.menuPosition.y = menuY;

            // Show the bus stop label menu
            $divLabelMenu.css({
                'visibility' : 'visible',
                'position' : 'absolute',
                'left' : menuX,
                'top' : menuY,
                'z-index' : 4
            });
            status.visibilityBusStopLabelMenu = 'visible';

            canvas.setStatus('visibilityMenu', 'visible');
            canvas.setStatus('disableLabeling', true);
            canvas.disableLabeling();
            myMap.setStatus('disableWalking', true);
            myMenu.setStatus('disableModeSwitch', true);
        }

    };


    oPublic.showDeleteLabel = function (x, y) {
        // This function shows a menu to delete a label that is in
        // canvas and under the current cursor location (x, y)
        var menuX, menuY;

        if (!status.disableLabelDelete) {
            // Show the right-click menu layer
            $divHolderRightClickMenu.css('visibility', 'visible');


            menuX = x - 5;
            menuY = y - 5

            $divDeleteLabelMenu.css({
                'visibility' : 'visible',
                'position' : 'absolute',
                'left' : menuX,
                'top' : menuY,
                'z-index' : 4
            });
            status.visibilityDeleteMenu = 'visible';

            status.visibilityMenu = 'visible';
            status.disableLabeling = true;
            // myMap.setStatus('disableWalking', true);
            myMenu.setStatus('disableModeSwitch', true);
        }
    };


    oPublic.unlockDisableMenuSelect = function () {
        status.lockDisableMenuSelect = false;
        return this;
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init(params);
    return oPublic;
}
