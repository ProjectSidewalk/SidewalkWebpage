/**
 * A Validation Menu appended to a small Gallery Card for validation purposes.
 */
class ValidationMenu {
    static #classToValidationOption = {
        'validate-agree': 'Agree',
        'validate-disagree': 'Disagree',
        'validate-unsure': 'Unsure'
    };
    static #validationOptionToClass = {
        'Agree': 'validate-agree',
        'Disagree': 'validate-disagree',
        'Unsure': 'validate-unsure'
    };

    #refCard;
    #gsvImage;
    #currSelected = null;
    #overlay;
    #validationButtons = undefined;
    #galleryCard;

    /**
     * @param {Card} referenceCard The Card this menu belongs to.
     * @param {jQuery} gsvImage The HTML element to append the validation menu to.
     */
    constructor(referenceCard, gsvImage) {
        this.#refCard = referenceCard;
        this.#gsvImage = gsvImage;

        const cardOverlayHTML = `
            <div id="gallery-validation-button-holder">
                <button id="gallery-card-agree-button" class="validation-button">${i18next.t('common:agree')}</button>
                <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('common:disagree')}</button>
                <button id="gallery-card-unsure-button" class="validation-button">${i18next.t('common:unsure')}</button>
            </div>`;
        this.#overlay = $(cardOverlayHTML);
        this.#galleryCard = gsvImage.parent();

        this.#init();
    }

    /**
     * Adds onClick functions for the validation buttons. Read-only for labels contributed by the current user.
     */
    #init() {
        const refCard = this.#refCard;
        this.#validationButtons = {
            'validate-agree': this.#overlay.find('#gallery-card-agree-button'),
            'validate-disagree': this.#overlay.find('#gallery-card-disagree-button'),
            'validate-unsure': this.#overlay.find('#gallery-card-unsure-button')
        };

        // If the signed-in user had already validated this label before loading the page, style the card.
        const userValidation = refCard ? refCard.getProperty('user_validation') : null;
        if (userValidation) {
            this.showValidationOnCard(userValidation);
        }

        const readonly = !!refCard.getProperty('from_current_user');
        if (readonly) {
            const tip = i18next.t('labelmap:own-label-disabled');
            this.#galleryCard.addClass('gallery-card--readonly');

            // Disable validation buttons + add tooltip; skip attaching click handlers.
            for (const button of Object.values(this.#validationButtons)) {
                button.prop('disabled', true).attr('title', tip);
            }

            // Add tooltip to thumb containers; skip attaching click handlers. Destroy the bootstrap tooltips on the
            // inner Agree/Disagree icons so the native readonly tooltip shows on hover instead.
            const valInfo = refCard.validationInfoDisplay;
            valInfo.agreeContainer.title = tip;
            valInfo.disagreeContainer.title = tip;
            $(valInfo.validationContainer).find('img[data-toggle="tooltip"]').tooltip('destroy');
        } else {
            // Add onClick functions for the validation buttons.
            for (const [valKey, button] of Object.entries(this.#validationButtons)) {
                button.click(this.validateOnClickOrKeyPress(valKey, false, false));
            }

            this.#addValidationInfoOnClicks(refCard.validationInfoDisplay);
        }
        this.#gsvImage.append(this.#overlay);
    }

    /**
     * Add onClick functions for the thumbs up/down buttons.
     * @param valInfoDisplay
     */
    #addValidationInfoOnClicks(valInfoDisplay) {
        valInfoDisplay.agreeContainer.onclick = this.validateOnClickOrKeyPress('validate-agree', true, false);
        valInfoDisplay.disagreeContainer.onclick = this.validateOnClickOrKeyPress('validate-disagree', true, false);

        // Hover preview: swap the thumb icon to its filled variant to hint that it's clickable.
        const addHoverSwap = (container, valKey) => {
            const img = container.querySelector('.validation-info-image');
            if (!img) return;
            container.addEventListener('mouseenter', () => {
                if (this.#currSelected === valKey) return;
                img.src = img.src.replace('-outline', '-filled');
            });
            container.addEventListener('mouseleave', () => {
                img.src = img.src.replace('-filled', '-outline');
            });
        };
        addHoverSwap(valInfoDisplay.agreeContainer, 'validate-agree');
        addHoverSwap(valInfoDisplay.disagreeContainer, 'validate-disagree');
    }

    /**
     * OnClick or keyboard shortcut function for validation buttons and thumbs up/down buttons.
     * @param newValKey
     * @param {boolean} thumbsClick Whether the validation came from clicking the thumb icons.
     * @param {boolean} keyboardShortcut Whether the validation came from a keyboard shortcut.
     * @returns {function(): Promise} A function returning a Promise that resolves after validation.
     */
    validateOnClickOrKeyPress(newValKey, thumbsClick, keyboardShortcut) {
        return async () => {
            if (this.#currSelected !== newValKey) {
                const validationOption = ValidationMenu.#classToValidationOption[newValKey];

                const labelValidatedPromise = this.#validateLabel(validationOption, thumbsClick, keyboardShortcut);

                // Change the look of the card to match the new validation.
                // NOTE: done after calling _validateLabel() because it uses info that changes below.
                this.#refCard.updateUserValidation(validationOption);

                return labelValidatedPromise;
            }
        };
    }

    /**
     * Adds the visual effects of validation to the small card (opaque button and fill color below image).
     * @param validationOption
     */
    showValidationOnCard(validationOption) {
        const validationClass = ValidationMenu.#validationOptionToClass[validationOption];

        // Remove the visual effects from the older validation.
        if (this.#currSelected && this.#currSelected !== validationClass) {
            this.#validationButtons[this.#currSelected].attr('class', 'validation-button');
            if (this.#galleryCard.hasClass(this.#currSelected)) {
                this.#galleryCard.removeClass(this.#currSelected);
            }
        }
        this.#currSelected = validationClass;

        // Add the visual effects from the new validation.
        this.#galleryCard.addClass(validationClass);
        this.#validationButtons[validationClass].attr('class', 'validation-button-selected');

        // Reset thumb icons to outline state so that they don't blend into the background after validation.
        const valInfo = this.#refCard.validationInfoDisplay;
        if (valInfo) {
            for (const c of [valInfo.agreeContainer, valInfo.disagreeContainer]) {
                const img = c.querySelector('.validation-info-image');
                if (img) img.src = img.src.replace('-filled', '-outline');
            }
        }
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * @param {string} action Validation result.
     * @param {boolean} thumbsClick Whether the validation came from clicking the thumb icons.
     * @param {boolean} keyboardShortcut Whether the validation came from a keyboard shortcut.
     * @return {Promise} A promise that resolves once the validation has been submitted.
     */
    async #validateLabel(action, thumbsClick, keyboardShortcut) {
        const refCard = this.#refCard;
        let actionStr;
        let sourceStr;
        if (thumbsClick) actionStr = 'Validate_ThumbsMenuClick', sourceStr = 'GalleryThumbs';
        else actionStr = 'Validate_MenuClick', sourceStr = 'GalleryImage';
        actionStr += action;
        if (keyboardShortcut) {
            actionStr = actionStr.replace('Click', 'KeyboardShortcut');
        }
        sg.tracker.push(actionStr, { panoId: refCard.getProperty('pano_id') }, { labelId: refCard.getProperty('label_id') });

        const validationTimestamp = new Date();
        const labelIcon = refCard.labelIcon;
        const data = {
            label_id: refCard.getProperty('label_id'),
            label_type: refCard.getProperty('label_type'),
            validation_result: action,
            old_severity: refCard.getProperty('severity'),
            new_severity: refCard.getProperty('severity'),
            old_tags: refCard.getProperty('tags'),
            new_tags: refCard.getProperty('tags'),
            canvas_height: Math.round(this.#gsvImage.height()),
            canvas_width: Math.round(this.#gsvImage.width()),
            heading: refCard.getProperty('heading'),
            pitch: refCard.getProperty('pitch'),
            zoom: refCard.getProperty('zoom'),
            canvas_x: Math.round(labelIcon.offsetLeft + labelIcon.getBoundingClientRect().width / 2),
            canvas_y: Math.round(labelIcon.offsetTop + labelIcon.getBoundingClientRect().height / 2),
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: sourceStr,
            undone: false,
            redone: refCard.getProperty('user_validation') !== null,
            viewer_type: refCard.getImageSource() === 'crop' ? 'StaticCrop' : 'StaticApi'
        };

        const isNewValidation = refCard.getProperty('user_validation') === null;
        return fetch('/labelmap/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then((res) => {
            if (res.ok && isNewValidation) BadgeAchievements.recordValidation();
            return res;
        });
    }
}
