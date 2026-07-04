/**
 * Initializes the primary validation UI on the right side, including validation of tags/severity.
 */
class DesktopValidationMenu {
    #menuUI;
    #disagreeReasonButtons;
    #unsureReasonButtons;
    #tagSelect;
    #tagsAddedByUser = [];

    /**
     * @param {object} menuUI Validation menu UI elements.
     */
    constructor(menuUI) {
        this.#menuUI = menuUI;
        this.#disagreeReasonButtons = menuUI.disagreeReasonOptions.children('.validation-reason-button');
        this.#unsureReasonButtons = menuUI.unsureReasonOptions.children('.validation-reason-button');

        this.#init();
    }

    #init() {
        const menuUI = this.#menuUI;

        // Add onclick for each validation button.
        menuUI.yesButton.click((e) => {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Agree' : 'ValidationButtonClick_Agree';
            svv.tracker.push(action);
            this.#setYesView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Agree');
        });
        menuUI.noButton.click((e) => {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Disagree' : 'ValidationButtonClick_Disagree';
            svv.tracker.push(action);
            this.#setNoView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Disagree');
        });
        menuUI.unsureButton.click((e) => {
            const action = e.isTrigger ? 'ValidationKeyboardShortcut_Unsure' : 'ValidationButtonClick_Unsure';
            svv.tracker.push(action);
            this.#setUnsureView();
            svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Unsure');
        });

