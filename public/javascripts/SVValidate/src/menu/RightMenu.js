/**
 * Initializes the primary validation UI on the right side, including validation of tags/severity.
 * @constructor
 */
function RightMenu(menuUI) {
    let self = this;
    const $disagreeReasonButtons = menuUI.disagreeReasonOptions.children('.validation-reason-button');
    const $unsureReasonButtons = menuUI.unsureReasonOptions.children('.validation-reason-button');
    let $tagSelect;

    function _init() {
        // Add onclick for each validation button.
        menuUI.yesButton.click(function(e) {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Agree' : 'ValidationButtonClick_Agree';
            svv.tracker.push(action);
            _setYesView();
            svv.panorama.getCurrentLabel().setProperty('validationResult', 1);
        });
        menuUI.noButton.click(function(e) {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Disagree' : 'ValidationButtonClick_Disagree';
            svv.tracker.push(action);
            _setNoView();
            svv.panorama.getCurrentLabel().setProperty('validationResult', 2);
        });
        menuUI.unsureButton.click(function(e) {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Unsure' : 'ValidationButtonClick_Unsure';
            svv.tracker.push(action);
            _setUnsureView();
            svv.panorama.getCurrentLabel().setProperty('validationResult', 3);
        });

        // Add onclick for each severity button.
        menuUI.severityMenu.find('.severity-level').click(function(e) {
            let currLabel = svv.panorama.getCurrentLabel();
            const oldSeverity = currLabel.getProperty('newSeverity');
            const newSeverity = $(e.target).closest('.severity-level').data('severity');
            if (oldSeverity !== newSeverity) {
                svv.tracker.push(`Click=Severity_Old=${oldSeverity}_New=${newSeverity}`);
                currLabel.setProperty('newSeverity', newSeverity);
                _renderSeverity();
            }
        });

        // Initialize the selectize object for tags (this is the auto-completing tag picker).
        $tagSelect = $('#select-tag').selectize({
            maxItems: 1,
            placeholder: 'Add more tags here',
            labelField: 'tag_name',
            valueField: 'tag_name',
            searchField: 'tag_name',
            sortField: 'popularity', // TODO include data abt frequency of use on this server.
            onFocus: function() { svv.tracker.push('Click=TagSearch'); },
            onItemAdd: function (value, $item) {
                let currLabel = svv.panorama.getCurrentLabel();

                // If the tag is mutually exclusive with another tag that's been added, remove the other tag.
                const allTags = svv.tagsByLabelType[currLabel.getAuditProperty('labelType')];
                const mutuallyExclusiveWith = allTags.find(t => t.tag_name === value).mutually_exclusive_with;
                const currTags = currLabel.getProperty('newTags');
                if (currTags.some(t => t === mutuallyExclusiveWith)) {
                    svv.tracker.push(`TagAutoRemove_Tag="${mutuallyExclusiveWith}"`);
                    currLabel.setProperty('newTags', currTags.filter(t => t !== mutuallyExclusiveWith));
                }
                // New tag added, add to list and rerender.
                svv.tracker.push(`TagAdd_Tag="${value}"`);
                currLabel.getProperty('newTags').push(value);
                $tagSelect[0].selectize.clear();
                $tagSelect[0].selectize.removeOption(value);
                _renderTags();
            },
            render: {
                option: function(item, escape) {
                    // Add an example image tooltip to the tag.
                    const translatedTagName = i18next.t('common:tag.' + item.tag_name.replace(/:/g, '-'));
                    let $tagDiv = $(`<div class="option">${escape(translatedTagName)}</div>`);
                    const tooltipText = `"${translatedTagName}" example`
                    _addTooltip($tagDiv, tooltipText, `/assets/images/examples/tags/${item.tag_id}.png`);
                    return $tagDiv[0];
                }
            }
        });

        // Add onclick for disagree and unsure reason buttons.
        for (const reasonButton of $disagreeReasonButtons) {
            reasonButton.onclick = function(e) {
                const action = e.isTrigger ? 'KeyboardShortcut_DisagreeReason_Option=no-button-' + $(this).attr('id')
                    : 'Click=DisagreeReason_Option=' + $(this).attr('id');
                svv.tracker.push(action);
                _setDisagreeReason($(this).attr('id'));
            };
        }
        for (const reasonButton of $unsureReasonButtons) {
            reasonButton.onclick = function(e) {
                const action = e.isTrigger ? 'KeyboardShortcut_UnsureReason_Option=unsure-button-' + $(this).attr('id')
                    : 'Click=UnsureReason_Option=' + $(this).attr('id');
                svv.tracker.push(action);
                _setUnsureReason($(this).attr('id'));
            };
        }

        function deselectReasonButtons() {
            $disagreeReasonButtons.removeClass('chosen');
            $unsureReasonButtons.removeClass('chosen');
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.removeClass('chosen');
        }

        // Log clicks to the three text boxes.
        menuUI.optionalCommentTextBox.click(function(e) {
            menuUI.optionalCommentTextBox.focus();
            const action = e.isTrigger ? 'Keyboard=AgreeCommentTextbox': 'Click=AgreeCommentTextbox';
            svv.tracker.push(action);
        });
        menuUI.disagreeReasonTextBox.click(function(e) {
            deselectReasonButtons();
            menuUI.disagreeReasonTextBox.focus();
            const action = e.isTrigger ? 'Keyboard=DisagreeReasonTextbox': 'Click=DisagreeReasonTextbox';
            svv.tracker.push(action);
        });
        menuUI.unsureReasonTextBox.click(function(e) {
            deselectReasonButtons();
            menuUI.unsureReasonTextBox.focus();
            const action = e.isTrigger ? 'Keyboard=UnsureReasonTextbox': 'Click=UnsureReasonTextbox';
            svv.tracker.push(action);
        });

        // Add oninput for disagree and unsure other reason text boxes.
        menuUI.disagreeReasonTextBox.on('input', function() {
            if (menuUI.disagreeReasonTextBox.val() === '') {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                svv.panorama.getCurrentLabel().setProperty('disagreeOption', undefined);
            } else {
                _setDisagreeReason('other');
            }
        });
        menuUI.unsureReasonTextBox.on('input', function() {
            if (menuUI.unsureReasonTextBox.val() === '') {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                svv.panorama.getCurrentLabel().setProperty('unsureOption', undefined);
            } else {
                _setUnsureReason('other');
            }
        });

        // Add onclick for submit button.
        menuUI.submitButton.click(function(e) {
            if (!e.target.disabled) {
                _validateLabel(svv.validationOptions[svv.panorama.getCurrentLabel().getProperty('validationResult')], e.isTrigger);
            }
        });
    }

    function resetMenu(label) {
        const prevValResult = label.getProperty('validationResult');
        if (prevValResult === undefined) {
            // This is a new label (not returning from an undo), so reset everything.
            menuUI.yesButton.removeClass('chosen');
            menuUI.noButton.removeClass('chosen');
            menuUI.unsureButton.removeClass('chosen');
            menuUI.tagsMenu.css('display', 'none');
            menuUI.severityMenu.css('display', 'none');
            menuUI.optionalCommentSection.css('display', 'none');
            menuUI.optionalCommentTextBox.val('');
            menuUI.noMenu.css('display', 'none');
            menuUI.unsureMenu.css('display', 'none');
            $disagreeReasonButtons.removeClass('chosen');
            $unsureReasonButtons.removeClass('chosen');
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            menuUI.unsureReasonTextBox.val('');

            // Update the text and tooltips on each disagree and unsure reason buttons.
            const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
            for (const reasonButton of $disagreeReasonButtons.add($unsureReasonButtons)) {
                const $reasonButton = $(reasonButton);
                const buttonInfo = svv.reasonButtonInfo[labelType][$reasonButton.attr('id')];
                if (buttonInfo) {
                    $reasonButton.text(buttonInfo.buttonText);

                    // Remove any old tooltip (from a previous label type) and add a new tooltip.
                    $reasonButton.tooltip('destroy');
                    if (buttonInfo.tooltipImage) {
                        util.getImage(buttonInfo.tooltipImage).then(img => {
                            _addTooltip($reasonButton, buttonInfo.tooltipText, img);
                        });
                    } else {
                        _addTooltip($reasonButton, buttonInfo.tooltipText);
                    }

                    // Adds a class as a way to show that this button has associated text.
                    $reasonButton.addClass('defaultOption');
                    $reasonButton.css('display', 'flex');
                } else {
                    $reasonButton.css('display', 'none');
                    if ($reasonButton.hasClass('defaultOption')) {
                        $reasonButton.removeClass('defaultOption');
                    }
                }
            }
            menuUI.submitButton.prop('disabled', true);
        } else {
            // This is a validation that they are going back to, so update all the views to match what they had before.
            menuUI.optionalCommentTextBox.val(label.getProperty('agreeComment'));

            let disagreeOption = label.getProperty('disagreeOption');
            $disagreeReasonButtons.removeClass('chosen');
            if (disagreeOption === 'other') {
                menuUI.disagreeReasonTextBox.addClass('chosen');
                menuUI.disagreeReasonTextBox.val(label.getProperty('disagreeReasonTextBox'));
            } else {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                menuUI.disagreeReasonTextBox.val('');
                menuUI.disagreeReasonOptions.find(`#${disagreeOption}`).addClass('chosen');
            }

            let unsureOption = label.getProperty('unsureOption');
            $unsureReasonButtons.removeClass('chosen');
            if (unsureOption === 'other') {
                menuUI.unsureReasonTextBox.addClass('chosen');
                menuUI.unsureReasonTextBox.val(label.getProperty('unsureReasonTextBox'));
            } else {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                menuUI.unsureReasonTextBox.val('');
                menuUI.unsureReasonOptions.find(`#${unsureOption}`).addClass('chosen');
            }

            if (prevValResult === 1)      _setYesView();
            else if (prevValResult === 2) _setNoView();
            else if (prevValResult === 3) _setUnsureView();
        }
    }

    function _setYesView() {
        menuUI.yesButton.addClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        _renderTags();
        menuUI.tagsMenu.css('display', 'block');
        let currLabelType = svv.panorama.getCurrentLabel().getAuditProperty('labelType');
        if (currLabelType !== 'Signal') {
            // Pedestrian Signal label type doesn't have severity ratings.
            _renderSeverity();
            menuUI.severityMenu.css('display', 'block');
        }
        menuUI.optionalCommentSection.css('display', 'block');
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.submitButton.prop('disabled', false);
    }

    function _setNoView() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.addClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.optionalCommentSection.css('display', 'none');
        menuUI.noMenu.css('display', 'block');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.submitButton.prop('disabled', false);
    }

    function _setUnsureView() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.addClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.optionalCommentSection.css('display', 'none');
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'block');
        menuUI.submitButton.prop('disabled', false);
    }

    /**
     * Adds a jquery tooltip to the given element with the given text and image (if given).
     * @param $elem Element to add the tooltip to, as jquery wrapped object.
     * @param tooltipText Text to display in the tooltip.
     * @param img Optional image to display in the tooltip.
     * @private
     */
    function _addTooltip($elem, tooltipText, img) {
        const tooltipHtml = img ? `${tooltipText}<br/><img src="${img}" height="140"/>` : tooltipText;
        $elem.tooltip(({
            placement: 'top',
            html: true,
            delay: { show: 500, hide: 10 },
            title: tooltipHtml
        })).tooltip('show').tooltip('hide');
    }


    // TAG SECTION.
    function _removeTag(e, label) {
        let allTagOptions = structuredClone(svv.tagsByLabelType[label.getAuditProperty('labelType')]);
        let tagIdToRemove = $(e.target).parents('.current-tag').data('tag-id');
        let tagToRemove = allTagOptions.find(t => t.tag_id === tagIdToRemove).tag_name;
        svv.tracker.push(`Click=TagRemove_Tag="${tagToRemove}"`);
        label.setProperty('newTags', label.getProperty('newTags').filter(t => t !== tagToRemove));
        _renderTags();
    }
    function _renderTags() {
        let label = svv.panorama.getCurrentLabel();
        let allTagOptions = structuredClone(svv.tagsByLabelType[label.getAuditProperty('labelType')]);

        menuUI.currentTags.empty();
        const currTags = label.getProperty('newTags');
        // Clone the template tag element, remove the 'template' class, update the text, and add the removal onclick.
        for (let tag of currTags) {
            if (!allTagOptions.some(t => t.tag_name === tag)) {
                continue; // Skip tags that are now being excluded on this server. Don't want to show them.
            }

            // Clone the template tag element, remove the 'template' class, and add a tag-id data attribute.
            let $tagDiv = $('.current-tag.template').clone().removeClass('template');
            $tagDiv.data('tag-id', allTagOptions.find(t => t.tag_name === tag).tag_id);

            // Update the tag name.
            const translatedTagName = i18next.t('common:tag.' + tag.replace(/:/g, '-'));
            $tagDiv.children('.tag-name').text(translatedTagName);

            // Add the removal onclick function.
            $tagDiv.children('.remove-tag-x').click(e => _removeTag(e, label));

            // Add an example image tooltip to the tag.
            const tagId = allTagOptions.find(t => t.tag_name === tag).tag_id;
            const tooltipText = `"${translatedTagName}" example`
            _addTooltip($tagDiv, tooltipText, `/assets/images/examples/tags/${tagId}.png`);

            // Add to current list of tags, and remove from options for new tags to add.
            menuUI.currentTags.append($tagDiv);
            allTagOptions = allTagOptions.filter(t => t.tag_name !== tag);
        }

        // Show/hide elem for list of tags to hide extra spacing b/w elements when there are no tags to show.
        if (currTags.length === 0) {
            menuUI.currentTags.css('display', 'none');
        } else {
            menuUI.currentTags.css('display', 'flex');
        }

        // Clear the possible tags to add and add all appropriate options.
        $tagSelect[0].selectize.clearOptions();
        $tagSelect[0].selectize.addOption(allTagOptions);
    }

    // SEVERITY SECTION.
    function _renderSeverity() {
        let label = svv.panorama.getCurrentLabel();
        const severity = label.getProperty('newSeverity');
        const labelType = svv.panorama.getCurrentLabel().getAuditProperty('labelType');

        // Add example image tooltips to the severity buttons after removing old ones (in case label type changed).
        for (const severityButton of menuUI.severityMenu.find('.severity-level')) {
            const severityIcon = $(severityButton.querySelector('.severity-icon'));
            const severity = severityButton.dataset.severity;
            const tooltipText = i18next.t(`common:severity-example-tooltip-${severity}`);
            const tooltipImage = `/assets/images/examples/severity/${labelType}_Severity${severity}.png`;
            severityIcon.tooltip('destroy');
            _addTooltip(severityIcon, tooltipText, tooltipImage);
        }

        // Set the correct severity button as selected.
        menuUI.severityMenu.find('.severity-level').removeClass('selected');
        if (severity) {
            menuUI.severityMenu.find('#severity-button-' + severity).addClass('selected');
        }
    }

    // VALIDATING 'NO' SECTION
    function _setDisagreeReason(id) {
        $disagreeReasonButtons.removeClass('chosen');
        if (id === 'other') {
            menuUI.disagreeReasonTextBox.addClass('chosen');
            svv.panorama.getCurrentLabel().setProperty('disagreeOption', 'other');
        } else {
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            svv.panorama.getCurrentLabel().setProperty('disagreeOption', id);
            menuUI.disagreeReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    // VALIDATING 'UNSURE' SECTION
    function _setUnsureReason(id) {
        $unsureReasonButtons.removeClass('chosen');
        if (id === 'other') {
            menuUI.unsureReasonTextBox.addClass('chosen');
            svv.panorama.getCurrentLabel().setProperty('unsureOption', 'other');
        } else {
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.val('');
            svv.panorama.getCurrentLabel().setProperty('unsureOption', id);
            menuUI.unsureReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    function saveValidationState() {
        let currLabel = svv.panorama.getCurrentLabel();
        currLabel.setProperty('agreeComment', menuUI.optionalCommentTextBox.val());
        currLabel.setProperty('disagreeReasonTextBox', menuUI.disagreeReasonTextBox.val());
        currLabel.setProperty('unsureReasonTextBox', menuUI.unsureReasonTextBox.val());
    }

    /**
     * Validates a single label from a button click.
     * @param action           {String} Validation action - must be one of Agree, Disagree, or Unsure.
     * @param keyboardShortcut {boolean} Whether or not the validation was triggered by a keyboard shortcut.
     */
    function _validateLabel(action, keyboardShortcut) {
        const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
        let timestamp = new Date().getTime();
        svv.tracker.push(actionStr + action);
        let currLabel = svv.panorama.getCurrentLabel();

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass('validate');
        menuUI.noButton.removeClass('validate');
        menuUI.unsureButton.removeClass('validate');

        // Save anything they typed in either text box so that it's there again if they undo their validation.
        saveValidationState();

        // Fill in the comment based on the disagree options they picked or one of the free form text boxes.
        let comment = '';
        if (action === 'Agree') {
            comment = currLabel.getProperty('agreeComment');
        } else if (action === 'Disagree') {
            let disagreeReason = currLabel.getProperty('disagreeOption');
            if (disagreeReason === 'other') {
                comment = currLabel.getProperty('disagreeReasonTextBox');
            } else {
                comment = menuUI.disagreeReasonOptions.find(`#${disagreeReason}`).text();
            }
        } else if (action === 'Unsure') {
            let unsureReason = currLabel.getProperty('unsureOption');
            if (unsureReason === 'other') {
                comment = currLabel.getProperty('unsureReasonTextBox');
            } else {
                comment = menuUI.unsureReasonOptions.find(`#${unsureReason}`).text();
            }
        }
        currLabel.setProperty('comment', comment);

        // If enough time has passed between validations, log validations.
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.panoramaContainer.validateLabel(action, timestamp, comment);
        }
    }

    self.resetMenu = resetMenu;
    self.saveValidationState = saveValidationState;

    _init();
    return self;
}
