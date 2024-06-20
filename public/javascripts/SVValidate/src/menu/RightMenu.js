/**
 * Initializes the primary validation UI on the right side, including validation of tags/severity.
 * @constructor
 */
function RightMenu(menuUI) {
    let self = this;
    const $disagreeReasonButtons = menuUI.disagreeReasonOptions.children('.disagree-reason-button');
    const $disagreeReasonTextbox = menuUI.disagreeReasonOptions.find('#add-disagree-comment');
    let $tagSelect;

    function _init() {
        // Add onclick for each validation button.
        // TODO simulating a click when using keyboard, should be changed when we set up logging.
        menuUI.yesButton.click(function() {
            _setYesView();
            svv.panorama.getCurrentLabel().setProperty('validationResult', 1);
        });
        menuUI.noButton.click(function() {
            _setNoView();
            svv.panorama.getCurrentLabel().setProperty('validationResult', 2);
        });
        menuUI.unsureButton.click(function() {
            _setUnsureView();
            svv.panorama.getCurrentLabel().setProperty('validationResult', 3);
        });

        // Initialize the selectize object for tags (this is the auto-completing tag picker).
        $tagSelect = $("#select-tag").selectize({
            maxItems: 1,
            placeholder: 'Add more tags here',
            labelField: 'tag_name',
            valueField: 'tag_name',
            searchField: 'tag_name',
            sortField: 'popularity', // TODO include data abt frequency of use on this server.
            onItemAdd: function (value, $item) {
                // New tag added, add to list and rerender.
                svv.panorama.getCurrentLabel().getProperty('newTags').push(value);
                $tagSelect[0].selectize.clear();
                $tagSelect[0].selectize.removeOption(value);
                _renderTags();
            }
        });

        // Add onclick for disagree reason buttons.
        for (const reasonButton of $disagreeReasonButtons) {
            reasonButton.onclick = function() {
                _setDisagreeReasonSelected($(this).attr('id'));
            };
        }

        // Add oninput for disagree other reason text box.
        $disagreeReasonTextbox.on('input', function() {
            if ($disagreeReasonTextbox.val() === '') {
                $disagreeReasonTextbox.removeClass('chosen');
                svv.panorama.getCurrentLabel().setProperty('disagreeOption', undefined);
            } else {
                _setDisagreeReasonSelected('other');
            }
        });

        // Add onclick for submit button.
        menuUI.submitButton.click(function() {
            _validateLabel(svv.validationOptions[svv.panorama.getCurrentLabel().getProperty('validationResult')]);
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
            menuUI.noMenu.css('display', 'none');
            $disagreeReasonButtons.removeClass('chosen');
            // Update the text on each button.
            const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
            for (const reasonButton of $disagreeReasonButtons) {
                $(reasonButton).text(i18next.t(`right-ui.disagree-reason.${labelType}.${$(reasonButton).attr('id')}`));
            }
            $disagreeReasonTextbox.removeClass('chosen');
            $disagreeReasonTextbox.val('');
            menuUI.unsureMenu.css('display', 'none');
            menuUI.unsureComment.val('');
            menuUI.submitButton.attr('disabled', 'disabled');
        } else {
            // This is a validation that they are going back to, so update all the views to match what they had before.
            menuUI.unsureComment.val(label.getProperty('unsureReasonTextBox'));
            let disagreeOption = label.getProperty('disagreeOption');
            $disagreeReasonButtons.removeClass('chosen');
            if (disagreeOption === 'other') {
                $disagreeReasonTextbox.addClass('chosen');
                $disagreeReasonTextbox.val(label.getProperty('disagreeReasonTextBox'));
            } else {
                $disagreeReasonTextbox.removeClass('chosen');
                $disagreeReasonTextbox.val('');
                menuUI.disagreeReasonOptions.find(`#${disagreeOption}`).addClass('chosen');
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
        _renderSeverity();
        let currLabelType = svv.panorama.getCurrentLabel().getAuditProperty('labelType');
        if (currLabelType !== 'Signal') {
            // Pedestrian Signal label type doesn't have severity ratings.
            menuUI.severityMenu.css('display', 'block');
        }
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.submitButton.removeAttr('disabled');
    }

    function _setNoView() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.addClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.noMenu.css('display', 'block');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.submitButton.removeAttr('disabled');
    }

    function _setUnsureView() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.addClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'block');
        menuUI.submitButton.removeAttr('disabled');
    }


    // TAG SECTION.
    function _removeTag(e, label) {
        let tagToRemove = $(e.target).parents('.current-tag').children('.tag-name').text();
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
            // Clone the template tag element and remove the 'template' class.
            let $tagDiv = $('.current-tag.template').clone().removeClass('template');

            // Update the tag name.
            $tagDiv.children('.tag-name').text(i18next.t('common:tag.' + tag));

            // Add the removal onclick function.
            $tagDiv.children('.remove-tag-x').click(e => _removeTag(e, label));

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
        let severity = label.getProperty('newSeverity');

        // Set the correct severity button as selected.
        menuUI.severityMenu.find('.severity-level').removeClass('selected');
        if (severity) {
            menuUI.severityMenu.find('#severity-button-' + severity).addClass('selected');
        }

        // TODO these should only be added once, right? Logging shows that only one is being executed each time though.
        // Add onclick for each severity button.
        menuUI.severityMenu.find('.severity-level').click(function(e) {
            let newSeverity = $(e.target).closest('.severity-level').data('severity');
            label.setProperty('newSeverity', newSeverity);
            _renderSeverity();
        });
    }

    // VALIDATING 'NO' SECTION
    function _setDisagreeReasonSelected(id) {
        $disagreeReasonButtons.removeClass('chosen');
        if (id === 'other') {
            $disagreeReasonTextbox.addClass('chosen');
            svv.panorama.getCurrentLabel().setProperty('disagreeOption', 'other');
        } else {
            $disagreeReasonTextbox.removeClass('chosen');
            $disagreeReasonTextbox.val('');
            svv.panorama.getCurrentLabel().setProperty('disagreeOption', id);
            menuUI.disagreeReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    function saveValidationState() {
        let currLabel = svv.panorama.getCurrentLabel();
        currLabel.setProperty('disagreeReasonTextBox', $disagreeReasonTextbox.val());
        currLabel.setProperty('unsureReasonTextBox', menuUI.unsureComment.val());
    }

    /**
     * Validates a single label from a button click.
     * @param action    {String} Validation action - must be one of Agree, Disagree, or Unsure.
     */
    function _validateLabel(action) {
        let timestamp = new Date().getTime();
        svv.tracker.push("ValidationButtonClick_" + action);
        let currLabel = svv.panorama.getCurrentLabel();

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass("validate");
        menuUI.noButton.removeClass("validate");
        menuUI.unsureButton.removeClass("validate");

        // Save anything they typed in either text box so that it's there again if they undo their validation.
        saveValidationState();

        // Fill in the comment based on the disagree options they picked or one of the free form text boxes.
        let comment = '';
        if (action === 'Disagree') {
            let disagreeReason = currLabel.getProperty('disagreeOption');
            if (disagreeReason === 'other') {
                comment = currLabel.getProperty('disagreeReasonTextBox');
            } else {
                comment = menuUI.disagreeReasonOptions.find(`#${disagreeReason}`).text();
            }
        } else if (action === 'Unsure') {
            comment = currLabel.getProperty('unsureReasonTextBox');
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