        // Tag and severity sections only available with Expert Validate.
        if (svv.adminVersion) {
            // Add onclick for each severity button.
            const $severityButtons = menuUI.severityMenu.find('.severity-button');
            $severityButtons.click((e) => {
                const currLabel = svv.labelContainer.getCurrentLabel();
                const oldSeverity = currLabel.getProperty('newSeverity');
                const newSeverity = $(e.target).closest('.severity-button').data('severity');
                const labelType = currLabel.getAuditProperty('labelType');
                if (oldSeverity !== newSeverity && util.misc.labelTypeHasSeverity(labelType)) {
                    svv.tracker.push(`Click=Severity_Old=${oldSeverity}_New=${newSeverity}`);
                    currLabel.setProperty('newSeverity', newSeverity);
                    this.#renderSeverity();
                }
            });

            // Initialize the selectize object for tags (this is the auto-completing tag picker).
            this.#tagSelect = $('#select-tag').selectize({
                maxItems: 1,
                placeholder: 'Add more tags here',
                labelField: 'tag_name',
                valueField: 'tag_name',
                searchField: 'tag_name',
                sortField: 'popularity', // TODO include data abt frequency of use on this server.
                onFocus: () => {
                    svv.tracker.push('Click=TagSearch');
                },
                onItemAdd: (tagName) => {
                    this.#tagsAddedByUser.push(tagName);
                    this.#addTag(tagName, false);
                },
                render: {
                    option: (item, escape) => {
                        // Add an example image tooltip to the tag.
                        const translatedTagName = i18next.t(`common:tag.${item.tag_name.replace(/:/g, '-')}`);
                        const $tagDiv = $(`<div class="option tag-pill tag-pill--interactive">${escape(translatedTagName)}</div>`);
                        const tooltipText = `"${translatedTagName}" example`;
                        this.#addTooltip($tagDiv, tooltipText, `/assets/images/examples/tags/${item.tag_id}.png`);
                        return $tagDiv[0];
                    },
                },
            });
        }

        // Add onclick for disagree and unsure reason buttons.
        for (const reasonButton of this.#disagreeReasonButtons) {
            reasonButton.onclick = (e) => {
                if (e.isTrigger) {
                    svv.tracker.push(`KeyboardShortcut_DisagreeReason_Option=${$(reasonButton).attr('id')}`);
                } else {
                    svv.tracker.push(`Click=DisagreeReason_Option=${$(reasonButton).attr('id')}`);
                }
                this.#setDisagreeReason($(reasonButton).attr('id'));
            };
        }
        for (const reasonButton of this.#unsureReasonButtons) {
            reasonButton.onclick = (e) => {
                if (e.isTrigger) {
                    svv.tracker.push(`KeyboardShortcut_UnsureReason_Option=${$(reasonButton).attr('id')}`);
                } else {
                    svv.tracker.push(`Click=UnsureReason_Option=${$(reasonButton).attr('id')}`);
                }
                this.#setUnsureReason($(reasonButton).attr('id'));
            };
        }

        // Log clicks to the three text boxes.
        menuUI.optionalCommentTextBox.click((e) => {
            menuUI.optionalCommentTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=AgreeCommentTextbox' : 'Click=AgreeCommentTextbox';
            svv.tracker.push(action);
        });
        menuUI.disagreeReasonTextBox.click((e) => {
            menuUI.disagreeReasonTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=DisagreeReasonTextbox' : 'Click=DisagreeReasonTextbox';
            svv.tracker.push(action);
        });
        menuUI.unsureReasonTextBox.click((e) => {
            menuUI.unsureReasonTextBox.focus();
            const action = e.isTrigger ? 'KeyboardShortcut=UnsureReasonTextbox' : 'Click=UnsureReasonTextbox';
            svv.tracker.push(action);
        });

        // Add oninput for disagree and unsure other reason text boxes.
        menuUI.disagreeReasonTextBox.on('input', () => {
            if (menuUI.disagreeReasonTextBox.val() === '') {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
            } else {
                this.#setDisagreeReason('other');
            }
        });
        menuUI.unsureReasonTextBox.on('input', () => {
            if (menuUI.unsureReasonTextBox.val() === '') {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
            } else {
                this.#setUnsureReason('other');
            }
        });

        // Add onclick for submit button.
        menuUI.submitButton.click((e) => {
            if (!e.target.disabled) {
                this.#validateLabel(svv.labelContainer.getCurrentLabel().getProperty('validationResult'), e.isTrigger);
            }
        });
    }

    resetMenu(label) {
        const menuUI = this.#menuUI;
        this.#tagsAddedByUser = [];
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
            this.#disagreeReasonButtons.removeClass('chosen');
            this.#unsureReasonButtons.removeClass('chosen');
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            menuUI.unsureReasonTextBox.val('');

            // Update the text and tooltips on each disagree and unsure reason buttons.
            const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
            for (const reasonButton of this.#disagreeReasonButtons.add(this.#unsureReasonButtons)) {
                const $reasonButton = $(reasonButton);
                const buttonInfo = svv.reasonButtonInfo[labelType][$reasonButton.attr('id')];
                if (buttonInfo) {
                    $reasonButton.html(buttonInfo.buttonText);

                    // Remove any old tooltip (from a previous label type) and add a new tooltip.
                    $reasonButton.tooltip('destroy');
                    if (buttonInfo.tooltipImage) {
                        util.getImage(buttonInfo.tooltipImage).then((img) => {
                            this.#addTooltip($reasonButton, buttonInfo.tooltipText, img);
                        });
                    } else {
                        this.#addTooltip($reasonButton, buttonInfo.tooltipText);
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

            const disagreeOption = label.getProperty('disagreeOption');
            this.#disagreeReasonButtons.removeClass('chosen');
            if (disagreeOption === 'other') {
                menuUI.disagreeReasonTextBox.addClass('chosen');
                menuUI.disagreeReasonTextBox.val(label.getProperty('disagreeReasonTextBox'));
            } else {
                menuUI.disagreeReasonTextBox.removeClass('chosen');
                menuUI.disagreeReasonTextBox.val('');
                menuUI.disagreeReasonOptions.find(`#${disagreeOption}`).addClass('chosen');
            }

            const unsureOption = label.getProperty('unsureOption');
            this.#unsureReasonButtons.removeClass('chosen');
            if (unsureOption === 'other') {
                menuUI.unsureReasonTextBox.addClass('chosen');
                menuUI.unsureReasonTextBox.val(label.getProperty('unsureReasonTextBox'));
            } else {
                menuUI.unsureReasonTextBox.removeClass('chosen');
                menuUI.unsureReasonTextBox.val('');
                menuUI.unsureReasonOptions.find(`#${unsureOption}`).addClass('chosen');
            }

            if (prevValResult === 'Agree') this.#setYesView();
            else if (prevValResult === 'Disagree') this.#setNoView();
            else if (prevValResult === 'Unsure') this.#setUnsureView();
        }
    }

    #setYesView() {
        const menuUI = this.#menuUI;
        menuUI.yesButton.addClass('chosen');
        menuUI.noButton.removeClass('chosen');
        menuUI.unsureButton.removeClass('chosen');

        // Only show the tags and severity sections on Expert Validate.
        if (svv.adminVersion) {
            this.#renderTags();
            menuUI.tagsMenu.css('display', 'block');

            // Some label types (Pedestrian Signal, No Sidewalk) don't have severity ratings.
            const currLabelType = svv.labelContainer.getCurrentLabel().getAuditProperty('labelType');
            if (util.misc.labelTypeHasSeverity(currLabelType)) {
                this.#renderSeverity();
                menuUI.severityMenu.css('display', 'block');
            }
        }

        menuUI.optionalCommentSection.css('display', 'block');
        menuUI.noMenu.css('display', 'none');
        menuUI.unsureMenu.css('display', 'none');
        menuUI.submitButton.prop('disabled', false);
    }

    #setNoView() {
        const menuUI = this.#menuUI;
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

    #setUnsureView() {
        const menuUI = this.#menuUI;
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
     * @param {jQuery} $elem Element to add the tooltip to, as jquery wrapped object.
     * @param {string} tooltipText Text to display in the tooltip.
     * @param {string} [img] Optional image to display in the tooltip.
     */
    #addTooltip($elem, tooltipText, img) {
        const tooltipHtml = img ? `${tooltipText}<br/><img src="${img}" class="validate-tooltip-img"/>` : tooltipText;
        $elem.tooltip(({
            placement: 'auto top', // Prefer above the element, but flip below when it doesn't fit in the viewport.
            html: true,
            container: 'body',
            delay: { show: 500, hide: 10 },
            title: tooltipHtml,
        })).tooltip('show').tooltip('hide');
    }

    // TAG SECTION.
    #addTag(tagName, fromAiSuggestion = false) {
        const currLabel = svv.labelContainer.getCurrentLabel();

        // If the tag is mutually exclusive with another tag that's been added, remove the other tag.
        const allTags = svv.tagsByLabelType[currLabel.getAuditProperty('labelType')];
        const mutuallyExclusiveWith = allTags.find((t) => t.tag_name === tagName).mutually_exclusive_with;
        const currTags = currLabel.getProperty('newTags');
        if (currTags.some((t) => t === mutuallyExclusiveWith)) {
            svv.tracker.push(`TagAutoRemove_Tag="${mutuallyExclusiveWith}"`);
            currLabel.setProperty('newTags', currTags.filter((t) => t !== mutuallyExclusiveWith));
        }
        // New tag added, add to list and rerender.
        svv.tracker.push(`Click=TagAdd_Tag="${tagName}"_FromAiSuggestion=${fromAiSuggestion}`);
        currLabel.getProperty('newTags').push(tagName);
        this.#tagSelect[0].selectize.clear();
        this.#tagSelect[0].selectize.removeOption(tagName);
        this.#renderTags();
    }

    #removeTag(tagName, label, fromAiSuggestion = false) {
        svv.tracker.push(`Click=TagRemove_Tag="${tagName}"_FromAiSuggestion=${fromAiSuggestion}`);
        label.setProperty('newTags', label.getProperty('newTags').filter((t) => t !== tagName));
        this.#renderTags();
    }

    #removeTagListener(e, label) {
        const allTagOptions = structuredClone(svv.tagsByLabelType[label.getAuditProperty('labelType')]);
        const tagElem = $(e.target).parents('.current-tag');
        tagElem.tooltip('destroy');
        const tagIdToRemove = tagElem.data('tag-id');
        const tagToRemove = allTagOptions.find((t) => t.tag_id === tagIdToRemove).tag_name;
        this.#removeTag(tagToRemove, label, false);
    }

    #renderTags() {
        const menuUI = this.#menuUI;
        const label = svv.labelContainer.getCurrentLabel();
        let allTagOptions = structuredClone(svv.tagsByLabelType[label.getAuditProperty('labelType')]);
        const allTagOptionsPermanent = structuredClone(allTagOptions);

        menuUI.currentTags.empty();
        const currTags = label.getProperty('newTags');
        // Clone the template tag element, remove the 'template' class, update the text, and add the removal onclick.
        for (const tag of currTags) {
            if (!allTagOptions.some((t) => t.tag_name === tag)) {
                continue; // Skip tags that are now being excluded on this server. Don't want to show them.
            }

            // Clone the template tag element, remove the 'template' class, and add a tag-id data attribute.
            const $tagDiv = $('.current-tag.template').clone().removeClass('template');
            $tagDiv.data('tag-id', allTagOptions.find((t) => t.tag_name === tag).tag_id);

            // Update the tag name.
            const translatedTagName = i18next.t(`common:tag.${tag.replace(/:/g, '-')}`);
            $tagDiv.children('.tag-name').text(translatedTagName);

            // Add the removal onclick function.
            $tagDiv.children('.remove-tag-x').click((e) => this.#removeTagListener(e, label));

            // Add an example image tooltip to the tag.
            const tagId = allTagOptions.find((t) => t.tag_name === tag).tag_id;
            const tooltipText = `"${translatedTagName}" example`;
            this.#addTooltip($tagDiv, tooltipText, `/assets/images/examples/tags/${tagId}.png`);

            // Add to current list of tags, and remove from options for new tags to add.
            menuUI.currentTags.append($tagDiv);
            allTagOptions = allTagOptions.filter((t) => t.tag_name !== tag);
        }

        // Show/hide elem for list of tags to hide extra spacing b/w elements when there are no tags to show.
        if (currTags.length === 0) {
            menuUI.currentTags.css('display', 'none');
        } else {
            menuUI.currentTags.css('display', 'flex');
        }

        // Clear the possible tags to add and add all appropriate options.
        this.#tagSelect[0].selectize.clearOptions();
        this.#tagSelect[0].selectize.addOption(allTagOptions);

        // AI SUGGESTION TAGS SECTION.
        // Remove all AI suggested tags from the previous label.
        $('.sidewalk-ai-suggested-tag:not(.template)').remove();

        // Decide which tags AI is suggesting to add or remove. If null, AI suggestion disabled on this server.
        let aiAddTagOptions = [];
        let aiRemoveTagOptions = [];
        if (label.getAuditProperty('aiTags') !== null) {
            const aiTags = label.getAuditProperty('aiTags');
            aiAddTagOptions = allTagOptions.filter((t) => aiTags.includes(t.tag_name));
        }
        if (label.getAuditProperty('aiTagsNotPresent') !== null) {
            const aiTagsNotPresent = label.getAuditProperty('aiTagsNotPresent');
            // Only suggest removing tags that are currently on the label and were not added by the user this session.
            aiRemoveTagOptions = currTags
                .filter((t) => aiTagsNotPresent.includes(t))
                .filter((t) => !this.#tagsAddedByUser.includes(t))
                .map((t) => allTagOptionsPermanent.find((t2) => t2.tag_name === t))
                .filter((t) => t !== undefined);
        }

        // If there are AI suggestions, show the section and add the tag suggestions.
        if (aiAddTagOptions.length > 0 || aiRemoveTagOptions.length > 0) {
            menuUI.aiSuggestionSection.show();

            // Log the AI suggestions.
            svv.tracker.push(`ShowingAiSuggestions`, {
                add:    `"${aiAddTagOptions.map((t) => t.tag_name).join()}"`,
                remove: `"${aiRemoveTagOptions.map((t) => t.tag_name).join()}"`,
            });

            // Loops through the AI-suggested tags and display them.
            for (const tag of [...aiAddTagOptions.map((t) => ({ ...t, action: 'add' })), ...aiRemoveTagOptions.map((t) => ({ ...t, action: 'remove' }))]) {
                // Clone the template tag element, and set all appropriate classes.
                const template = menuUI.aiSuggestedTagTemplate.clone(true);
                template.removeClass('template').addClass(tag.action === 'add' ? 'to-add' : 'to-remove');

                // Add the text to the tag.
                const translatedTagName = i18next.t(`common:tag.${tag.tag_name.replace(/:/g, '-')}`);
                const addRemoveTranslationKey = `expert-validate.${tag.action === 'add' ? 'add-tag' : 'remove-tag'}`;
                template.text(i18next.t(addRemoveTranslationKey, {
                    tag: translatedTagName,
                    interpolation: { escapeValue: false },
                }));
                menuUI.aiSuggestedTagTemplate.parent().append(template);

                // Show tooltip with example image for the tag.
                const tooltipText = `"${translatedTagName}" example`;
                this.#addTooltip(template, tooltipText, `/assets/images/examples/tags/${tag.tag_id}.png`);

                // Add onclick to the tag to add or remove it if the user clicks to accept the AI suggestion.
                template.on('click', () => {
                    template.tooltip('destroy'); // Fix for the tooltip showing up on later labels, #4071.
                    if (tag.action === 'add') {
                        this.#addTag(tag.tag_name, true);
                    } else {
                        this.#removeTag(tag.tag_name, label, true);
                    }
                });
            }
        } else {
            menuUI.aiSuggestionSection.hide();
        }
    }

    // SEVERITY SECTION.
    #renderSeverity() {
        const menuUI = this.#menuUI;
        const label = svv.labelContainer.getCurrentLabel();
        const severity = label.getProperty('newSeverity');
        const labelType = svv.labelContainer.getCurrentLabel().getAuditProperty('labelType');
        const positive = util.misc.isPositiveLabelType(labelType);
        const tooltipKey = positive ? 'quality-example-tooltip' : 'severity-example-tooltip';
        const headerKey = positive ? 'update-quality-level' : 'update-severity-level';
        const levelKeys = util.misc.getRatingLevelKeys(labelType);

        // Swap the header text and per-level labels between severity and quality wording based on label type.
        const headerEl = document.getElementById('validate-severity-header');
        if (headerEl) headerEl.textContent = i18next.t(`common:${headerKey}`);

        // Add example image tooltips to the severity buttons after removing old ones (in case label type changed).
        for (const severityButton of menuUI.severityMenu.find('.severity-button')) {
            const $button = $(severityButton);
            const sev = severityButton.dataset.severity;
            const tooltipText = i18next.t(`common:${tooltipKey}-${sev}`);
            const tooltipImage = `/assets/images/examples/severity/${labelType}_Severity${sev}.png`;
            $button.tooltip('destroy');
            this.#addTooltip($button, tooltipText, tooltipImage);

            const labelSpan = severityButton.querySelector('.severity-button__label');
            if (labelSpan) labelSpan.textContent = i18next.t(`common:${levelKeys[Number(sev)]}`);
        }

        // Swap the smiley <img> src for each severity level based on label type + selection.
        const holder = document.getElementById('severity-radio-holder');
        if (holder) {
            holder.querySelectorAll('.severity-button').forEach((button) => {
                const sev = Number(button.dataset.severity);
                const img = button.querySelector('.severity-button__icon');
                if (img) img.src = util.misc.getSmileyIconPath(sev, labelType, sev === Number(severity));
            });
        }
    }

    // VALIDATING 'NO' SECTION
    #setDisagreeReason(id) {
        const menuUI = this.#menuUI;
        this.#disagreeReasonButtons.removeClass('chosen');
        if (id === 'other') {
            menuUI.disagreeReasonTextBox.addClass('chosen');
            svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', 'other');
        } else {
            menuUI.disagreeReasonTextBox.removeClass('chosen');
            menuUI.disagreeReasonTextBox.val('');
            svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', id);
            menuUI.disagreeReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    // VALIDATING 'UNSURE' SECTION
    #setUnsureReason(id) {
        const menuUI = this.#menuUI;
        this.#unsureReasonButtons.removeClass('chosen');
        if (id === 'other') {
            menuUI.unsureReasonTextBox.addClass('chosen');
            svv.labelContainer.getCurrentLabel().setProperty('unsureOption', 'other');
        } else {
            menuUI.unsureReasonTextBox.removeClass('chosen');
            menuUI.unsureReasonTextBox.val('');
            svv.labelContainer.getCurrentLabel().setProperty('unsureOption', id);
            menuUI.unsureReasonOptions.find(`#${id}`).addClass('chosen');
        }
    }

    saveValidationState() {
        const menuUI = this.#menuUI;
        const currLabel = svv.labelContainer.getCurrentLabel();
        currLabel.setProperty('agreeComment', menuUI.optionalCommentTextBox.val());
        currLabel.setProperty('disagreeReasonTextBox', menuUI.disagreeReasonTextBox.val());
        currLabel.setProperty('unsureReasonTextBox', menuUI.unsureReasonTextBox.val());
    }

    /**
     * Validates a single label from a button click.
     * @param {string} action Validation action - must be one of Agree, Disagree, or Unsure.
     * @param {boolean} keyboardShortcut Whether or not the validation was triggered by a keyboard shortcut.
     */
    #validateLabel(action, keyboardShortcut) {
        const menuUI = this.#menuUI;
        const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
        const timestamp = new Date();
        svv.tracker.push(actionStr + action);
        const currLabel = svv.labelContainer.getCurrentLabel();

        // Resets CSS elements for all buttons to their default states.
        menuUI.yesButton.removeClass('validate');
        menuUI.noButton.removeClass('validate');
        menuUI.unsureButton.removeClass('validate');

        // Save anything they typed in either text box so that it's there again if they undo their validation.
        this.saveValidationState();

        // Fill in the comment based on the disagree options they picked or one of the free form text boxes.
        let comment = '';
        if (action === 'Agree') {
            comment = currLabel.getProperty('agreeComment');
        } else if (action === 'Disagree') {
            const disagreeReason = currLabel.getProperty('disagreeOption');
            if (disagreeReason === 'other') {
                comment = currLabel.getProperty('disagreeReasonTextBox');
            } else if (disagreeReason) {
                comment = menuUI.disagreeReasonOptions.find(`#${disagreeReason}`).html().replace('<br>', ' ');
            } else {
                comment = '';
            }
        } else if (action === 'Unsure') {
            const unsureReason = currLabel.getProperty('unsureOption');
            if (unsureReason === 'other') {
                comment = currLabel.getProperty('unsureReasonTextBox');
            } else if (unsureReason) {
                comment = menuUI.unsureReasonOptions.find(`#${unsureReason}`).html().replace('<br>', ' ');
            } else {
                comment = '';
            }
        }
        currLabel.setProperty('comment', comment);

        // If enough time has passed between validations, log the new validation.
        if (timestamp - svv.labelContainer.getProperty('validationTimestamp') > 800) {
            svv.labelContainer.validateCurrentLabel(action, timestamp, comment);
        }
    }
}
