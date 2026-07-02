/**
 * A Tag module.
 */
class Tag {
    // UI element of Tag.
    #tagElement = null;

    // Properties of this Tag.
    #properties = {
        tag_id: undefined,
        label_type: undefined,
        tag: undefined
    };

    // Status of the tag.
    #status;

    /**
     * @param {*} params Properties of tag.
     * @param {boolean} applied A boolean to see if the tag filter is active.
     */
    constructor(params, applied) {
        this.#status = { applied: applied };
        this.#init(params);
    }

    /**
     * Initialize Tag.
     *
     * @param {*} param Tag properties.
     */
    #init(param) {
        Object.keys(param).forEach(attrName => this.#properties[attrName] = param[attrName]);

        this.#tagElement = document.createElement('button');
        this.#tagElement.className = "gallery-tag gallery-filter-button gallery-filter";
        this.#tagElement.id = this.#properties.tag;
        this.#tagElement.innerText = i18next.t('tag.' + this.#properties.tag.replace(/:/g, '-'));
        this.#tagElement.disabled = true; // Will be enabled once images load.

        if (this.#status.applied) {
            this.apply();
        }

        this.#tagElement.onclick = this.#tagClickCallback;
    }

    /**
     * Handles what happens when Tag is clicked.
     */
    #tagClickCallback = () => {
        if (this.#status.applied) {
            sg.tracker.push("TagUnapply", null, {
                Tag: this.#properties.tag,
                Label_Type: this.#properties.label_type
            });
            this.unapply();
        } else {
            sg.tracker.push("TagApply", null, {
                Tag: this.#properties.tag,
                Label_Type: this.#properties.label_type
            });
            this.apply();
        }

        sg.cardFilter.update();
    };

    /**
     * Applies Tag.
     */
    apply() {
        this.setStatus("applied", true);
        this.#tagElement.classList.add("gallery-filter-button-selected");
    }

    /**
     * Unapplies Tag.
     */
    unapply() {
        this.setStatus("applied", false);
        this.#tagElement.classList.remove("gallery-filter-button-selected");
    }

    /**
     * Returns Tag name.
     */
    getTag() {
        return this.#properties.tag;
    }

    /**
     * Returns the tagId of this Tag.
     */
    getTagId() {
        return this.#properties.tag_id;
    }

    /**
     * Returns label type of Tag.
     */
    getLabelType() {
        return this.#properties.label_type;
    }

    /**
     * Return the deep copy of the properties object, so the caller can only modify properties from setProperty().
     *
     * JavaScript Deepcopy:
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    getProperties() { return $.extend(true, {}, this.#properties); }

    /**
     * Gets property of Tag.
     *
     * @param propName Property name.
     * @returns {*} Property value if property name is valid. Otherwise false.
     */
    getProperty(propName) { return (propName in this.#properties) ? this.#properties[propName] : false; }

    /**
     * Get status of tag.
     */
    getStatus() {
        return this.#status;
    }

    /**
     * Sets a property of Tag.
     *
     * @param key Property name.
     * @param value Property value.
     * @returns {Tag}
     */
    setProperty(key, value) {
        this.#properties[key] = value;
        return this;
    }

    /**
     * Set status attribute of tag.
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

    /**
     * Renders the Tag.
     *
     * @param filterContainer UI element to render Tag in.
     */
    render(filterContainer) {
        filterContainer.append(this.#tagElement);
    }
}
