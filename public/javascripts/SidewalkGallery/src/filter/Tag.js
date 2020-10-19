/**
 * A Tag module.
 * @param params
 * @returns {Tag}
 * @constructor
 */
function Tag (params) {
    let self = this;

    let tagElement = null;

    // Id of the tag this Tag represents
    let properties = {
        tag_id: undefined,
        label_type: undefined,
        tag: undefined
    };

    // Status of the tag
    // TODO: Maybe call it selected?
    let status = {
        applied: false
    };

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        tagElement = document.createElement('div');
        tagElement.className = "gallery-tag";
        tagElement.id = properties.tag;
        tagElement.innerText = properties.tag;

        tagElement.onclick = handleTagClickCallback;
    }

    function handleTagClickCallback() {
        if (status.applied) {
            unapply();
        } else {
            apply();
        }

        sg.cardContainer.updateCardsByTag(self);
    }

    function apply() {
        setStatus("applied", true);
        console.log("clicked and toggled on");
        tagElement.setAttribute("style", "background-color: coral");
    }

    function unapply() {
        setStatus("applied", false);
        console.log("clicked and toggled off");
        tagElement.setAttribute("style", "background-color: none");
    }

    /**
     * This function returns the tagId
     * @returns {*}
     */
    function getTagId() {
        return properties.tag_id;
    }

    function getLabelType() {
        return properties.label_type;
    }

    /**
     * Return the deep copy of the properties object,
     * so the caller can only modify properties from
     * setProperties() (which I have not implemented.)
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties() { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     * @returns {boolean}
     */
    function getProperty(propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of tag
     */
    function getStatus() {
        return status;
    }

    /**
     * Sets a property
     * @param key
     * @param value
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set status of tag
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * This method renders the tag
     * @param filterContainer
     * @returns {self}
     */
    function render(filterContainer) {
        filterContainer.append(tagElement);
    }

    self.apply = apply;
    self.unapply = unapply;
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