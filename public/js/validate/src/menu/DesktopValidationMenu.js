/**
 * Initializes the primary validation UI on the right side, including validation of tags/severity.
 */
class DesktopValidationMenu {
  #menuUI;
  #disagreeReasonButtons;
  #unsureReasonButtons;
  #tagSelect;
  #tagsAddedByUser = [];
  /** @type {LabelTypePicker|null} Expert Validate only (#3671). */
  #labelTypePicker = null;
  #wrongTypeView = false;

  /**
   * @param {Record<string, JQuery>} menuUI - Validation menu UI elements.
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
      // The menu is dimmed and pointer-blocked while the next label's pano loads, but a button that kept focus after
      // a click still answers Enter with a native click of its own, which no CSS stops (#5211).
      if (svv.labelContainer.dropInputWhileLoading('Agree')) return;
      const action = e.isTrigger ? 'ValidationKeyboardShortcut_Agree' : 'ValidationButtonClick_Agree';
      svv.tracker.push(action);
      this.#setYesView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Agree');
    });
    menuUI.noButton.click((e) => {
      if (svv.labelContainer.dropInputWhileLoading('Disagree')) return;
      const action = e.isTrigger ? 'ValidationKeyboardShortcut_Disagree' : 'ValidationButtonClick_Disagree';
      svv.tracker.push(action);
      this.#setNoView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Disagree');
    });
    menuUI.unsureButton.click((e) => {
      if (svv.labelContainer.dropInputWhileLoading('Unsure')) return;
      const action = e.isTrigger ? 'ValidationKeyboardShortcut_Unsure' : 'ValidationButtonClick_Unsure';
      svv.tracker.push(action);
      this.#setUnsureView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Unsure');
    });

    // Tag and severity sections only available with Expert Validate.
    if (svv.adminVersion) {
      this.#labelTypePicker = new LabelTypePicker(menuUI.labelTypePicker[0], {
        onPick: (labelType) => this.#setNewLabelType(labelType),
        // The full set of chips plus the editors would overflow the menu column, so only one shows at a time.
        onToggle: (expanded) => {
          if (expanded) this.#showVerdict(menuUI.noButton, ['labelTypeMenu']);
          else this.#setWrongTypeView();
        },
      });

      // Add onclick for each severity button.
      const $severityButtons = menuUI.severityMenu.find('.severity-button');
      $severityButtons.click((e) => {
        // Reachable mid-load by keyboard even though the menu is dimmed and pointer-blocked: each button is a label
        // around a radio that is only visually hidden, so it still takes focus, and an arrow key roves the group
        // natively. The viewers stopPropagation those keydowns but nothing preventDefaults them, so the roving still
        // fires a click here — writing a severity onto the label that isn't on screen yet, where resetMenu hides the
        // menu but leaves the value on the label, and it is submitted as a change nobody made (#5211).
        if (svv.labelContainer.dropInputWhileLoading('Severity')) return;
        const currLabel = svv.labelContainer.getCurrentLabel();
        const oldSeverity = currLabel.getProperty('newSeverity');
        const newSeverity = $(e.target).closest('.severity-button').data('severity');
        const labelType = currLabel.getProperty('newLabelType');
        if (oldSeverity !== newSeverity && util.misc.labelTypeHasSeverity(labelType)) {
          svv.tracker.push(`Click=Severity_Old=${oldSeverity}_New=${newSeverity}`);
          currLabel.setProperty('newSeverity', newSeverity);
          this.#renderSeverity();
          svv.labelCard?.render(currLabel);
        }
      });

      // Capped at one item: a pick goes straight to the tag list through onItemAdd, then the box clears.
      this.#tagSelect = new TomSelect('#select-tag', {
        maxItems: 1,
        placeholder: i18next.t('validate:validate-menu.tag-search-placeholder'),
        refreshThrottle: 0, // Filter on every keystroke, so a quick Enter picks from the current list.
        labelField: 'tag_name',
        valueField: 'tag_name',
        searchField: 'tag_name',
        sortField: 'popularity', // TODO include data abt frequency of use on this server.
        onFocus: () => {
          svv.tracker.push('Click=TagSearch');
        },
        onItemAdd: (tagName) => {
          // Guarded ahead of #addTag's own guard, which is one line too late for this list: mid-load the tag is not
          // added but would still be remembered as user-added, and #tagsAddedByUser is what suppresses an AI
          // suggestion to remove a tag. resetMenu has already cleared it for the incoming label by then, so the
          // entry would be attributed to a label the validator never touched (#5211).
          if (svv.labelContainer.dropInputWhileLoading('TagAdd')) return;
          this.#tagsAddedByUser.push(tagName);
          this.#addTag(tagName, false);
        },
        render: {
          no_results: () => {
            return `<div class="no-results">${i18next.t('validate:validate-menu.tag-search-no-results')}</div>`;
          },
          option: (item) => {
            // Add an example image tooltip to the tag.
            const translatedTagName = i18next.t(`common:tag.${item.tag_name.replace(/:/g, '-')}`);
            const tagDiv = document.createElement('div');
            tagDiv.className = 'tag-pill tag-pill--interactive';
            tagDiv.textContent = translatedTagName;
            const tooltipText = `"${translatedTagName}" example`;
            this.#addTooltip(tagDiv, tooltipText, util.assetPath(`images/examples/tags/${item.tag_id}.png`));
            return tagDiv;
          },
        },
      });
      // Gives the box a name for screen readers, using the header above it.
      this.#tagSelect.control_input.setAttribute('aria-labelledby', 'validate-tags-header');
    }

    // Add onclick for disagree and unsure reason buttons.
    // Both loops guard ahead of their tracker push rather than leaving it to the setter they call: the push
    // would otherwise record the reason as chosen and the drop would be logged right after it, so the one
    // interaction the load guard exists to refuse is the one that reads in the logs as having landed (#5211).
    for (const reasonButton of this.#disagreeReasonButtons) {
      reasonButton.onclick = (e) => {
        if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
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
        if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
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
    // Guarded at the handler, not left to the setter each one calls: the empty branch writes the cleared reason onto
    // the current label directly, so without this the two branches would answer a mid-load event differently. They
    // are believed unreachable then — KeyboardManager goes inert while a reason box has focus, so a load cannot start
    // from there, and once one has the box is only reachable by pointer, which is blocked — but half a guard on a
    // handler is a trap for whoever changes it next (#5211).
    menuUI.disagreeReasonTextBox.on('input', () => {
      if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
      if (menuUI.disagreeReasonTextBox.val() === '') {
        menuUI.disagreeReasonTextBox.removeClass('chosen');
        svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
      } else {
        this.#setDisagreeReason('other');
      }
    });
    menuUI.unsureReasonTextBox.on('input', () => {
      if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
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

    // Rerender the reason buttons, so that they match the correct label type when we allow such an undo (#4034).
    this.#renderReasonButtons(label);

    if (prevValResult === undefined) {
      // This is a new label (not returning from an undo), so reset everything.
      menuUI.yesButton.removeClass('chosen');
      menuUI.noButton.removeClass('chosen');
      menuUI.unsureButton.removeClass('chosen');
      menuUI.labelTypeMenu.css('display', 'none');
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

      // An Agree carrying a new type is a "wrong label type" disagree.
      if (prevValResult === 'Agree' && this.#typeChanged(label)) this.#setWrongTypeView();
      else if (prevValResult === 'Agree') this.#setYesView();
      else if (prevValResult === 'Disagree') this.#setNoView();
      else if (prevValResult === 'Unsure') this.#setUnsureView();
    }
  }

  /**
   * Fills in the text, tooltip, and visibility of every disagree and unsure reason button for a label's type.
   *
   * The buttons are one shared set of elements, so a type that offers a given reason gets it shown and marked
   * `defaultOption` — the flag the number-key shortcuts check — while a type that doesn't offer it gets it hidden.
   *
   * @param {Label} label - The label whose type the buttons should describe.
   */
  #renderReasonButtons(label) {
    const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
    for (const reasonButton of this.#disagreeReasonButtons.add(this.#unsureReasonButtons)) {
      const $reasonButton = $(reasonButton);
      const buttonInfo = svv.reasonButtonInfo[labelType][$reasonButton.attr('id')];
      if (buttonInfo) {
        $reasonButton.html(buttonInfo.buttonText);

        // Remove any old tooltip (from a previous label type) and add a new tooltip.
        $reasonButton.removeAttr('data-ps-tooltip');
        if (buttonInfo.tooltipImage) {
          util.getImage(buttonInfo.tooltipImage).then((img) => {
            this.#addTooltip(reasonButton, buttonInfo.tooltipText, img);
          });
        } else {
          this.#addTooltip(reasonButton, buttonInfo.tooltipText);
        }

        $reasonButton.addClass('defaultOption');
        $reasonButton.css('display', 'flex');
      } else {
        $reasonButton.css('display', 'none');
        $reasonButton.removeClass('defaultOption');
      }
    }
  }

  /** @returns {boolean} */
  #typeChanged(label) {
    return label.getProperty('newLabelType') !== label.getProperty('oldLabelType');
  }

  /** @returns {boolean} Whether the menu is on the "wrong label type" disagree, where the type picker stands in
   *     for the reasons (#5409). */
  inWrongTypeView() {
    return this.#wrongTypeView;
  }

  /**
   * Every view routes through here so a section can't be left showing from the previous verdict.
   * @param {JQuery} chosenButton
   * @param {string[]} sections - Names of the `menuUI` sections to show; the rest are hidden.
   */
  #showVerdict(chosenButton, sections) {
    const menuUI = this.#menuUI;
    this.#wrongTypeView = sections.includes('labelTypeMenu');
    for (const button of [menuUI.yesButton, menuUI.noButton, menuUI.unsureButton]) {
      button.toggleClass('chosen', button === chosenButton);
    }
    const all = ['labelTypeMenu', 'tagsMenu', 'severityMenu', 'optionalCommentSection', 'noMenu', 'unsureMenu'];
    for (const name of all) menuUI[name].css('display', sections.includes(name) ? 'block' : 'none');
  }

  /**
   * Renders the tag and severity editors for the type being validated as (Expert Validate only).
   * @returns {string[]} The sections to show; severity is left out for unrated types.
   */
  #editSections() {
    if (!svv.adminVersion) return [];
    this.#renderTags();
    const labelType = svv.labelContainer.getCurrentLabel().getProperty('newLabelType');
    if (!util.misc.labelTypeHasSeverity(labelType)) return ['tagsMenu'];
    this.#renderSeverity();
    return ['tagsMenu', 'severityMenu'];
  }

  #setYesView() {
    this.#dropPickedType();
    this.#showVerdict(this.#menuUI.yesButton, [...this.#editSections(), 'optionalCommentSection']);
    this.#menuUI.submitButton.prop('disabled', false);
  }

  /** Puts the label back on its own type, for a verdict that isn't "wrong label type" and so can't carry a new one. */
  #dropPickedType() {
    const currLabel = svv.labelContainer.getCurrentLabel();
    if (this.#typeChanged(currLabel)) this.#setNewLabelType(currLabel.getProperty('oldLabelType'), false);
  }

  /**
   * Puts back the type, rating and tags the labeler filed. Only an Agree saves an edit, so a Disagree or an Unsure
   * must not leave one showing on the card as though Submit would keep it.
   */
  #dropPendingEdits() {
    const currLabel = svv.labelContainer.getCurrentLabel();
    const hadNewType = this.#typeChanged(currLabel);
    currLabel.setNewLabelType(currLabel.getProperty('oldLabelType'));
    this.#tagsAddedByUser = [];
    if (hadNewType) svv.panoManager.styleMarkerForLabel(currLabel);
    svv.labelCard?.render(currLabel);
  }

  #setNoView() {
    this.#dropPendingEdits();
    this.#showVerdict(this.#menuUI.noButton, ['noMenu']);
    this.#menuUI.submitButton.prop('disabled', false);
  }

  #setUnsureView() {
    this.#dropPendingEdits();
    this.#showVerdict(this.#menuUI.unsureButton, ['unsureMenu']);
    this.#menuUI.submitButton.prop('disabled', false);
  }

  /**
   * The "wrong label type" disagree (#3671, #5409): the reasons give way to the type picker, and then to the editors
   * for the picked type. Submit stays off until a type is picked; without one there is nothing to say.
   */
  #setWrongTypeView() {
    const currLabel = svv.labelContainer.getCurrentLabel();
    const picked = this.#typeChanged(currLabel) ? currLabel.getProperty('newLabelType') : null;
    this.#labelTypePicker.render({ current: currLabel.getProperty('oldLabelType'), selected: picked });
    this.#labelTypePicker.collapse(); // Keeps the editors below within the menu column; a no-op before a pick.
    const sections = picked ? [...this.#editSections(), 'optionalCommentSection'] : [];
    this.#showVerdict(this.#menuUI.noButton, ['labelTypeMenu', ...sections]);
    this.#menuUI.submitButton.prop('disabled', picked === null);
  }

  /**
   * Records the picked type and redraws what's keyed on it, including the pano marker so the change shows on the label.
   * @param {string} labelType
   * @param {boolean} [redraw] - False when the caller is about to draw a different verdict's view anyway.
   */
  #setNewLabelType(labelType, redraw = true) {
    if (svv.labelContainer.dropInputWhileLoading('LabelType')) return;
    const currLabel = svv.labelContainer.getCurrentLabel();
    const oldType = currLabel.getProperty('newLabelType');
    if (labelType === oldType) return;
    svv.tracker.push(`Click=NewLabelType_Old=${oldType}_New=${labelType}`);
    currLabel.setNewLabelType(labelType);
    this.#tagsAddedByUser = [];
    svv.panoManager.styleMarkerForLabel(currLabel);
    svv.labelCard?.render(currLabel);
    if (redraw) this.#setWrongTypeView();
  }

  /**
   * Switches to the "wrong label type" disagree. It is submitted as an Agree on the picked type, since only an
   * admin's Agree can carry an edit.
   */
  #startWrongType() {
    const currLabel = svv.labelContainer.getCurrentLabel();
    this.#disagreeReasonButtons.removeClass('chosen');
    this.#menuUI.disagreeReasonTextBox.removeClass('chosen');
    currLabel.setProperty('disagreeOption', null);
    this.#setWrongTypeView();
    currLabel.setProperty('validationResult', 'Agree');
  }

  /**
   * A type picked from the label card's dropdown (#5409): the same as the "wrong label type" reason plus a pick.
   * @param {string} labelType
   */
  pickNewLabelType(labelType) {
    if (svv.labelContainer.dropInputWhileLoading('LabelType')) return;
    this.#startWrongType();
    this.#setNewLabelType(labelType);
  }

  /**
   * Adds a tooltip to the given element with the given text and image (if given).
   * @param {Element} elem - Element to add the tooltip to.
   * @param {string} tooltipText - Text to display in the tooltip.
   * @param {string} [img] - Optional image to display in the tooltip.
   */
  #addTooltip(elem, tooltipText, img) {
    if (!window.matchMedia('(hover: hover)').matches) return; // A tap would pin it open on a touch device.
    const tooltipHtml = img ? `${tooltipText}<br/><img src="${img}" class="validate-tooltip-img"/>` : tooltipText;
    elem.setAttribute('data-ps-tooltip', tooltipHtml);
  }

  // TAG SECTION.
  #addTag(tagName, fromAiSuggestion = false) {
    // Guarded at the write rather than at its two entry points (the tag picker and the AI suggestions), so a third
    // can't reach the current label mid-load just by not knowing to guard itself (#5211).
    if (svv.labelContainer.dropInputWhileLoading('TagAdd')) return;
    const currLabel = svv.labelContainer.getCurrentLabel();

    // If the tag is mutually exclusive with another tag that's been added, remove the other tag.
    const allTags = svv.tagsByLabelType[currLabel.getProperty('newLabelType')] ?? [];
    const mutuallyExclusiveWith = allTags.find((t) => t.tag_name === tagName).mutually_exclusive_with;
    const currTags = currLabel.getProperty('newTags');
    if (currTags.some((t) => t === mutuallyExclusiveWith)) {
      svv.tracker.push(`TagAutoRemove_Tag="${mutuallyExclusiveWith}"`);
      currLabel.setProperty('newTags', currTags.filter((t) => t !== mutuallyExclusiveWith));
    }
    // New tag added, add to list and rerender.
    svv.tracker.push(`Click=TagAdd_Tag="${tagName}"_FromAiSuggestion=${fromAiSuggestion}`);
    currLabel.getProperty('newTags').push(tagName);
    this.#tagSelect.clear();
    this.#tagSelect.removeOption(tagName);
    this.#renderTags();
    svv.labelCard?.render(currLabel);
  }

  #removeTag(tagName, label, fromAiSuggestion = false) {
    // Mid-load `label` is the one that just left the screen and was already submitted, so this write goes nowhere —
    // while #renderTags below reads getCurrentLabel() instead, drawing the tags of a label nobody can see yet (#5211).
    if (svv.labelContainer.dropInputWhileLoading('TagRemove')) return;
    svv.tracker.push(`Click=TagRemove_Tag="${tagName}"_FromAiSuggestion=${fromAiSuggestion}`);
    label.setProperty('newTags', label.getProperty('newTags').filter((t) => t !== tagName));
    this.#renderTags();
    svv.labelCard?.render(label);
  }

  #removeTagListener(e, label) {
    const allTagOptions = structuredClone(svv.tagsByLabelType[label.getProperty('newLabelType')] ?? []);
    const tagElem = $(e.target).parents('.current-tag');
    tagElem.removeAttr('data-ps-tooltip');
    const tagIdToRemove = tagElem.data('tag-id');
    const tagToRemove = allTagOptions.find((t) => t.tag_id === tagIdToRemove).tag_name;
    this.#removeTag(tagToRemove, label, false);
  }

  #renderTags() {
    const menuUI = this.#menuUI;
    const label = svv.labelContainer.getCurrentLabel();
    let allTagOptions = structuredClone(svv.tagsByLabelType[label.getProperty('newLabelType')] ?? []);
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

      const removeLabel = i18next.t('validate:validate-menu.remove-tag', { tag: translatedTagName });
      $tagDiv.children('.remove-tag-x').attr('aria-label', removeLabel).click((e) => this.#removeTagListener(e, label));

      // Add an example image tooltip to the tag.
      const tagId = allTagOptions.find((t) => t.tag_name === tag).tag_id;
      const tooltipText = `"${translatedTagName}" example`;
      this.#addTooltip($tagDiv[0], tooltipText, util.assetPath(`images/examples/tags/${tagId}.png`));

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
    this.#tagSelect.clearOptions();
    this.#tagSelect.addOption(allTagOptions);

    // AI SUGGESTION TAGS SECTION.
    // Remove all AI suggested tags from the previous label.
    $('.sidewalk-ai-suggested-tag:not(.template)').remove();

    // Decide which tags AI is suggesting to add or remove. If null, AI suggestion disabled on this server. The AI
    // judged the original type, so its suggestions say nothing about a type the expert just picked.
    let aiAddTagOptions = [];
    let aiRemoveTagOptions = [];
    const aiApplies = !this.#typeChanged(label);
    if (aiApplies && label.getAuditProperty('aiTags') !== null) {
      const aiTags = label.getAuditProperty('aiTags');
      aiAddTagOptions = allTagOptions.filter((t) => aiTags.includes(t.tag_name));
    }
    if (aiApplies && label.getAuditProperty('aiTagsNotPresent') !== null) {
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
      const aiTagOptions = [
        ...aiAddTagOptions.map((t) => ({ ...t, action: 'add' })),
        ...aiRemoveTagOptions.map((t) => ({ ...t, action: 'remove' })),
      ];
      for (const tag of aiTagOptions) {
        // Clone the template tag element, and set all appropriate classes.
        const template = menuUI.aiSuggestedTagTemplate.clone(true);
        template.removeClass('template').addClass(tag.action === 'add' ? 'to-add' : 'to-remove');

        // Add the text to the tag.
        const translatedTagName = i18next.t(`common:tag.${tag.tag_name.replace(/:/g, '-')}`);
        const addRemoveTranslationKey = `expert-validate.${tag.action === 'add' ? 'add-tag' : 'remove-tag'}`;
        template.text(i18next.t(addRemoveTranslationKey, { tag: translatedTagName }));
        menuUI.aiSuggestedTagTemplate.parent().append(template);

        // Show tooltip with example image for the tag.
        const tooltipText = `"${translatedTagName}" example`;
        this.#addTooltip(template[0], tooltipText, util.assetPath(`images/examples/tags/${tag.tag_id}.png`));

        // Add onclick to the tag to add or remove it if the user clicks to accept the AI suggestion.
        template.on('click', () => {
          template.removeAttr('data-ps-tooltip'); // Fix for the tooltip showing up on later labels, #4071.
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
    const labelType = label.getProperty('newLabelType');
    const positive = util.misc.isPositiveLabelType(labelType);
    const tooltipKey = positive ? 'quality-example-tooltip' : 'severity-example-tooltip';
    const headerKey = positive ? 'update-quality-level' : 'update-severity-level';
    const levelKeys = util.misc.getRatingLevelKeys(labelType);

    // Swap the header text and per-level labels between severity and quality wording based on label type.
    const headerEl = document.getElementById('validate-severity-header');
    if (headerEl) headerEl.textContent = i18next.t(`common:${headerKey}`);

    // Add example image tooltips to the severity buttons after removing old ones (in case label type changed).
    for (const severityButton of menuUI.severityMenu.find('.severity-button')) {
      const sev = severityButton.dataset.severity;
      const tooltipText = i18next.t(`common:${tooltipKey}-${sev}`);
      const tooltipImage = util.assetPath(`images/examples/severity/${labelType}_Severity${sev}.png`);
      this.#addTooltip(severityButton, tooltipText, tooltipImage);

      const labelSpan = severityButton.querySelector('.severity-button__label');
      if (labelSpan) labelSpan.textContent = i18next.t(`common:${levelKeys[Number(sev)]}`);
    }

    // Swap the smiley <img> src for each severity level based on label type + selection.
    const holder = document.getElementById('severity-radio-holder');
    if (holder) {
      holder.querySelectorAll('.severity-button').forEach((button) => {
        const sev = Number(button.dataset.severity);
        const img = /** @type {HTMLImageElement} */ (button.querySelector('.severity-button__icon'));
        if (img) img.src = util.misc.getSmileyIconPath(sev, labelType, sev === Number(severity));
        // The radio is the only thing carrying the selection into the accessibility tree — the smiley above is an
        // <img> swap, which announces nothing — and the holder is a `radiogroup`, so the checked radio is what a
        // screen reader reads back as the current rating. Nothing else writes it: a native click on the wrapping
        // label checks it, and it then stays checked across labels, so an unrated label would announce the previous
        // one's rating and an undo would announce whatever was clicked last rather than what it stored. NaN when
        // there is no rating, which no `sev` equals, so the whole group goes unchecked.
        const radio = /** @type {HTMLInputElement} */ (button.querySelector('.severity-button__radio'));
        if (radio) radio.checked = sev === Number(severity);
      });
    }
  }

  // VALIDATING 'NO' SECTION
  /**
   * Records the reason chosen for a disagree verdict.
   *
   * Guarded because a reason button keeps focus after a click, and Enter natively activates a focused button whether
   * or not KeyboardManager is listening — so a second Enter inside the load window writes the reason onto the label
   * that hasn't appeared on screen yet (#5211). `resetMenu` clears the chosen styling for a new label but not its
   * properties, so the reason would ride along invisibly and be submitted as the canned comment for a reason nobody
   * picked for the label it lands on.
   *
   * @param {string} id - Id of the chosen reason button, or 'other' for the free-text box.
   */
  #setDisagreeReason(id) {
    if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
    const menuUI = this.#menuUI;
    const currLabel = svv.labelContainer.getCurrentLabel();
    const reasonInfo = svv.reasonButtonInfo[util.camelToKebab(currLabel.getAuditProperty('labelType'))]?.[id];
    // Where the type can be changed, it opens the picker instead of becoming a comment nobody acts on (#5409).
    if (svv.adminVersion && reasonInfo?.wrongType) {
      this.#startWrongType();
      return;
    }
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
  /**
   * Records the reason chosen for an unsure verdict.
   *
   * Guarded because a reason button keeps focus after a click, and Enter natively activates a focused button whether
   * or not KeyboardManager is listening — so a second Enter inside the load window writes the reason onto the label
   * that hasn't appeared on screen yet (#5211). `resetMenu` clears the chosen styling for a new label but not its
   * properties, so the reason would ride along invisibly and be submitted as the canned comment for a reason nobody
   * picked for the label it lands on.
   *
   * @param {string} id - Id of the chosen reason button, or 'other' for the free-text box.
   */
  #setUnsureReason(id) {
    if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
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
   * @param {string} action - Validation action - must be one of Agree, Disagree, or Unsure.
   * @param {boolean} keyboardShortcut - Whether or not the validation was triggered by a keyboard shortcut.
   */
  #validateLabel(action, keyboardShortcut) {
    // Everything below writes to whatever getCurrentLabel() returns, which mid-load is already the next label (#5211).
    if (svv.labelContainer.dropInputWhileLoading(`Submit=${action}`)) return;

    const menuUI = this.#menuUI;
    const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
    const timestamp = new Date();
    const currLabel = svv.labelContainer.getCurrentLabel();
    const typeNote = this.#typeChanged(currLabel) ? `_NewLabelType=${currLabel.getProperty('newLabelType')}` : '';
    svv.tracker.push(actionStr + action + typeNote);

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
    if (timestamp.getTime() - svv.labelContainer.getProperty('validationTimestamp') > 800) {
      svv.labelContainer.validateCurrentLabel(action, timestamp, comment);
    }
  }
}
