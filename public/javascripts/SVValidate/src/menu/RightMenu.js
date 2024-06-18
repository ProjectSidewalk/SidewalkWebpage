/**
 * Initializes the primary validation UI on the right side, including validation of tags/severity.
 * @constructor
 */
function RightMenu(menuUI) {
    let self = this;

    function resetMenu() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.noMenu.css('display', 'none');
        noReasonButtons.removeClass('chosen');
        otherReasonBox.removeClass('chosen');
        otherReasonBox.val('');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.unsureComment.value = '';
        menuUI.submitButton.attr('disabled', 'disabled');
    }

    menuUI.yesButton.click(function() {
        menuUI.yesButton.addClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        renderTags();
        renderSeverity();
        menuUI.tagsMenu.css('display', 'block');
        let currLabelType = svv.panorama.getCurrentLabel().getAuditProperty('labelType');
        if (currLabelType !== 'Signal') {
            // Pedestrian Signal label type doesn't have severity ratings.
            menuUI.severityMenu.css('display', 'block');
        }
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'none');
        svv.panorama.getCurrentLabel().setProperty('validationResult', 1);
        menuUI.submitButton.removeAttr('disabled');
    });
    menuUI.noButton.click(function() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.addClass('chosen');
        menuUI.unsureButton.removeClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.noMenu.css('display', 'block');
        menuUI.unsureMenu.css('display', 'none');
        svv.panorama.getCurrentLabel().setProperty('validationResult', 2);
        menuUI.submitButton.removeAttr('disabled');
    });
    menuUI.unsureButton.click(function() {
        menuUI.yesButton.removeClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.addClass('chosen');
        menuUI.tagsMenu.css('display', 'none');
        menuUI.severityMenu.css('display', 'none');
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'block');
        svv.panorama.getCurrentLabel().setProperty('validationResult', 3);
        menuUI.submitButton.removeAttr('disabled');
    });
    // TODO this should be saved elsewhere.
    const valOptionToText = {
        1: 'Agree',
        2: 'Disagree',
        3: 'Unsure'
    };
    menuUI.submitButton.click(function() {
        validateLabel(valOptionToText[svv.panorama.getCurrentLabel().getProperty('validationResult')]);
    });

    // TAG SECTION.
    let $tagSelect;
    function removeTag(e, label) {
        let tagToRemove = $(e.target).parents('.current-tag').children('.tag-name').text();
        label.setProperty('newTags', label.getProperty('newTags').filter(t => t !== tagToRemove));
        renderTags();
    }
    function renderTags() {
        let label = svv.panorama.getCurrentLabel();
        let allTagOptions = structuredClone(svv.tagsByLabelType[label.getAuditProperty('labelType')]);

        menuUI.currentTags.empty();
        // Clone the template tag element, remove the 'template' class, update the text, and add the removal onclick.
        for (let tag of label.getProperty('newTags')) {
            // Clone the template tag element and remove the 'template' class.
            let $tagDiv = $('.current-tag.template').clone().removeClass('template');

            // Update the tag name.
            $tagDiv.children('.tag-name').text(i18next.t('common:tag.' + tag));

            // Add the removal onclick function.
            $tagDiv.children('.remove-tag-x').click(e => removeTag(e, label));

            // Add to current list of tags, and remove from options for new tags to add.
            menuUI.currentTags.append($tagDiv);
            allTagOptions = allTagOptions.filter(t => t.tag_name !== tag);
        }

        if ($tagSelect) {
            // If the selectize object already exists, clear and add all appropriate options.
            $tagSelect[0].selectize.clearOptions();
            $tagSelect[0].selectize.addOption(allTagOptions);
        } else {
            // Initialize the selectize object if it doesn't exist.
            $tagSelect = $("#select-tag").selectize({
                maxItems: 1,
                placeholder: 'Add more tags here',
                labelField: 'tag_name',
                valueField: 'tag_name',
                searchField: 'tag_name',
                options: allTagOptions,
                sortField: 'popularity', // TODO include data abt frequency of use on this server.
                onItemAdd: function (value, $item) {
                    // New tag added, add to list and rerender.
                    label.getProperty('newTags').push(value);
                    $tagSelect[0].selectize.clear();
                    $tagSelect[0].selectize.removeOption(value);
                    renderTags();
                }
            });
        }
    }

    // SEVERITY SECTION.
    function renderSeverity() {
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
            renderSeverity();
        });
    }

    // VALIDATING 'NO' SECTION
    const otherReasonBox = menuUI.noReasonOptions.find('#add-no-comment');
    const noReasonButtons = menuUI.noReasonOptions.children('.no-reason-button');
    for (const reasonButton of noReasonButtons) {
        reasonButton.onclick = function() {
            // Remove styling from other options, erase any text in the free-form text box.
            menuUI.noReasonOptions.children().removeClass('chosen');
            otherReasonBox.val('');

            // Add styling to the selected button and set the comment.
            const currButton = $(this);
            currButton.addClass('chosen');
            svv.panorama.getCurrentLabel().setProperty('comment', currButton.text());
        };
    }
    // For the 'other' reason text field: If the user types something in the text box, deselect the buttons.
    otherReasonBox.on('input', function() {
        if (otherReasonBox.val() === '') {
            otherReasonBox.removeClass('chosen');
        } else {
            noReasonButtons.removeClass('chosen');
            otherReasonBox.addClass('chosen');
            svv.panorama.getCurrentLabel().setProperty('comment', '');
        }
    });

    /**
     * Validates a single label from a button click.
     * TODO this is defined in two different places. Possibly combine if they have similar functionality.
     * @param action    {String} Validation action - must be agree, disagree, or unsure.
     */
    function validateLabel (action) {
        let timestamp = new Date().getTime();
        svv.tracker.push("ValidationButtonClick_" + action);

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass("validate");
        menuUI.noButton.removeClass("validate");
        menuUI.unsureButton.removeClass("validate");

        let comment = '';
        if (action === 'Disagree') {
            comment = svv.panorama.getCurrentLabel().getProperty('comment');
            if (comment === '') {
                comment = otherReasonBox.val();
            }
        } else if (action === 'Unsure' && menuUI.unsureComment) {
            comment = menuUI.unsureComment.val();
        }
        svv.panorama.getCurrentLabel().setProperty('comment', comment);
        console.log(`The final comment: ${comment}`);

        // If enough time has passed between validations, log validations.
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.panoramaContainer.validateLabel(action, timestamp, comment);
        }
    }

    self.resetMenu = resetMenu;

    return self;
}
