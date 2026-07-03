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
        originalBorderColor: 'transparent',
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

    #blinkInterval;
    #uiRibbonMenu;

    /**
     * @param {Object} tracker - Interaction tracker for logging mode switches.
     */
    constructor(tracker) {
        this.#tracker = tracker;
        this.#uiRibbonMenu = {
            holder: $('#ribbon-menu-holder'),
            panoFrame: $('#pano-border-frame'),
            buttons: $('.label-type-button-holder'),
            subcategoryHolder: $('#ribbon-menu-other-subcategory-holder'),
            subcategories: $('.ribbon-menu-other-subcategory'),
        };
        this.#init();
    }

    /**
     * Adds the tooltip attributes (showing each label type's keyboard shortcut) to the menu buttons.
     *
     * The global Bootstrap tooltip initializer in Main reads these attributes when it runs, and it only picks up
     * elements that already have them — so this must run during construction, before that init call.
     */
    #initTooltipAttributes() {
        const setKeyTooltip = (el, placement) => {
            const val = el.getAttribute('val');
            if (val !== 'Walk' && val !== 'Other') {
                el.setAttribute('data-toggle', 'tooltip');
                el.setAttribute('data-placement', placement);
                el.setAttribute('title', i18next.t('top-ui.press-key', { key: util.misc.getLabelDescriptions(val).keyChar }));
            }
        };
        document.querySelectorAll('.label-type-button-holder').forEach((el) => setKeyTooltip(el, 'top'));
        document.querySelectorAll('.ribbon-menu-other-subcategory').forEach((el) => setKeyTooltip(el, 'left'));
    }

    #init() {
        this.#initTooltipAttributes();

        // Initialize the jQuery DOM elements.
        if (this.#uiRibbonMenu) {
            this.#setLabelTypeButtonBorderColors(this.#status.mode);

            this.#uiRibbonMenu.buttons.on('click', (e) => this.#handleModeSwitchClickCallback(e.currentTarget));
            this.#uiRibbonMenu.buttons.on('mouseenter', (e) => this.#handleModeSwitchMouseEnter(e.currentTarget));
            this.#uiRibbonMenu.buttons.on('mouseleave', () => this.#handleModeSwitchMouseLeave());
            this.#uiRibbonMenu.subcategories.on('click', (e) => this.#handleSubcategoryClick(e));
        }

        // Disable mode switch when sign in modal is opened.
        // TODO this doesn't seem to be necessary for some reason?
        if ($('#sign-in-modal-container').length !== 0) {
            const $signInModalTextBoxes = $('#sign-in-modal-container input[type=\'text\']');
            const $signInModalPassword = $('#sign-in-modal-container input[type=\'password\']');
            $signInModalTextBoxes.on('focus', () => this.disableModeSwitch());
            $signInModalTextBoxes.on('blur', () => this.enableModeSwitch());
            $signInModalPassword.on('focus', () => this.disableModeSwitch());
            $signInModalPassword.on('blur', () => this.enableModeSwitch());
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
            $(document).trigger(`ModeSwitch_${mode}`);

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

                // Change cursor before mouse is moved.
                if (svl.ui.canvas.drawingLayer) svl.ui.canvas.drawingLayer.triggerHandler('mousemove');

                // Loads the audio for when a label is placed. Safari requires audios to be loaded each time before being played.
                // Since this takes time, it is done early (when user selects label type) so that it is ready for when the label is placed.
                if ('audioEffect' in svl) svl.audioEffect.load('drip');
            }

            if (this.#uiRibbonMenu) {
                this.#setLabelTypeButtonBorderColors(mode);

                // Recolor the panorama frame to match the selected label type (black while in Walk mode).
                const borderColor = util.misc.getLabelColors()[mode].fillStyle;
                this.#uiRibbonMenu.panoFrame.css('border-color', borderColor);
            }
        }
    }

    /**
     * @param {Event} e - The subcategory click event (currentTarget is the clicked subcategory).
     */
    #handleSubcategoryClick(e) {
        e.stopPropagation();
        const subcategory = $(e.currentTarget).attr('val');
        if (this.#status.disableMode[subcategory] === false) {
            this.#tracker.push(`Click_Subcategory_${subcategory}`);
            svl.keyboardShortcutAlert.modeSwitchButtonClicked(subcategory);
            this.modeSwitch(subcategory);
            this.#hideSubcategories();
        }
    }

    /**
     * @param {EventTarget} target - The clicked label-type button.
     */
    #handleModeSwitchClickCallback(target) {
        const labelType = $(target).attr('val');
        if (this.#status.disableModeSwitch === false || this.#status.disableMode[labelType] === false) {
            // Track the user action.
            this.#tracker.push(`Click_ModeSwitch_${labelType}`);
            svl.keyboardShortcutAlert.modeSwitchButtonClicked(labelType);
            this.modeSwitch(labelType);
        }
    }

    /**
     * @param {EventTarget} target - The hovered label-type button.
     */
    #handleModeSwitchMouseEnter(target) {
        const labelType = $(target).attr('val');

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
        this.#uiRibbonMenu.subcategoryHolder.css('visibility', 'hidden');
    }

    /**
     * @param {string} selectedLabelType
     * @returns {RibbonMenu} this.
     */
    #setLabelTypeButtonBorderColors(selectedLabelType) {
        if (this.#uiRibbonMenu) { // TODO is this check necessary?
            const labelColors = util.misc.getLabelColors();
            const selectedBorderColor = labelColors[selectedLabelType].fillStyle;
            $.each(this.#uiRibbonMenu.buttons, (i, v) => {
                const currLabelType = $(v).attr('val');
                if (currLabelType === selectedLabelType) {
                    $(v).find('.label-type-icon').css({
                        'border-color': selectedBorderColor,
                        'background-color': selectedBorderColor,
                    });
                } else {
                    // Change border/background color if the label type is not the currently selected type.
                    $(v).find('.label-type-icon').css({ 'border-color': this.#properties.buttonDefaultBorderColor });
                    $(v).find('.label-type-icon').css({ 'background-color': this.#properties.buttonDefaultBorderColor });
                }
            });
        }
        return this;
    }

    #showSubcategories() {
        this.#uiRibbonMenu.subcategoryHolder.css('visibility', 'visible');
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
            if (this.#uiRibbonMenu) {
                this.#uiRibbonMenu.buttons.css('opacity', 0.4);
                this.#uiRibbonMenu.buttons.css('cursor', 'default');

                this.#uiRibbonMenu.subcategories.css('opacity', 0.4);
                this.#uiRibbonMenu.subcategories.css('cursor', 'default');
            }
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
            const button = this.#uiRibbonMenu.holder.find(`[val="${labelType}"]`).get(0);
            let dropdown;

            // So that outer category Other is disabled.
            if (labelType === 'Other') {
                this.#status.disableMode.OuterOther = true;
            } else {
                this.#status.disableMode[labelType] = true;
            }

            if (subLabelType) {
                this.#status.disableMode[subLabelType] = true;
                dropdown = this.#uiRibbonMenu.subcategoryHolder.find(`[val="${subLabelType}"]`).get(0);
            }

            if (button) {
                $(button).css('opacity', 0.4);
                $(button).css('cursor', 'default');
                if (dropdown) {
                    $(dropdown).css('opacity', 0.4);
                    $(dropdown).css('cursor', 'default');
                }
            }
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
            if (this.#uiRibbonMenu) {
                this.#uiRibbonMenu.buttons.css('opacity', 1);
                this.#uiRibbonMenu.buttons.css('cursor', 'pointer');

                this.#uiRibbonMenu.subcategories.css('opacity', 1);
                this.#uiRibbonMenu.subcategories.css('cursor', 'pointer');
            }
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
            const button = this.#uiRibbonMenu.holder.find(`[val="${labelType}"]`).get(0);
            let dropdown;

            // So that sub category Other is not enabled.
            if (labelType === 'Other') {
                this.#status.disableMode.OuterOther = false;
            } else {
                this.#status.disableMode[labelType] = false;
            }

            if (subLabelType) {
                this.#status.disableMode[subLabelType] = false;
                dropdown = this.#uiRibbonMenu.subcategoryHolder.find(`[val="${subLabelType}"]`).get(0);
            }

            if (button) {
                $(button).css('opacity', 1);
                $(button).css('cursor', 'pointer');

                if (dropdown) {
                    $(dropdown).css('opacity', 1);
                    $(dropdown).css('cursor', 'pointer');
                }
            }
        }
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
     * @param {string} key
     * @returns {*}
     */
    #getProperty(key) {
        return key in this.#properties ? this.#properties[key] : null;
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
        let highlighted = false;
        const button = this.#uiRibbonMenu.holder.find(`[val="${labelType}"]`).get(0).children[0];
        let dropdown;

        if (subLabelType) {
            dropdown = this.#uiRibbonMenu.subcategoryHolder.find(`[val="${subLabelType}"]`).get(0);
        }

        this.stopBlinking();
        if (button) {
            this.#blinkInterval = window.setInterval(() => {
                if (highlighted) {
                    highlighted = !highlighted;
                    $(button).css('border-color', 'rgba(255, 255, 0, 1)');
                    if (dropdown) {
                        $(dropdown).css('background', 'rgba(255, 255, 0, 1)');
                    }
                } else {
                    highlighted = !highlighted;
                    $(button).css('border-color', this.#getProperty('originalBorderColor'));
                    if (dropdown) {
                        $(dropdown).css('background', 'white');
                    }
                }
            }, 500);
        }
    }

    stopBlinking() {
        clearInterval(this.#blinkInterval);
        $.each(this.#uiRibbonMenu.buttons, (i, v) => {
            $(v.children[0]).css('border-color', this.#getProperty('originalBorderColor'));
        });
        this.#uiRibbonMenu.subcategories.css('background', 'white');
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
