/**
 * RibbonMenu module. Owns the label-type ribbon UI and the label-type switching logic.
 *
 * Todo. Split the RibbonMenu UI component and the label type switching logic.
 * Todo. Consider moving this under menu instead of ribbon.
 */
class RibbonMenu {
  #tracker;
  #properties = {
    buttonDefaultBorderColor: 'transparent',
  };

  #status = {
    disableModeSwitch: false,
    lockDisableModeSwitch: false,
    disableMode: {
      Walk: false,
      CurbRamp: false,
      NoCurbRamp: false,
      Obstacle: false,
      SurfaceProblem: false,
      OuterOther: false,
      Occlusion: false,
      NoSidewalk: false,
      Crosswalk: false,
      Signal: false,
      Other: false,
    },
    lockDisableMode: false,
    mode: 'Walk',
    selectedLabelType: undefined,
  };

  #uiRibbonMenu;

  /**
   * @param {object} tracker - Interaction tracker for logging mode switches.
   */
  constructor(tracker) {
    this.#tracker = tracker;
    this.#uiRibbonMenu = {
      holder: document.getElementById('ribbon-menu-holder'),
      panoFrame: document.getElementById('pano-border-frame'),
      buttons: Array.from(document.querySelectorAll('.label-type-button-holder')),
      subcategoryHolder: document.getElementById('ribbon-menu-other-subcategory-holder'),
      subcategories: Array.from(document.querySelectorAll('.ribbon-menu-other-subcategory')),
    };
    this.#init();
  }

  /** Adds each label type's keyboard-shortcut tooltip to its menu button. */
  #initTooltipAttributes() {
    const setKeyTooltip = (el, placement) => {
      const val = el.getAttribute('val');
      if (val !== 'Walk' && val !== 'Other') {
        if (placement) el.setAttribute('data-ps-tooltip-placement', placement);
        // psTooltip renders the attribute as HTML, hence the escaping.
        el.setAttribute('data-ps-tooltip', i18next.t('top-ui.press-key', {
          key: util.misc.getLabelDescriptions(val).keyChar, interpolation: { escapeValue: true },
        }));
      }
    };
    // Above the button by default, except where that leaves the window, as it does with the ribbon at the very top of
    // it in immersive mode (#5085), where psTooltip flips it below.
    document.querySelectorAll('.label-type-button-holder').forEach((el) => setKeyTooltip(el, null));
    // Beside the Other types, which stack in a column: a card above one would cover the one above it.
    document.querySelectorAll('.ribbon-menu-other-subcategory').forEach((el) => setKeyTooltip(el, 'left'));
  }

  #init() {
    this.#initTooltipAttributes();

    this.#setLabelTypeButtonBorderColors(this.#status.mode);

    for (const button of this.#uiRibbonMenu.buttons) {
      button.addEventListener('click', (e) => this.#handleModeSwitchClickCallback(e.currentTarget));
      button.addEventListener('mouseenter', (e) => this.#handleModeSwitchMouseEnter(e.currentTarget));
      button.addEventListener('mouseleave', () => this.#handleModeSwitchMouseLeave());
    }
    for (const subcategory of this.#uiRibbonMenu.subcategories) {
      subcategory.addEventListener('click', (e) => this.#handleSubcategoryClick(e));
    }

    // Disable mode switch when sign in modal is opened.
    // TODO this doesn't seem to be necessary for some reason?
    const signInInputs = document.querySelectorAll(
      '#sign-in-modal-container input[type=\'text\'], #sign-in-modal-container input[type=\'password\']',
    );
    for (const input of signInInputs) {
      input.addEventListener('focus', () => this.disableModeSwitch());
      input.addEventListener('blur', () => this.enableModeSwitch());
    }

    // TODO For some reason the Other label type button doesn't show in Safari if we don't reset the display attr??
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3180
    const otherButton = document.getElementById('mode-switch-button-other');
    otherButton.style.display = 'block';
    setTimeout(() => {
      otherButton.style.display = 'inline-block';
    }, 500);
  }

  /**
   * Callback invoked on a ribbon menu button click.
   * @param {string} mode - Either a label type name or 'Walk'.
   */
  modeSwitch(mode) {
    this.#tracker.push(`ModeSwitch_${mode}`);

    if (this.#status.disableModeSwitch === false || this.#status.disableMode[mode] === false) {
      // Triggers onboarding states.
      document.dispatchEvent(new CustomEvent(`ModeSwitch_${mode}`));

      if (mode === 'Walk') {
        // Switch to walking mode.
        this.setStatus('mode', 'Walk');
        this.setStatus('selectedLabelType', undefined);
        if (svl.navigationService) {
          svl.navigationService.switchToExploreMode();
        }
      } else {
        // Switch to labeling mode.
        this.setStatus('mode', mode);
        this.setStatus('selectedLabelType', mode);
        if (svl.navigationService) svl.navigationService.switchToLabelingMode();

        // A lingering hover card would sit above the drawing layer and swallow the label-placement click.
        if (svl.canvas) svl.canvas.showLabelHoverInfo(undefined);

        // Change the cursor before the mouse moves. Doesn't bubble, so the tracker never logs it.
        if (svl.ui.canvas.drawingLayer) svl.ui.canvas.drawingLayer.dispatchEvent(new MouseEvent('mousemove'));

        // Loads the audio for placing a label. Safari requires audio to be loaded before each play.
        // Since this takes time, it's done early (when user selects label type) so it's ready when the label is placed.
        if ('audioEffect' in svl) svl.audioEffect.load('drip');
      }

      // Lets a toast over the pano go click-through while a label type is armed (svl-canvas.css, #5496).
      document.body.classList.toggle('explore-labeling', mode !== 'Walk');

      this.#setLabelTypeButtonBorderColors(mode);

      // Recolor the panorama frame to match the selected label type (black while in Walk mode).
      const borderColor = util.misc.getLabelColors()[mode].fillStyle;
      if (this.#uiRibbonMenu.panoFrame) this.#uiRibbonMenu.panoFrame.style.borderColor = borderColor;
    }
  }

  /**
   * @param {Event} e - The subcategory click event (currentTarget is the clicked subcategory).
   */
  #handleSubcategoryClick(e) {
    e.stopPropagation();
    const subcategory = /** @type {Element} */ (e.currentTarget).getAttribute('val');
    if (this.#status.disableMode[subcategory] === false) {
      this.#tracker.push(`Click_Subcategory_${subcategory}`);
      svl.keyboardShortcutAlert.modeSwitchButtonClicked(subcategory);
      this.modeSwitch(subcategory);
      this.#hideSubcategories();
    }
  }

  /**
   * @param {Element} target - The clicked label-type button.
   */
  #handleModeSwitchClickCallback(target) {
    const labelType = target.getAttribute('val');
    if (this.#status.disableModeSwitch === false || this.#status.disableMode[labelType] === false) {
      // Track the user action.
      this.#tracker.push(`Click_ModeSwitch_${labelType}`);
      svl.keyboardShortcutAlert.modeSwitchButtonClicked(labelType);
      this.modeSwitch(labelType);
    }
  }

  /**
   * @param {Element} target - The hovered label-type button.
   */
  #handleModeSwitchMouseEnter(target) {
    const labelType = target.getAttribute('val');

    let modeDisabled;
    if (svl.isOnboarding() && labelType === 'Other') {
      modeDisabled = this.#status.disableMode.OuterOther;
    } else {
      modeDisabled = this.#status.disableMode[labelType];
    }

    if (this.#status.disableModeSwitch === false || !modeDisabled) {
      // Change the border color of menu buttons.
      this.#setLabelTypeButtonBorderColors(labelType);

      if (labelType === 'Other') {
        this.#showSubcategories();
      }
    }
  }

  #handleModeSwitchMouseLeave() {
    // Always activate during onboarding as everything is disabled.
    // So will only be useful for 'Other' dropdown.
    if (this.#status.disableModeSwitch === false || svl.isOnboarding()) {
      this.#setLabelTypeButtonBorderColors(this.#status.mode);
      this.#hideSubcategories();
    }
  }

  #hideSubcategories() {
    this.#uiRibbonMenu.subcategoryHolder.style.visibility = 'hidden';
  }

  /**
   * @param {string} selectedLabelType
   * @returns {RibbonMenu} this.
   */
  #setLabelTypeButtonBorderColors(selectedLabelType) {
    const selectedBorderColor = util.misc.getLabelColors()[selectedLabelType].fillStyle;
    for (const button of this.#uiRibbonMenu.buttons) {
      const selected = button.getAttribute('val') === selectedLabelType;
      const color = selected ? selectedBorderColor : this.#properties.buttonDefaultBorderColor;
      for (const icon of button.querySelectorAll('.label-type-icon')) {
        icon.style.borderColor = color;
        icon.style.backgroundColor = color;
      }
    }
    return this;
  }

  #showSubcategories() {
    this.#uiRibbonMenu.subcategoryHolder.style.visibility = 'visible';
  }

  /**
   * @param {HTMLElement[]} elements
   * @param {boolean} enabled
   */
  static #setButtonsEnabledLook(elements, enabled) {
    for (const el of elements) {
      el.style.opacity = enabled ? '1' : '0.4';
      el.style.cursor = enabled ? 'pointer' : 'default';
    }
  }

  /**
   * Changes the mode to "walk".
   * @returns {RibbonMenu} this.
   */
  backToWalk() {
    this.modeSwitch('Walk');
    return this;
  }

  /**
   * Disable switching modes.
   * @returns {RibbonMenu} this.
   */
  disableModeSwitch() {
    if (!this.#status.lockDisableModeSwitch) {
      this.#status.disableModeSwitch = true;
      this.#status.disableMode = {
        Walk: true,
        CurbRamp: true,
        NoCurbRamp: true,
        Obstacle: true,
        SurfaceProblem: true,
        OuterOther: true,
        Occlusion: true,
        NoSidewalk: true,
        Crosswalk: true,
        Signal: true,
        Other: true,
      };
      RibbonMenu.#setButtonsEnabledLook([...this.#uiRibbonMenu.buttons, ...this.#uiRibbonMenu.subcategories], false);
    }
    return this;
  }

  /**
   * Disables a specific label type.
   * @param {string} labelType
   * @param {string} [subLabelType]
   */
  disableMode(labelType, subLabelType) {
    if (!this.#status.lockDisableMode) {
      // So that outer category Other is disabled.
      if (labelType === 'Other') {
        this.#status.disableMode.OuterOther = true;
      } else {
        this.#status.disableMode[labelType] = true;
      }
      if (subLabelType) this.#status.disableMode[subLabelType] = true;
      RibbonMenu.#setButtonsEnabledLook(this.#findButtons(labelType, subLabelType), false);
    }
  }

  /**
   * Enables mode switch.
   * @returns {RibbonMenu} this.
   */
  enableModeSwitch() {
    if (!this.#status.lockDisableModeSwitch) {
      this.#status.disableModeSwitch = false;
      this.#status.disableMode = {
        Walk: false,
        CurbRamp: false,
        NoCurbRamp: false,
        Obstacle: false,
        SurfaceProblem: false,
        OuterOther: false,
        Occlusion: false,
        NoSidewalk: false,
        Crosswalk: false,
        Signal: false,
        Other: false,
      };
      RibbonMenu.#setButtonsEnabledLook([...this.#uiRibbonMenu.buttons, ...this.#uiRibbonMenu.subcategories], true);
    }
    return this;
  }

  /**
   * Enables a specific label type.
   * @param {string} labelType
   * @param {string} [subLabelType]
   */
  enableMode(labelType, subLabelType) {
    if (!this.#status.lockDisableMode) {
      // So that sub category Other is not enabled.
      if (labelType === 'Other') {
        this.#status.disableMode.OuterOther = false;
      } else {
        this.#status.disableMode[labelType] = false;
      }
      if (subLabelType) this.#status.disableMode[subLabelType] = false;
      RibbonMenu.#setButtonsEnabledLook(this.#findButtons(labelType, subLabelType), true);
    }
  }

  /**
   * The ribbon button for a label type and, if asked, its entry in the Other menu.
   * @param {string} labelType
   * @param {string} [subLabelType]
   * @returns {HTMLElement[]}
   */
  #findButtons(labelType, subLabelType) {
    const button = /** @type {HTMLElement} */ (this.#uiRibbonMenu.holder.querySelector(`[val="${labelType}"]`));
    if (!button) return [];
    const dropdown = /** @type {HTMLElement} */ (subLabelType
      && this.#uiRibbonMenu.subcategoryHolder.querySelector(`[val="${subLabelType}"]`));
    return dropdown ? [button, dropdown] : [button];
  }

  /** @returns {RibbonMenu} this. */
  lockDisableModeSwitch() {
    this.#status.lockDisableModeSwitch = true;
    return this;
  }

  /** @returns {RibbonMenu} this. */
  lockDisableMode() {
    this.#status.lockDisableMode = true;
    return this;
  }

  /**
   * @param {string} key
   * @param {string} [subkey]
   * @returns {*}
   */
  getStatus(key, subkey) {
    if (key in this.#status) {
      if (subkey) {
        return this.#status[key][subkey];
      } else {
        return this.#status[key];
      }
    } else {
      console.warn('RibbonMenu', `You cannot access a property "${key}".`);
      return undefined;
    }
  }

  /**
   * Sets the given value in the status object.
   *
   * @param {string} name
   * @param {*} value
   * @param {string} [subname]
   * @returns {RibbonMenu|boolean}
   */
  setStatus(name, value, subname) {
    if (name in this.#status) {
      if (name === 'disableModeSwitch') {
        if (typeof value === 'boolean') {
          if (value) {
            this.disableModeSwitch();
          } else {
            this.enableModeSwitch();
          }
          return this;
        } else {
          return false;
        }
      } else {
        if (subname) {
          this.#status[name][subname] = value;
        } else {
          this.#status[name] = value;
        }
        return this;
      }
    } else {
      console.error('RibbonMenu', `"${name}" is not a modifiable status.`);
      return false;
    }
  }

  /**
   * @param {string} labelType
   * @param {string} [subLabelType]
   */
  startBlinking(labelType, subLabelType) {
    const button = this.#uiRibbonMenu.holder.querySelector(`[val="${labelType}"]`).children[0];
    let dropdown;

    if (subLabelType) {
      dropdown = this.#uiRibbonMenu.subcategoryHolder.querySelector(`[val="${subLabelType}"]`);
    }

    this.stopBlinking();
    // The shared pulsing halo (also used on the context menu's enabled section) replaces a 500ms border-color
    // toggle that was easy to miss and ignored prefers-reduced-motion.
    if (button) button.classList.add('onboarding-attention');
    if (dropdown) dropdown.classList.add('onboarding-attention');
  }

  stopBlinking() {
    for (const button of this.#uiRibbonMenu.buttons) button.children[0]?.classList.remove('onboarding-attention');
    for (const subcategory of this.#uiRibbonMenu.subcategories) subcategory.classList.remove('onboarding-attention');
  }

  /** @returns {RibbonMenu} this. */
  unlockDisableModeSwitch() {
    this.#status.lockDisableModeSwitch = false;
    return this;
  }

  /** @returns {RibbonMenu} this. */
  unlockDisableMode() {
    this.#status.lockDisableMode = false;
    return this;
  }
}
