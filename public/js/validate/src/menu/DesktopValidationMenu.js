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
   * @param {Record<string, HTMLElement>} menuUI - Validation menu UI elements.
   */
  constructor(menuUI) {
    this.#menuUI = menuUI;
    this.#disagreeReasonButtons = DesktopValidationMenu.#reasonButtonsIn(menuUI.disagreeReasonOptions);
    this.#unsureReasonButtons = DesktopValidationMenu.#reasonButtonsIn(menuUI.unsureReasonOptions);

    this.#init();
  }

  #init() {
    const menuUI = this.#menuUI;

    // Add onclick for each validation button. A keyboard shortcut clicks the button by script, which is the one
    // kind of click the browser doesn't mark as trusted; that is what tells the two apart in the logs.
    menuUI.yesButton.addEventListener('click', (e) => {
      // The menu is dimmed and pointer-blocked while the next label's pano loads, but a button that kept focus after
      // a click still answers Enter with a native click of its own, which no CSS stops (#5211).
      if (svv.labelContainer.dropInputWhileLoading('Agree')) return;
      svv.tracker.push(e.isTrusted ? 'ValidationButtonClick_Agree' : 'ValidationKeyboardShortcut_Agree');
      this.#setYesView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Agree');
    });
    menuUI.noButton.addEventListener('click', (e) => {
      if (svv.labelContainer.dropInputWhileLoading('Disagree')) return;
      svv.tracker.push(e.isTrusted ? 'ValidationButtonClick_Disagree' : 'ValidationKeyboardShortcut_Disagree');
      this.#setNoView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Disagree');
    });
    menuUI.unsureButton.addEventListener('click', (e) => {
      if (svv.labelContainer.dropInputWhileLoading('Unsure')) return;
      svv.tracker.push(e.isTrusted ? 'ValidationButtonClick_Unsure' : 'ValidationKeyboardShortcut_Unsure');
      this.#setUnsureView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Unsure');
    });

    // Tag and severity sections only available with Expert Validate.
    if (svv.adminVersion) {
      this.#labelTypePicker = new LabelTypePicker(menuUI.labelTypePicker, {
        onPick: (labelType) => this.#setNewLabelType(labelType),
        // The full set of chips plus the editors would overflow the menu column, so only one shows at a time.
        onToggle: (expanded) => {
          if (expanded) this.#showVerdict(menuUI.noButton, ['labelTypeMenu']);
          else this.#setWrongTypeView();
        },
      });

      // Add onclick for each severity button.
      for (const severityButton of menuUI.severityMenu.querySelectorAll('.severity-button')) {
        severityButton.addEventListener('click', () => {
          // Reachable mid-load by keyboard even though the menu is dimmed and pointer-blocked: each button is a label
          // around a radio that is only visually hidden, so it still takes focus, and an arrow key roves the group
          // natively. The viewers stopPropagation those keydowns but nothing preventDefaults them, so the roving still
          // fires a click here — writing a severity onto the label that isn't on screen yet, where resetMenu hides the
          // menu but leaves the value on the label, and it is submitted as a change nobody made (#5211).
          if (svv.labelContainer.dropInputWhileLoading('Severity')) return;
          const currLabel = svv.labelContainer.getCurrentLabel();
          const oldSeverity = currLabel.getProperty('newSeverity');
          const newSeverity = Number(severityButton.dataset.severity);
          const labelType = currLabel.getProperty('newLabelType');
          if (oldSeverity !== newSeverity && util.misc.labelTypeHasSeverity(labelType)) {
            svv.tracker.push(`Click=Severity_Old=${oldSeverity}_New=${newSeverity}`);
            currLabel.setProperty('newSeverity', newSeverity);
            this.#renderSeverity();
            svv.labelCard?.render(currLabel);
          }
        });
      }

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
      reasonButton.addEventListener('click', (e) => {
        if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
        svv.tracker.push(`${e.isTrusted ? 'Click=' : 'KeyboardShortcut_'}DisagreeReason_Option=${reasonButton.id}`);
        this.#setDisagreeReason(reasonButton.id);
      });
    }
    for (const reasonButton of this.#unsureReasonButtons) {
      reasonButton.addEventListener('click', (e) => {
        if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
        svv.tracker.push(`${e.isTrusted ? 'Click=' : 'KeyboardShortcut_'}UnsureReason_Option=${reasonButton.id}`);
        this.#setUnsureReason(reasonButton.id);
      });
    }

    // Log clicks to the three text boxes. Focus is set by hand because a shortcut's scripted click doesn't move it.
    menuUI.optionalCommentTextBox.addEventListener('click', (e) => {
      menuUI.optionalCommentTextBox.focus();
      svv.tracker.push(e.isTrusted ? 'Click=AgreeCommentTextbox' : 'KeyboardShortcut=AgreeCommentTextbox');
    });
    menuUI.disagreeReasonTextBox.addEventListener('click', (e) => {
      menuUI.disagreeReasonTextBox.focus();
      svv.tracker.push(e.isTrusted ? 'Click=DisagreeReasonTextbox' : 'KeyboardShortcut=DisagreeReasonTextbox');
    });
    menuUI.unsureReasonTextBox.addEventListener('click', (e) => {
      menuUI.unsureReasonTextBox.focus();
      svv.tracker.push(e.isTrusted ? 'Click=UnsureReasonTextbox' : 'KeyboardShortcut=UnsureReasonTextbox');
    });

    // Add oninput for disagree and unsure other reason text boxes.
    // Guarded at the handler, not left to the setter each one calls: the empty branch writes the cleared reason onto
    // the current label directly, so without this the two branches would answer a mid-load event differently. They
    // are believed unreachable then — KeyboardManager goes inert while a reason box has focus, so a load cannot start
    // from there, and once one has the box is only reachable by pointer, which is blocked — but half a guard on a
    // handler is a trap for whoever changes it next (#5211).
    menuUI.disagreeReasonTextBox.addEventListener('input', () => {
      if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
      if (menuUI.disagreeReasonTextBox.value === '') {
        menuUI.disagreeReasonTextBox.classList.remove('chosen');
        svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
      } else {
        this.#setDisagreeReason('other');
      }
    });
    menuUI.unsureReasonTextBox.addEventListener('input', () => {
      if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
      if (menuUI.unsureReasonTextBox.value === '') {
        menuUI.unsureReasonTextBox.classList.remove('chosen');
        svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
      } else {
        this.#setUnsureReason('other');
      }
    });

    // Add onclick for submit button. A disabled button never fires this, by pointer or by script.
    menuUI.submitButton.addEventListener('click', (e) => {
      this.#validateLabel(svv.labelContainer.getCurrentLabel().getProperty('validationResult'), !e.isTrusted);
    });
  }

  resetMenu(label) {
    const menuUI = this.#menuUI;
    this.#tagsAddedByUser = [];
    const prevValResult = label.getProperty('validationResult');

    // Rerender the reason buttons, so that they match the correct label type when we allow such an undo (#4034).
    this.#renderReasonButtons(label);

    if (prevValResult === undefined) {
      // This is a new label (not returning from an undo), so reset everything: no verdict chosen, no section showing.
      this.#showVerdict(null, []);
      menuUI.optionalCommentTextBox.value = '';
      DesktopValidationMenu.#clearChosen(this.#disagreeReasonButtons);
      DesktopValidationMenu.#clearChosen(this.#unsureReasonButtons);
      menuUI.disagreeReasonTextBox.classList.remove('chosen');
      menuUI.unsureReasonTextBox.classList.remove('chosen');
      menuUI.disagreeReasonTextBox.value = '';
      menuUI.unsureReasonTextBox.value = '';
      menuUI.submitButton.disabled = true;
    } else {
      // This is a validation that they are going back to, so update all the views to match what they had before.
      menuUI.optionalCommentTextBox.value = label.getProperty('agreeComment');

      const disagreeOption = label.getProperty('disagreeOption');
      DesktopValidationMenu.#clearChosen(this.#disagreeReasonButtons);
      if (disagreeOption === 'other') {
        menuUI.disagreeReasonTextBox.classList.add('chosen');
        menuUI.disagreeReasonTextBox.value = label.getProperty('disagreeReasonTextBox');
      } else {
        menuUI.disagreeReasonTextBox.classList.remove('chosen');
        menuUI.disagreeReasonTextBox.value = '';
        this.#reasonButton(disagreeOption)?.classList.add('chosen');
      }

      const unsureOption = label.getProperty('unsureOption');
      DesktopValidationMenu.#clearChosen(this.#unsureReasonButtons);
      if (unsureOption === 'other') {
        menuUI.unsureReasonTextBox.classList.add('chosen');
        menuUI.unsureReasonTextBox.value = label.getProperty('unsureReasonTextBox');
      } else {
        menuUI.unsureReasonTextBox.classList.remove('chosen');
        menuUI.unsureReasonTextBox.value = '';
        this.#reasonButton(unsureOption)?.classList.add('chosen');
      }

      // An Agree carrying a new type is a "wrong label type" disagree.
      if (prevValResult === 'Agree' && this.#typeChanged(label)) this.#setWrongTypeView();
      else if (prevValResult === 'Agree') this.#setYesView();
      else if (prevValResult === 'Disagree') this.#setNoView();
      else if (prevValResult === 'Unsure') this.#setUnsureView();
    }
  }

  /**
   * @param {HTMLElement} options - A reason menu's options holder.
   * @returns {HTMLElement[]} Its reason buttons, in menu order.
   */
  static #reasonButtonsIn(options) {
    return [...options.querySelectorAll(':scope > .validation-reason-button')];
  }

  /**
   * @param {HTMLElement[]} buttons
   */
  static #clearChosen(buttons) {
    for (const button of buttons) button.classList.remove('chosen');
  }

  /**
   * @param {string|undefined} id - A reason button's id, or the undefined a label without a reason carries.
   * @returns {HTMLElement|null}
   */
  #reasonButton(id) {
    return [...this.#disagreeReasonButtons, ...this.#unsureReasonButtons].find((b) => b.id === id) ?? null;
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
    for (const reasonButton of [...this.#disagreeReasonButtons, ...this.#unsureReasonButtons]) {
      const buttonInfo = svv.reasonButtonInfo[labelType][reasonButton.id];
      if (buttonInfo) {
        reasonButton.innerHTML = buttonInfo.buttonText;

        reasonButton.removeAttribute('data-ps-tooltip');
        if (buttonInfo.tooltipImage) {
          util.getImage(buttonInfo.tooltipImage).then((img) => {
            this.#addTooltip(reasonButton, buttonInfo.tooltipText, img);
          });
        } else {
          this.#addTooltip(reasonButton, buttonInfo.tooltipText);
        }

        reasonButton.classList.add('defaultOption');
        reasonButton.style.display = 'flex';
      } else {
        reasonButton.style.display = 'none';
        reasonButton.classList.remove('defaultOption');
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
   * @param {HTMLElement|null} chosenButton - The verdict button to mark chosen, or null for none.
   * @param {string[]} sections - Names of the `menuUI` sections to show; the rest are hidden.
   */
  #showVerdict(chosenButton, sections) {
    const menuUI = this.#menuUI;
    this.#wrongTypeView = sections.includes('labelTypeMenu');
    for (const button of [menuUI.yesButton, menuUI.noButton, menuUI.unsureButton]) {
      button.classList.toggle('chosen', button === chosenButton);
    }
    const all = ['labelTypeMenu', 'tagsMenu', 'severityMenu', 'optionalCommentSection', 'noMenu', 'unsureMenu'];
    for (const name of all) {
      // The type picker's section is only in Expert Validate's markup.
      if (menuUI[name]) menuUI[name].style.display = sections.includes(name) ? 'block' : 'none';
    }
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
    this.#menuUI.submitButton.disabled = false;
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
    this.#menuUI.submitButton.disabled = false;
  }

  #setUnsureView() {
    this.#dropPendingEdits();
    this.#showVerdict(this.#menuUI.unsureButton, ['unsureMenu']);
    this.#menuUI.submitButton.disabled = false;
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
    this.#menuUI.submitButton.disabled = picked === null;
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
    DesktopValidationMenu.#clearChosen(this.#disagreeReasonButtons);
    this.#menuUI.disagreeReasonTextBox.classList.remove('chosen');
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

  #renderTags() {
    const menuUI = this.#menuUI;
    const label = svv.labelContainer.getCurrentLabel();
    let allTagOptions = structuredClone(svv.tagsByLabelType[label.getProperty('newLabelType')] ?? []);
    const allTagOptionsPermanent = structuredClone(allTagOptions);

    menuUI.currentTags.replaceChildren();
    const currTags = label.getProperty('newTags');
    const tagTemplate = document.querySelector('.current-tag.template');
    for (const tag of currTags) {
      const tagOption = allTagOptions.find((t) => t.tag_name === tag);
      if (!tagOption) {
        continue; // Skip tags that are now being excluded on this server. Don't want to show them.
      }

      // Clone the template tag element, remove the 'template' class, update the text, and add the removal onclick.
      const tagDiv = /** @type {HTMLElement} */ (tagTemplate.cloneNode(true));
      tagDiv.classList.remove('template');
      const translatedTagName = i18next.t(`common:tag.${tag.replace(/:/g, '-')}`);
      tagDiv.querySelector('.tag-name').textContent = translatedTagName;

      const removeButton = tagDiv.querySelector('.remove-tag-x');
      const removeLabel = i18next.t('validate:validate-menu.remove-tag', { tag: translatedTagName });
      removeButton.setAttribute('aria-label', removeLabel);
      removeButton.addEventListener('click', () => {
        tagDiv.removeAttribute('data-ps-tooltip'); // Or the tooltip outlives the pill it belonged to (#4071).
        this.#removeTag(tag, label, false);
      });

      const tooltipText = `"${translatedTagName}" example`;
      this.#addTooltip(tagDiv, tooltipText, util.assetPath(`images/examples/tags/${tagOption.tag_id}.png`));

      // Add to current list of tags, and remove from options for new tags to add.
      menuUI.currentTags.append(tagDiv);
      allTagOptions = allTagOptions.filter((t) => t.tag_name !== tag);
    }

    // Show/hide elem for list of tags to hide extra spacing b/w elements when there are no tags to show.
    menuUI.currentTags.style.display = currTags.length === 0 ? 'none' : 'flex';

    // Clear the possible tags to add and add all appropriate options.
    this.#tagSelect.clearOptions();
    this.#tagSelect.addOption(allTagOptions);

    // AI SUGGESTION TAGS SECTION.
    menuUI.aiSuggestionSection.querySelectorAll('.sidewalk-ai-suggested-tag:not(.template)')
      .forEach((el) => el.remove());

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
      menuUI.aiSuggestionSection.style.display = '';

      // Log the AI suggestions.
      svv.tracker.push(`ShowingAiSuggestions`, {
        add:    `"${aiAddTagOptions.map((t) => t.tag_name).join()}"`,
        remove: `"${aiRemoveTagOptions.map((t) => t.tag_name).join()}"`,
      });

      const aiTagOptions = [
        ...aiAddTagOptions.map((t) => ({ ...t, action: 'add' })),
        ...aiRemoveTagOptions.map((t) => ({ ...t, action: 'remove' })),
      ];
      for (const tag of aiTagOptions) {
        // Clone the template tag element, and set all appropriate classes.
        const suggestion = /** @type {HTMLElement} */ (menuUI.aiSuggestedTagTemplate.cloneNode(true));
        suggestion.classList.remove('template');
        suggestion.classList.add(tag.action === 'add' ? 'to-add' : 'to-remove');

        const translatedTagName = i18next.t(`common:tag.${tag.tag_name.replace(/:/g, '-')}`);
        const addRemoveTranslationKey = `expert-validate.${tag.action === 'add' ? 'add-tag' : 'remove-tag'}`;
        suggestion.textContent = i18next.t(addRemoveTranslationKey, { tag: translatedTagName });
        menuUI.aiSuggestedTagTemplate.parentElement.append(suggestion);

        // Show tooltip with example image for the tag.
        const tooltipText = `"${translatedTagName}" example`;
        this.#addTooltip(suggestion, tooltipText, util.assetPath(`images/examples/tags/${tag.tag_id}.png`));

        // Add onclick to the tag to add or remove it if the user clicks to accept the AI suggestion.
        suggestion.addEventListener('click', () => {
          suggestion.removeAttribute('data-ps-tooltip'); // Fix for the tooltip showing up on later labels, #4071.
          if (tag.action === 'add') {
            this.#addTag(tag.tag_name, true);
          } else {
            this.#removeTag(tag.tag_name, label, true);
          }
        });
      }
    } else {
      menuUI.aiSuggestionSection.style.display = 'none';
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
    for (const severityButton of menuUI.severityMenu.querySelectorAll('.severity-button')) {
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
    DesktopValidationMenu.#clearChosen(this.#disagreeReasonButtons);
    if (id === 'other') {
      menuUI.disagreeReasonTextBox.classList.add('chosen');
      svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', 'other');
    } else {
      menuUI.disagreeReasonTextBox.classList.remove('chosen');
      menuUI.disagreeReasonTextBox.value = '';
      svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', id);
      this.#reasonButton(id)?.classList.add('chosen');
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
    DesktopValidationMenu.#clearChosen(this.#unsureReasonButtons);
    if (id === 'other') {
      menuUI.unsureReasonTextBox.classList.add('chosen');
      svv.labelContainer.getCurrentLabel().setProperty('unsureOption', 'other');
    } else {
      menuUI.unsureReasonTextBox.classList.remove('chosen');
      menuUI.unsureReasonTextBox.value = '';
      svv.labelContainer.getCurrentLabel().setProperty('unsureOption', id);
      this.#reasonButton(id)?.classList.add('chosen');
    }
  }

  saveValidationState() {
    const menuUI = this.#menuUI;
    const currLabel = svv.labelContainer.getCurrentLabel();
    currLabel.setProperty('agreeComment', menuUI.optionalCommentTextBox.value);
    currLabel.setProperty('disagreeReasonTextBox', menuUI.disagreeReasonTextBox.value);
    currLabel.setProperty('unsureReasonTextBox', menuUI.unsureReasonTextBox.value);
  }

  /**
   * Validates a single label from a button click.
   * @param {string} action - Validation action - must be one of Agree, Disagree, or Unsure.
   * @param {boolean} keyboardShortcut - Whether or not the validation was triggered by a keyboard shortcut.
   */
  #validateLabel(action, keyboardShortcut) {
    // Everything below writes to whatever getCurrentLabel() returns, which mid-load is already the next label (#5211).
    if (svv.labelContainer.dropInputWhileLoading(`Submit=${action}`)) return;

    const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
    const timestamp = new Date();
    const currLabel = svv.labelContainer.getCurrentLabel();
    const typeNote = this.#typeChanged(currLabel) ? `_NewLabelType=${currLabel.getProperty('newLabelType')}` : '';
    svv.tracker.push(actionStr + action + typeNote);

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
        comment = this.#reasonButton(disagreeReason).innerHTML.replace('<br>', ' ');
      }
    } else if (action === 'Unsure') {
      const unsureReason = currLabel.getProperty('unsureOption');
      if (unsureReason === 'other') {
        comment = currLabel.getProperty('unsureReasonTextBox');
      } else if (unsureReason) {
        comment = this.#reasonButton(unsureReason).innerHTML.replace('<br>', ' ');
      }
    }
    currLabel.setProperty('comment', comment);

    // If enough time has passed between validations, log the new validation.
    if (timestamp.getTime() - svv.labelContainer.getProperty('validationTimestamp') > 800) {
      svv.labelContainer.validateCurrentLabel(action, timestamp, comment);
    }
  }
}
