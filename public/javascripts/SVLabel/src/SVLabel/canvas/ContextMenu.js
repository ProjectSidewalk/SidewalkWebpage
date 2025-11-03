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
            ratingSeverityEnabledForTutorialLabel: undefined, // During tutorial, disabled except for specific steps
            taggingEnabledForTutorialLabel: undefined, // During tutorial, disabled except for specific steps
        };
    var $menuWindow = uiContextMenu.holder;
    var $severityMenu = uiContextMenu.severityMenu;
    var $severityButtons = uiContextMenu.radioButtons;
    let $descriptionHeaderNumber = $('#description-header-num');
    var $descriptionTextBox = uiContextMenu.textBox;
    var $OKButton = $menuWindow.find("#context-menu-ok-button");
    var $radioButtonLabels = $menuWindow.find(".severity-level");
    var $tagHolder = uiContextMenu.tagHolder;
    var $tags = uiContextMenu.tags;

    var windowWidth = $menuWindow.width();
    var LABEL_TO_MENU_GAP = 8; // Amount of space between the label and context menu.
    var PAGE_BOTTOM_SPACE = 29; // Additional space avail below GSV where we can still show the context menu.

    document.addEventListener('mousedown', _handleMouseDown);
    $menuWindow.on('mousedown', _handleMenuWindowMouseDown);
    $severityButtons.on('change', _handleSeverityChange);
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
        if (isOpen()) {
            if (clickedOut) {
                svl.tracker.push('ContextMenu_CloseClickOut');
                handleSeverityPopup();
            }
            hide();
            svl.navigationService.setStatus('contextMenuWasOpen', true);
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
        hide();
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
            // If the label is No Sidewalk or Pedestrian Signal, do not call ratingReminderAlert().
            if (!['NoSidewalk', 'Signal'].includes(lastLabelProps.labelType)) {
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
            method: 'GET',
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
                    // If the tag is mutually exclusive with another tag, automatically remove the other tag.
                    if (tag.mutually_exclusive_with) {
                        var mutuallyExclusiveTag = self.labelTags.filter(t => t.tag === tag.mutually_exclusive_with)[0];
                        if (mutuallyExclusiveTag) {
                            labelTags = _autoRemoveAlternateTagAndUpdateUI(mutuallyExclusiveTag.tag_id, labelTags);
                        }
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
        $tags.each((index, tag) => {
            var classWithTagId = tag.className.split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0];
            if (classWithTagId !== undefined && parseInt(classWithTagId.match(/\d+/)[0], 10) === tagId) {
                $(`.${classWithTagId}`).removeClass('selected');
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

    /**
     * Hide the context menu.
     */
    function hide() {
        if (isOpen()) {
            $descriptionTextBox.blur(); // Force the blur event before the ContextMenu close event.
            svl.tracker.push('ContextMenu_Close');
        }

        $menuWindow.css('visibility', 'hidden');
        setStatus('visibility', 'hidden');

        return this;
    }

    /**
     * Checks if the menu is open or not.
     * @returns {boolean}
     */
    function isOpen() {
        return getStatus('visibility') === 'visible';
    }

    // Disable rating severity.
    function disableRatingSeverity() {
        setStatus('ratingSeverityEnabledForTutorialLabel', null);
        _showRatingSeverityDisabled();
    }

    // Disable tagging.
    function disableTagging() {
        setStatus('taggingEnabledForTutorialLabel', null);
        _showTaggingDisabled();
    }

    // Enable rating severity for a given tutorial label.
    function enableRatingSeverityForTutorialLabel(tutorialLabelNumber) {
        setStatus('ratingSeverityEnabledForTutorialLabel', tutorialLabelNumber);
        if (svl.isOnboarding() && !isRatingSeverityDisabled()) _showRatingSeverityEnabled();
    }

    // Enable tagging for a given tutorial label.
    function enableTaggingForTutorialLabel(tutorialLabelNumber) {
        setStatus('taggingEnabledForTutorialLabel', tutorialLabelNumber);
        if (svl.isOnboarding() && !isTaggingDisabled()) _showTaggingEnabled();
    }

    // Adds the disabled visual effects to the severity buttons on current context menu.
    function _showRatingSeverityEnabled() {
        $radioButtonLabels.removeClass('disabled');
    }

    // Adds the disabled visual effects to the tags on current context menu.
    function _showRatingSeverityDisabled() {
        $radioButtonLabels.addClass('disabled');
    }

    function _showTaggingEnabled() {
        $("body").find("button[name=tag]").each(function(t) {
            $(this).removeClass('disabled');
        });
    }

    function _showTaggingDisabled() {
        $("body").find("button[name=tag]").each(function(t) {
            $(this).addClass('disabled');
        });
    }

    /**
     * Returns true if rating severity is currently disabled.
     */
    function isRatingSeverityDisabled() {
        return status.ratingSeverityEnabledForTutorialLabel !== status.targetLabel.getProperty('tutorialLabelNumber');
    }

    /**
     * Returns true if tagging is currently disabled.
     */
    function isTaggingDisabled() {
        return status.taggingEnabledForTutorialLabel !== status.targetLabel.getProperty('tutorialLabelNumber');
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

                // Sets color to match OK button green when selected
                if (labelTags.includes(tagId)) {
                    $(this).addClass('selected');
                } else {
                    $(this).removeClass('selected');
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
                        // If on the chandigarh server, check for an India-specific image, getting default as backup.
                        var exampleImage;
                        var imageUrl = `/assets/images/examples/tags/${tag.tag_id}.png`;
                        if (svl.cityId === 'chandigarh-india') {
                            var indiaImageUrl = `/assets/images/examples/tags/india/${tag.tag_id}.png`;
                            exampleImage = util.getImage(indiaImageUrl)
                                .catch(error => {
                                    return getImage(imageUrl); // If primary failed, try the backup image
                                });
                        } else {
                            exampleImage = util.getImage(imageUrl);
                        }

                        // Now that we have the image, create the tooltip.
                        exampleImage.then(img => {
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
        for (let sev = 1; sev < 4; sev++) {
            // Add severity tooltips for the current label type if we have images for them.
            util.getImage(`/assets/images/examples/severity/${labelType}_Severity${sev}.png`).then(img => {
                const tooltipHeader = i18next.t(`common:severity-example-tooltip-${sev}`);
                const tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
                $(`#severity-${sev}`).tooltip({
                    placement: "top", html: true, delay: {"show": 300, "hide": 10},
                    title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
                });
            });
        }
    }

    /**
     * Remove severity tooltips from the context menu, preparing to replace them for a new label type.
     * @private
     */
    function _removePrevSeverityTooltips() {
        for (let severity = 0; severity < 4; severity++) {
            $(`#severity-${severity}`).tooltip('destroy');
        }
    }

    /**
     * Show the context menu.
     * @param targetLabel the label whose context menu should be shown.
     */
    function show(targetLabel) {
        setStatus('targetLabel', null);
        $severityButtons.prop('checked', false);
        $descriptionTextBox.val(null);

        var labelType = targetLabel.getLabelType();
        var labelCoord = targetLabel.getCanvasXY();

        if (labelType !== 'Occlusion') {
            setStatus('targetLabel', targetLabel);
            _setTags(targetLabel);
            _setTagColor(targetLabel);
            if (getStatus('disableTagging')) { disableTagging(); }

            // Hide the severity menu for the No Sidewalk and Pedestrian Signal label types.
            if (['NoSidewalk', 'Signal'].includes(labelType)) {
                $severityMenu.addClass('hidden');
            } else {
                $severityMenu.removeClass('hidden');
            }
            var menuHeight = $menuWindow.outerHeight();

            // Determine coordinates for context menu to display below the label.
            var topCoordinate = labelCoord.y + svl.LABEL_ICON_RADIUS + LABEL_TO_MENU_GAP;

            // If there isn't enough room to show the context menu below the label, determine coords to display above.
            // labelCoord.y is top-left of label but is center of rendered label, so we must add the icon radius.
            if (topCoordinate + menuHeight - PAGE_BOTTOM_SPACE > util.EXPLORE_CANVAS_HEIGHT) {
                topCoordinate = labelCoord.y - svl.LABEL_ICON_RADIUS - menuHeight - LABEL_TO_MENU_GAP;
            }

            // Set the menu value if label has it's value set.
            var severity = targetLabel.getProperty('severity');
            var description = targetLabel.getProperty('description');
            if (severity) {
                $severityButtons.each(function(i, v) {
                    if (severity === i + 1) { $(this).prop("checked", true); }
                });
            }

            // Enable rating severity and tagging on tutorial labels if appropriate.
            if (svl.isOnboarding()) {
                if (!isRatingSeverityDisabled()) _showRatingSeverityEnabled();
                else _showRatingSeverityDisabled();
                if (!isTaggingDisabled()) _showTaggingEnabled();
                else _showTaggingDisabled();
            }

            $menuWindow.css({
                visibility: 'visible',
                left: labelCoord.x - windowWidth / 2,
                top: topCoordinate
            });

            setStatus('visibility', 'visible');

            if (description) {
                $descriptionTextBox.val(description);
            }
            var labelProps = status.targetLabel.getProperties();

            // Don't push event on Occlusion labels; they don't open ContextMenus.
            svl.tracker.push('ContextMenu_Open', {'auditTaskId': labelProps.auditTaskId}, {'temporaryLabelId': labelProps.temporaryLabelId});
        }
        if (!['NoSidewalk', 'Signal', 'Occlusion'].includes(labelType)) {
            self.updateRadioButtonImages();
            _removePrevSeverityTooltips();
            if (labelType !== 'Other') {
                _setSeverityTooltips(labelType);
            }
            $descriptionHeaderNumber.text('3.');
        } else {
            $descriptionHeaderNumber.text('2.');
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
            target.classList.add('selected');
        } else {
            target.classList.remove('selected');
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
    self.disableRatingSeverity = disableRatingSeverity;
    self.disableTagging = disableTagging;
    self.enableRatingSeverityForTutorialLabel = enableRatingSeverityForTutorialLabel;
    self.enableTaggingForTutorialLabel = enableTaggingForTutorialLabel;
    self.isRatingSeverityDisabled = isRatingSeverityDisabled;
    self.isTaggingDisabled = isTaggingDisabled;
    return self;
}
