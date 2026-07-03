/**
 * Label Type Menu module.
 * This is responsible for holding the buttons allowing users to filter labels by label type.
 */
class LabelTypeMenu {
    #uiLabelTypeMenu;
    #defaultType = 'Assorted';
    #status;

    /**
     * @param {object} uiLabelTypeMenu UI element corresponding to LabelTypeMenu.
     * @param {string} initialLabelType Initial gallery label type.
     */
    constructor(uiLabelTypeMenu, initialLabelType) {
        this.#uiLabelTypeMenu = uiLabelTypeMenu;
        this.#status = { currentLabelType: initialLabelType };

        if (uiLabelTypeMenu) {
            uiLabelTypeMenu.select.bind({
                change: this.#labelTypeSelectCallback,
            });
        }
    }

    /**
     * Handles what happens when a label type is selected.
     */
    #labelTypeSelectCallback = (e) => {
        const newLabelType = $(e.currentTarget).val();
        const oldLabelType = this.#status.currentLabelType;

        // Check if the label type changed. Prevents this code from running on initial page load.
        if (newLabelType !== oldLabelType) {
            this.setStatus('currentLabelType', newLabelType);
            sg.tracker.push(`Filter_LabelType=${newLabelType}`);
            sg.cardFilter.update();
        }
    };

    /**
     * Returns current selected label type.
     */
    getCurrentLabelType() {
        return this.#status.currentLabelType;
    }

    /**
     * Returns to the default selection (All Label Types).
     */
    setToDefault() {
        this.#uiLabelTypeMenu.select.val(this.#defaultType);
        this.setStatus('currentLabelType', this.#defaultType);
        sg.tracker.push(`Filter_LabelType=${this.#defaultType}`);
        sg.cardFilter.update();
    }

    /**
     * Return status of LabelTypeMenu.
     */
    getStatus() {
        return this.#status;
    }

    /**
     * Set status attribute.
     *
     * @param {string} key Status name.
     * @param {*} value Status value.
     */
    setStatus(key, value) {
        if (key in this.#status) {
            this.#status[key] = value;
        } else {
            throw `${this.constructor.name}: Illegal status name.`;
        }
    }
}
