/**
 * Context Menu module. Responsible for displaying the context menu when clicking on a label on the canvas.
 * @param uiContextMenu
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ContextMenu (uiContextMenu) {
    var self = { className: "ContextMenu" },
        status = {
            targetLabel: null,
            visibility: 'hidden',
            disableTagging: false
        };
    var $menuWindow = uiContextMenu.holder;
    var $connector = uiContextMenu.connector;
    var $severityMenu = uiContextMenu.severityMenu;
    var $severityButtons = uiContextMenu.radioButtons;
    var $temporaryLabelCheckbox = uiContextMenu.temporaryLabelCheckbox;
    var $descriptionTextBox = uiContextMenu.textBox;
    var windowWidth = $menuWindow.width();
    var $OKButton = $menuWindow.find("#context-menu-ok-button");
    var $radioButtonLabels = $menuWindow.find(".radio-button-labels");
    var $tagHolder = uiContextMenu.tagHolder;
    var $tags = uiContextMenu.tags;
    var lastShownLabelColor;

    var CONNECTOR_BUFFER = 6; // Buffer for connector to overlap border of label icon.

    document.addEventListener('mousedown', _handleMouseDown);
    $menuWindow.on('mousedown', _handleMenuWindowMouseDown);
    $severityButtons.on('change', _handleSeverityChange);
    $temporaryLabelCheckbox.on('change', _handleTemporaryLabelCheckboxChange);
    $descriptionTextBox.on('change', _handleDescriptionTextBoxChange);
    $descriptionTextBox.on('focus', _handleDescriptionTextBoxFocus);
    $descriptionTextBox.on('blur', _handleDescriptionTextBoxBlur);
    uiContextMenu.closeButton.on('click', _handleCloseButtonClick);
    $OKButton.on('click', _handleOKButtonClick);
    $tags.on('click', _handleTagClick);

    function checkRadioButton(value) {
        uiContextMenu.radioButtons
            .filter(function() { return parseInt(this.value) === value })
            .prop("checked", true)
            .trigger("click", { lowLevelLogging: false });
    }

    function getStatus(key) { return status[key]; }
    function setStatus(key, value) { status[key] = value; }

    function getTargetLabel() { return status.targetLabel; }

    /**
     * Combined with document.addEventListener("mousedown", _handleMouseDown), this method will close the context menu
     * window when user clicks somewhere on the window except for the area on the context menu window.
     * @param e
     */
    function _handleMenuWindowMouseDown(e) {
        e.stopPropagation();
    }

    /**
     * Handles clicking outside of context menu holder. If so, close the context menu and note if user rated severity.
     * @param e
     */
    function _handleMouseDown(e) {
        var clickedOut = !($menuWindow[0].contains(e.target));
        var clickedDelete = svl.ui.canvas.deleteIcon[0].contains(e.target);
        if (isOpen()) {
            if (clickedOut) {
                svl.tracker.push('ContextMenu_CloseClickOut');
                handleSeverityPopup();
            }
            hide(clickedDelete);
        }
    }

    function _handleDescriptionTextBoxChange(e) {
        var description = $(this).val();
        svl.tracker.push('ContextMenu_TextBoxChange', { Description: description });
        if (status.targetLabel) {
            status.targetLabel.setProperty('description', description);
        }
    }

    function _handleDescriptionTextBoxBlur() {
        svl.tracker.push('ContextMenu_TextBoxBlur');
        svl.ribbon.enableModeSwitch();
        svl.keyboard.setStatus('focusOnTextField', false);
    }

    function _handleDescriptionTextBoxFocus() {
        svl.tracker.push('ContextMenu_TextBoxFocus');
        svl.ribbon.disableModeSwitch();
        svl.keyboard.setStatus('focusOnTextField', true);
    }

    function _handleCloseButtonClick() {
        svl.tracker.push('ContextMenu_CloseButtonClick');
        handleSeverityPopup();
        hide(false);
    }

    // Sends the last label's data to the prediction model and shows the popup UI if the prediction model flags it.
    function predictLabelCorrectnessAndShowUI() {

        // Package the data to send to the prediction model.
        const currentLabelProps = status.targetLabel.getProperties();
        const data = {
            temporaryLabelId: currentLabelProps.temporaryLabelId,
            labelType: currentLabelProps.labelType,
            severity: currentLabelProps.severity,
            zoom: currentLabelProps.originalPov.zoom,
            hasTags: currentLabelProps.tagIds.length > 0,
            lat: currentLabelProps.labelLat,
            lng: currentLabelProps.labelLng,
            hasDescription: (currentLabelProps.description && currentLabelProps.description.length > 0) ? true : false,
        };

        // Check if the prediction model flags this.
        svl.predictionModel.predictAndShowUI(data, status.targetLabel, svl);
    }

    function _handleOKButtonClick() {
        svl.tracker.push('ContextMenu_OKButtonClick');
        handleSeverityPopup();
        hide(false);
    }

    function handleSeverityPopup() {
        var labels = svl.labelContainer.getAllLabels();
        if (labels.length > 0) {
            var lastLabelProps = labels[labels.length - 1].getProperties();
            // If the label is Pedestrian Signal, do not call ratingReminderAlert().
            if (lastLabelProps.labelType !== 'Signal') {
                svl.ratingReminderAlert.ratingClicked(lastLabelProps.severity);
            }
        }
    }

    function _handleSeverityChange(e) {
        var severity = parseInt($(this).val(), 10);
        var label = status.targetLabel;
        svl.tracker.push('ContextMenu_RadioChange', { LabelType: label.getLabelType(), RadioValue: severity });

        self.updateRadioButtonImages();
        if (label) {
            label.setProperty('severity', severity);
            svl.canvas.clear().render();
        }
    }

    function fetchLabelTags(callback) {
        $.when($.ajax({
            contentType: 'application/json; charset=utf-8',
            url: "/label/tags",
            type: 'get',
            success: function(json) {
                self.labelTags = json;
            },
            error: function(result) {
                throw result;
            }
        })).done(callback);
    }

    function updateRadioButtonImages() {
        $('#severity-radio-holder .severity-level').removeClass('selected');

        // Update the selected radio button image.
        const $selectedRadioButtonImage = $radioButtonLabels.find("input:checked").closest('.severity-level');
        $selectedRadioButtonImage.addClass('selected');
    }

    /**
     * Records tag ID when clicked and updates tag color.
     */
    function _handleTagClick(e) {
        var labelTags = status.targetLabel.getProperty('tagIds');

        // Use position of cursor to determine whether the click came from the mouse or from a keyboard shortcut.
        var wasClickedByMouse = e.hasOwnProperty("originalEvent") &&
            e.originalEvent.clientX !== 0
            && e.originalEvent.clientY !== 0;

        $("body").unbind('click').on('click', 'button', function(e) {
            if (e.target.name === 'tag') {
                // Get the tag_id from the clicked tag's class name (e.g., "tag-id-9").
                var currTagId = parseInt($(e.target).attr('class').split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0].match(/\d+/)[0], 10);
                var tag = self.labelTags.filter(tag => tag.tag_id === currTagId)[0];

                // Adds or removes tag from the label's current list of tags.
                if (!labelTags.includes(tag.tag_id)) {
                    // Deals with 'no alternate route' and 'alternate route present' being mutually exclusive.
                    var alternateRoutePresentId = self.labelTags.filter(tag => tag.tag === 'alternate route present')[0].tag_id;
                    var noAlternateRouteId = self.labelTags.filter(tag => tag.tag === 'no alternate route')[0].tag_id;
                    // Automatically deselect one of the tags above if the other one is selected.
                    if (currTagId === alternateRoutePresentId) {
                        labelTags = _autoRemoveAlternateTagAndUpdateUI(noAlternateRouteId, labelTags);
                    } else if (currTagId === noAlternateRouteId) {
                        labelTags = _autoRemoveAlternateTagAndUpdateUI(alternateRoutePresentId, labelTags);
                    }

                    // Deals with 'street has a sidewalk' and 'street has no sidewalks' being mutually exclusive.
                    var streetHasOneSidewalkId = self.labelTags.filter(tag => tag.tag === 'street has a sidewalk')[0].tag_id;
                    var streetHasNoSidewalksId = self.labelTags.filter(tag => tag.tag === 'street has no sidewalks')[0].tag_id;
                    // Automatically deselect one of the tags above if the other one is selected.
                    if (currTagId === streetHasOneSidewalkId) {
                        labelTags = _autoRemoveAlternateTagAndUpdateUI(streetHasNoSidewalksId, labelTags);
                    } else if (currTagId === streetHasNoSidewalksId) {
                        labelTags = _autoRemoveAlternateTagAndUpdateUI(streetHasOneSidewalkId, labelTags);
                    }

                    // Log the tag click.
                    labelTags.push(tag.tag_id);
                    if (wasClickedByMouse) {
                        svl.tracker.push('ContextMenu_TagAdded', { tagId: tag.tag_id, tagName: tag.tag });
                    } else {
                        svl.tracker.push('KeyboardShortcut_TagAdded', { tagId: tag.tag_id, tagName: tag.tag });
                    }
                } else {
                    var index = labelTags.indexOf(tag.tag_id);
                    labelTags.splice(index, 1);
                    if (wasClickedByMouse) {
                        svl.tracker.push('ContextMenu_TagRemoved', { tagId: tag.tag_id, tagName: tag.tag });
                    } else {
                        svl.tracker.push('KeyboardShortcut_TagRemoved', { tagId: tag.tag_id, tagName: tag.tag });
                    }
                }
                _toggleTagColor(labelTags, tag.tag_id, e.target);
                status.targetLabel.setProperty('tagIds', labelTags);
                e.target.blur();
                $tagHolder.trigger('tagIds-updated'); // For events that depend on up-to-date tagIds.
            }
        });
    }

    /**
     * Remove the alternate tag, update UI, and add the selected tag.
     * @param {*} tagId      The name of the tag to be removed.
     * @param {*} labelTags  List of tags that the current label has.
     */
    function _autoRemoveAlternateTagAndUpdateUI(tagId, labelTags) {
        // Find the tag that has the class named "tag-id-<tagId>" and change it's background color.
        $tags.each((index, tag) => {
            var classWithTagId = tag.className.split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0];
            if (classWithTagId !== undefined && parseInt(classWithTagId.match(/\d+/)[0], 10) === tagId) {
                tag.style.backgroundColor = "white";
            }
        });

        // Remove tag from list of tags and log the automated removal.
        self.labelTags.forEach(tag => {
            if (tag.tag_id === tagId && labelTags.includes(tagId)) {
                labelTags.splice(labelTags.indexOf(tag.tag_id), 1);
                svl.tracker.push('ContextMenu_TagAutoRemoved', { tagId: tag.tag_id, tagName: tag.tag });
            }
        });
        return labelTags;
    }

    function _handleTemporaryLabelCheckboxChange(e) {
        var checked = $(this).is(":checked");
        svl.tracker.push('ContextMenu_CheckboxChange', { checked: checked });

        if (status.targetLabel) {
            status.targetLabel.setProperty('temporaryLabel', checked);
        }
    }

    /**
     * Hide the context menu.
     * @param clickedDelete Whether we are closing the menu bc the label is being deleted. If so, don't run prediction.
     */
    function hide(clickedDelete) {
        if (isOpen()) {
            $descriptionTextBox.blur(); // Force the blur event before the ContextMenu close event.
            svl.tracker.push('ContextMenu_Close');
        }

        $menuWindow.css('visibility', 'hidden');
        $connector.css('visibility', 'hidden');
        _setBorderColor('black');
        setStatus('visibility', 'hidden');

        // Check if we should try to predict label correctness. It's experimental, so show only on crowdstudy server.
        // No need to predict correctness if the user is in the tutorial or if it's already been done for this label.
        if (svl.usingPredictionModel()
            && !svl.isOnboarding()
            && !status.targetLabel.getProperty('predictionMade')
            && !clickedDelete
            && svl.predictionModel.isPredictionSupported(status.targetLabel.getLabelType())) {
            status.targetLabel.setProperty('predictionMade', true);
            predictLabelCorrectnessAndShowUI();
        }

        return this;
    }

    /**
     * Checks if the menu is open or not.
     * @returns {boolean}
     */
    function isOpen() {
        return getStatus('visibility') === 'visible';
    }

    /**
     * Set the border color of the menu window.
     * @param color
     */
    function _setBorderColor(color) {
        $menuWindow.css('border-color', color);
        $connector.css('background-color', color);
    }

    /**
     * Disable tagging. Adds the disabled visual effects to the tags on current context menu.
     */
    function disableTagging() {
        setStatus('disableTagging', true);
        $("body").find("button[name=tag]").each(function(t) {
            $(this).addClass('disabled');
        });
    }

    /**
     * Enable tagging. Removes the disabled visual effects to the tags on current context menu.
     */
    function enableTagging() {
        setStatus('disableTagging', false);
        $("body").find("button[name=tag]").each(function(t) {
            $(this).removeClass('disabled');
        });
    }

    /**
     * Returns true if tagging is currently disabled.
     */
    function isTaggingDisabled() {
        return getStatus('disableTagging');
    }

    /**
     * Sets the color of a label's tags based off of tags that were previously chosen.
     * @param label     Current label being modified.
     */
    function _setTagColor(label) {
        var labelTags = label.getProperty('tagIds');
        $("body").find("button[name=tag]").each(function(t) {
            var buttonText = $(this).text();
            if (buttonText) {
                var tagId = parseInt($(this).attr('class').split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0].match(/\d+/)[0], 10);

                // Sets color to be white or gray if the label tag has been selected.
                if (labelTags.includes(tagId)) {
                    $(this).css('background-color', 'rgb(200, 200, 200)');
                } else {
                    $(this).css('background-color', 'white');
                }
            }
        });
    }

    /**
     * Sets the description and value of the tag based on the label type.
     * @param label Current label being modified.
     */
    function _setTags(label) {
        var maxTags = 17;
        if (label) {
            var labelTags = self.labelTags;
            if (labelTags) {
                var count = 0;

                // Go through each label tag, modify each button to display tag.
                labelTags.forEach(function(tag) {
                    if (tag.label_type === label.getProperty('labelType')) {
                        var buttonIndex = count; // Save index in a separate var b/c tooltips are added asynchronously.

                        // Remove all leftover tags from last labeling.
                        // Warning to future devs: will remove any other classes you add to the tags.
                        $tagHolder.find("button[id=" + buttonIndex + "]").attr('class', 'context-menu-tag');

                        // Add tag id as a class so that finding the element is easier later.
                        $tagHolder.find("button[id=" + buttonIndex + "]").addClass("tag-id-" + tag.tag_id);

                        // Set tag texts to new underlined version as defined in the util label description map.
                        var tagText = util.misc.getLabelDescriptions(tag.label_type)['tagInfo'][tag.tag]['text'];
                        $tagHolder.find("button[id=" + buttonIndex + "]").html(tagText);

                        $tagHolder.find("button[id=" + buttonIndex + "]").css({
                            visibility: 'inherit', position: 'inherit'
                        });

                        // Remove old tooltip for that button.
                        $tagHolder.find("button[id=" + buttonIndex + "]").tooltip("destroy");

                        // Add tooltip with tag example if we have an example image to show.
                        var imageUrl = `/assets/javascripts/SVLabel/img/label_tag_popups/${tag.tag_id}.png`;
                        util.getImage(imageUrl).then(img => {
                            // Convert the first letter of tag text to uppercase and get keyboard shortcut character.
                            const underlineClassOffset = 15;
                            var keyChar;
                            var tooltipHeader;
                            // If first letter is used for shortcut, the string will start with "<tag-underline".
                            if (tagText[0] === '<') {
                                keyChar = tagText[underlineClassOffset];
                                tooltipHeader = tagText.substring(0,underlineClassOffset) +
                                    tagText[underlineClassOffset].toUpperCase() +
                                    tagText.substring(underlineClassOffset + 1);
                            } else {
                                let underlineIndex = tagText.indexOf('<');
                                keyChar = tagText[underlineIndex + underlineClassOffset];
                                tooltipHeader = tagText[0].toUpperCase() + tagText.substring(1);
                            }
                            var tooltipFooter = i18next.t('center-ui.context-menu.label-popup-shortcuts', {c: keyChar});
                            var tooltipImage = `<img src="${img}" height="125"/>`

                            // Create the tooltip.
                            $tagHolder.find("button[id=" + buttonIndex + "]").tooltip(({
                                placement: 'top',
                                html: true,
                                delay: {"show": 300, "hide": 10},
                                height: '130',
                                title: `${tooltipHeader}<br/>${tooltipImage}<br/> <i>${tooltipFooter}</i>`
                            })).tooltip("show").tooltip("hide");
                        });

                        count += 1;
                    }
                });

                // If number of tags is less than the max number of tags, hide button.
                var i = count;
                for (i; i < maxTags; i++) {
                    $("body").find("button[id=" + i + "]").css({
                        visibility: 'hidden',
                        position: 'absolute',
                        top: '0px',
                        left: '0px'
                    });
                }
            }
        }
    }

    /**
     * Set context menu severity tooltips to the correct text/images for the given label type.
     * @param labelType
     * @private
     */
    function _setSeverityTooltips(labelType) {
        var sevTooltipOne = $('#severity-one');
        var sevTooltipThree = $('#severity-three');
        var sevTooltipFive = $('#severity-five');
        var sevImgUrlOne = `/assets/javascripts/SVLabel/img/severity_popups/${labelType}_Severity1.png`
        var sevImgUrlThree = `/assets/javascripts/SVLabel/img/severity_popups/${labelType}_Severity3.png`
        var sevImgUrlFive = `/assets/javascripts/SVLabel/img/severity_popups/${labelType}_Severity5.png`

        // Remove old tooltips.
        sevTooltipOne.tooltip('destroy');
        sevTooltipThree.tooltip('destroy');
        sevTooltipFive.tooltip('destroy');

        // Add severity tooltips for the current label type if we have images for them.
        util.getImage(sevImgUrlOne).then(img => {
            var tooltipHeader = i18next.t('center-ui.context-menu.severity-example', { n: 1 });
            var tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
            sevTooltipOne.tooltip({
                placement: "top", html: true, delay: {"show": 300, "hide": 10},
                title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
            });
        });
        util.getImage(sevImgUrlThree).then(img => {
            var tooltipHeader = i18next.t('center-ui.context-menu.severity-example', { n: 3 });
            var tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
            sevTooltipThree.tooltip({
                placement: "top", html: true, delay: {"show": 300, "hide": 10},
                title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
            });
        });
        util.getImage(sevImgUrlFive).then(img => {
            var tooltipHeader = i18next.t('center-ui.context-menu.severity-example', { n: 5 });
            var tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
            sevTooltipFive.tooltip({
                placement: "top", html: true, delay: {"show": 300, "hide": 10},
                title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
            });
        });
    }

    /**
     * Show the context menu.
     * @param targetLabel the label whose context menu should be shown.
     */
    function show(targetLabel) {
        setStatus('targetLabel', null);
        $severityButtons.prop('checked', false);
        $temporaryLabelCheckbox.prop('checked', false);
        $descriptionTextBox.val(null);

        var labelType = targetLabel.getLabelType();
        var labelColor = util.misc.getLabelColors()[labelType].fillStyle;
        var labelCoord = targetLabel.getCanvasXY();

        // Disable nav arrows on crowdstudy server so users can't skip pred model UI by clicking on arrows.
        if (svl.usingPredictionModel() && svl.predictionModel.isPredictionSupported(labelType)) {
            svl.map.disableWalking();
        }
        if (labelType !== 'Occlusion') {
            setStatus('targetLabel', targetLabel);
            _setTags(targetLabel);
            _setTagColor(targetLabel);
            if (getStatus('disableTagging')) { disableTagging(); }

            // Hide the severity menu for the Pedestrian Signal label type.
            if (labelType === 'Signal') {
                $severityMenu.css({visibility: 'hidden', height: '0px'});
            } else {
                $severityMenu.css({visibility: 'inherit', height: '50px'});
            }
            var menuHeight = $menuWindow.outerHeight();

            var connectorHeight = parseInt(window.getComputedStyle($connector[0]).getPropertyValue("height"));
            var connectorWidth = parseInt(window.getComputedStyle($connector[0]).getPropertyValue("width"));
            var menuBorder = parseInt(window.getComputedStyle($menuWindow[0]).getPropertyValue("border-radius"));

            // Determine coordinates for context menu to display below the label.
            var topCoordinate = labelCoord.y + svl.LABEL_ICON_RADIUS + connectorHeight - CONNECTOR_BUFFER;
            var connectorCoordinate = menuBorder - connectorHeight;

            // If there isn't enough room to show the context menu below the label, determine coords to display above.
            // labelCoord.y is top-left of label but is center of rendered label, so we must add the icon radius.
            if (labelCoord.y + svl.LABEL_ICON_RADIUS + connectorHeight + menuHeight - CONNECTOR_BUFFER > util.EXPLORE_CANVAS_HEIGHT) {
                topCoordinate = labelCoord.y - svl.LABEL_ICON_RADIUS - connectorHeight - menuHeight + CONNECTOR_BUFFER;
                connectorCoordinate = menuHeight - menuBorder;
            }

            // Set the color of the border.
            _setBorderColor(labelColor);
            lastShownLabelColor = labelColor;

            // Set the menu value if label has it's value set.
            var severity = targetLabel.getProperty('severity'),
                temporaryLabel = targetLabel.getProperty('temporaryLabel'),
                description = targetLabel.getProperty('description');
            if (severity) {
                $severityButtons.each(function(i, v) {
                   if (severity === i + 1) { $(this).prop("checked", true); }
                });
            }

            $temporaryLabelCheckbox.prop("checked", temporaryLabel);

            $menuWindow.css({
                visibility: 'visible',
                left: labelCoord.x - windowWidth / 2,
                top: topCoordinate
            });

            $connector.css({
                visibility: 'visible',
                top: topCoordinate + connectorCoordinate,
                left: labelCoord.x - connectorWidth / 2,
            });

            setStatus('visibility', 'visible');

            if (description) {
                $descriptionTextBox.val(description);
            } else {
                var defaultText = i18next.t('center-ui.context-menu.description');
                $descriptionTextBox.prop("placeholder", defaultText);
            }
            var labelProps = status.targetLabel.getProperties();

            // Don't push event on Occlusion labels; they don't open ContextMenus.
            svl.tracker.push('ContextMenu_Open', {'auditTaskId': labelProps.auditTaskId}, {'temporaryLabelId': labelProps.temporaryLabelId});
        }
        if (labelType !== 'Occlusion' && labelType !== 'Signal') {
            self.updateRadioButtonImages();
            _setSeverityTooltips(labelType);
        }
    }

    /**
     * Toggles the color of the tag when selected/deselected.
     * @param labelTags     List of tags that the current label has.
     * @param id
     * @param target        Tag button that is being modified.
     */
    function _toggleTagColor(labelTags, id, target) {
        if (labelTags.includes(id)) {
            target.style.backgroundColor = 'rgb(200, 200, 200)';
        } else {
            target.style.backgroundColor = "white";
        }
    }

    self.checkRadioButton = checkRadioButton;
    self.getTargetLabel = getTargetLabel;
    self.handleSeverityPopup = handleSeverityPopup;
    self.fetchLabelTags = fetchLabelTags;
    self.updateRadioButtonImages = updateRadioButtonImages;
    self.hide = hide;
    self.isOpen = isOpen;
    self.show = show;
    self.disableTagging = disableTagging;
    self.enableTagging = enableTagging;
    self.isTaggingDisabled = isTaggingDisabled;
    return self;
}
