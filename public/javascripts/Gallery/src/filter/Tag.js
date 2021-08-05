/**
 * A Tag module.
 * 
 * @param {*} params Properties of tag.
 * @returns {Tag}
 * @constructor
 */
function Tag (params) {
    let self = this;

    // UI element of Tag.
    let tagElement = null;

    // Properties of this Tag.
    let properties = {
        tag_id: undefined,
        label_type: undefined,
        tag: undefined
    };

    // Status of the tag.
    let status = {
        applied: false
    };

    /**
     * Initialize Tag.
     * 
     * @param {*} param Tag properties.
     */
    function _init (param) {
        Object.keys(param).forEach( attrName => properties[attrName] = param[attrName]);

        tagElement = document.createElement('button');
        tagElement.className = "gallery-tag gallery-tag-sidebar";
        tagElement.id = properties.tag;
        tagElement.innerText = i18next.t('tag.' + properties.tag);
        tagElement.disabled = true;

        tagElement.onclick = handleTagClickCallback;
    }

    /**
     * Handles what happens when Tag is clicked.
     */
    function handleTagClickCallback() {
        if (status.applied) {
            sg.tracker.push("TagUnapply", null, {
                Tag: properties.tag,
                Label_Type: properties.label_type
            });
            unapply();
        } else {
            sg.tracker.push("TagApply", null, {
                Tag: properties.tag,
                Label_Type: properties.label_type
            });
            apply();
        }

        sg.cardContainer.updateCardsByTagsAndSeverity();
    }

    /**
     * Applies Tag.
     */
    function apply() {
        setStatus("applied", true);
        tagElement.setAttribute("style", "background-color: #78c8aa");
    }

    /**
     * Unapplies Tag.
     */
    function unapply() {
        setStatus("applied", false);
        tagElement.setAttribute("style", "background-color: none");
    }

    /**
     * Returns Tag name.
     */
    function getTag() {
        return properties.tag;
    }

    /**
     * Returns the tagId of this Tag.
     */
    function getTagId() {
        return properties.tag_id;
    }

    /**
     * Returns label type of Tag.
     */
    function getLabelType() {
        return properties.label_type;
    }

    /**
     * Return the deep copy of the properties object, so the caller can only modify properties from setProperty().
     * 
     * JavaScript Deepcopy:
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties() { return $.extend(true, {}, properties); }

    /**
     * Gets property of Tag.
     * 
     * @param propName Property name.
     * @returns {*} Property value if property name is valid. Otherwise false.
     */
    function getProperty(propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of tag.
     */
    function getStatus() {
        return status;
    }

    /**
     * Sets a property of Tag.
     * 
     * @param key Property name.
     * @param value Property value.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set status attribute of tag.
     * 
     * @param {*} key Status name.
     * @param {*} value Status value.
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * Renders the Tag.
     * 
     * @param filterContainer UI element to render Tag in.
     * @returns {self}
     */
    function render(filterContainer) {
        filterContainer.append(tagElement);
    }

    self.apply = apply;
    self.unapply = unapply;
    self.getTag = getTag;
    self.getTagId = getTagId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.render = render;

    _init(params);
    return this;
}
