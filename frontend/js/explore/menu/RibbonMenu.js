/**
 * The label-type ribbon above the pano: the buttons that switch LabelModes, lit for the armed type, dimmed while
 * they can't be used, and the frame around the pano that takes the armed type's color.
 */

import { util } from '../../common/utilities.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../alert/KeyboardShortcutAlert.js').KeyboardShortcutAlert} KeyboardShortcutAlert */
/** @typedef {import('./LabelModes.js').LabelModes} LabelModes */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class RibbonMenu {
  static #DEFAULT_BORDER_COLOR = 'transparent';

  #labelModes;
  #keyboardShortcutAlert;
  #tracker;
  #uiRibbonMenu;

  /**
   * @param {LabelModes} labelModes - What the buttons switch, and whose availability they show.
   * @param {KeyboardShortcutAlert} keyboardShortcutAlert - Told of button clicks, so it can suggest the key.
   * @param {Tracker} tracker - Logs the clicks.
   */
  constructor(labelModes, keyboardShortcutAlert, tracker) {
    this.#labelModes = labelModes;
    this.#keyboardShortcutAlert = keyboardShortcutAlert;
    this.#tracker = tracker;
    this.#uiRibbonMenu = {
      holder: document.getElementById('ribbon-menu-holder'),
      panoFrame: document.getElementById('pano-border-frame'),
      buttons: Array.from(document.querySelectorAll('.label-type-button-holder')),
      subcategoryHolder: document.getElementById('ribbon-menu-other-subcategory-holder'),
      subcategories: Array.from(document.querySelectorAll('.ribbon-menu-other-subcategory')),
    };
    this.#init();
    labelModes.onModeChanged((mode) => this.#showMode(mode));
    labelModes.onAvailabilityChanged(() => this.#showAvailability());
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
    this.#uiRibbonMenu.buttons.forEach((el) => setKeyTooltip(el, null));
    // Beside the Other types, which stack in a column: a card above one would cover the one above it.
    this.#uiRibbonMenu.subcategories.forEach((el) => setKeyTooltip(el, 'left'));
  }

  #init() {
    this.#initTooltipAttributes();
    this.#setLabelTypeButtonBorderColors(this.#labelModes.getMode());

    for (const button of this.#uiRibbonMenu.buttons) {
      button.addEventListener('click', (e) => this.#handleModeSwitchClick(e.currentTarget));
      button.addEventListener('mouseenter', (e) => this.#handleModeSwitchMouseEnter(e.currentTarget));
      button.addEventListener('mouseleave', () => this.#handleModeSwitchMouseLeave());
    }
    for (const subcategory of this.#uiRibbonMenu.subcategories) {
      subcategory.addEventListener('click', (e) => this.#handleSubcategoryClick(e));
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
   * Shows a switched mode: the lit button, the pano frame's color, and the click-through toast class.
   * @param {string} mode - 'Walk' or a label type.
   */
  #showMode(mode) {
    // Lets a toast over the pano go click-through while a label type is armed (svl-canvas.css, #5496).
    document.body.classList.toggle('explore-labeling', mode !== 'Walk');
    this.#setLabelTypeButtonBorderColors(mode);
    const borderColor = util.misc.getLabelColors()[mode].fillStyle;
    if (this.#uiRibbonMenu.panoFrame) this.#uiRibbonMenu.panoFrame.style.borderColor = borderColor;
  }

  /** Dims each button whose mode can't be switched to now. */
  #showAvailability() {
    const { buttons, subcategories } = this.#uiRibbonMenu;
    for (const el of [...buttons, ...subcategories]) {
      const enabled = this.#labelModes.isUsable(RibbonMenu.#modeOf(el));
      el.style.opacity = enabled ? '1' : '0.4';
      el.style.cursor = enabled ? 'pointer' : 'default';
    }
  }

  /**
   * The mode a button stands for: the ribbon's Other button is 'OuterOther', since the tutorial enables it apart from
   * the Other entry in its menu.
   * @param {Element} button
   * @returns {string}
   */
  static #modeOf(button) {
    const val = button.getAttribute('val');
    return val === 'Other' && button.classList.contains('label-type-button-holder') ? 'OuterOther' : val;
  }

  /**
   * @param {Event} e - The subcategory click event (currentTarget is the clicked subcategory).
   */
  #handleSubcategoryClick(e) {
    e.stopPropagation();
    const subcategory = /** @type {Element} */ (e.currentTarget).getAttribute('val');
    if (!this.#labelModes.isUsable(subcategory)) return;
    this.#tracker.push(`Click_Subcategory_${subcategory}`);
    this.#keyboardShortcutAlert.modeSwitchButtonClicked(subcategory);
    this.#labelModes.switchTo(subcategory);
    this.#hideSubcategories();
  }

  /**
   * @param {Element} target - The clicked label-type button.
   */
  #handleModeSwitchClick(target) {
    const labelType = target.getAttribute('val');
    if (!this.#labelModes.isUsable(labelType)) return;
    this.#tracker.push(`Click_ModeSwitch_${labelType}`);
    this.#keyboardShortcutAlert.modeSwitchButtonClicked(labelType);
    this.#labelModes.switchTo(labelType);
  }

  /**
   * @param {Element} target - The hovered label-type button.
   */
  #handleModeSwitchMouseEnter(target) {
    if (!this.#labelModes.isUsable(RibbonMenu.#modeOf(target))) return;
    const labelType = target.getAttribute('val');
    this.#setLabelTypeButtonBorderColors(labelType);
    if (labelType === 'Other') this.#showSubcategories();
  }

  #handleModeSwitchMouseLeave() {
    this.#setLabelTypeButtonBorderColors(this.#labelModes.getMode());
    this.#hideSubcategories();
  }

  #hideSubcategories() {
    this.#uiRibbonMenu.subcategoryHolder.style.visibility = 'hidden';
  }

  #showSubcategories() {
    this.#uiRibbonMenu.subcategoryHolder.style.visibility = 'visible';
  }

  /**
   * @param {string} selectedLabelType
   */
  #setLabelTypeButtonBorderColors(selectedLabelType) {
    const selectedBorderColor = util.misc.getLabelColors()[selectedLabelType].fillStyle;
    for (const button of this.#uiRibbonMenu.buttons) {
      const selected = button.getAttribute('val') === selectedLabelType;
      const color = selected ? selectedBorderColor : RibbonMenu.#DEFAULT_BORDER_COLOR;
      for (const icon of button.querySelectorAll('.label-type-icon')) {
        icon.style.borderColor = color;
        icon.style.backgroundColor = color;
      }
    }
  }

  /**
   * Draws the tutorial's attention halo on a label type's button, and on its entry in the Other menu if named.
   * @param {string} labelType
   * @param {string} [subLabelType]
   */
  startBlinking(labelType, subLabelType) {
    const button = this.#uiRibbonMenu.holder.querySelector(`[val="${labelType}"]`).children[0];
    const dropdown = subLabelType
      ? this.#uiRibbonMenu.subcategoryHolder.querySelector(`[val="${subLabelType}"]`)
      : null;

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
}
