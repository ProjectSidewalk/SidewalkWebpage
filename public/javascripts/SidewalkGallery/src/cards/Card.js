/**
 * A Card module.
 * @param params
 * @param imageUrl
 * @returns {Card}
 * @constructor
 */
function Card (params, imageUrl) {
    let self = this;

    let card = null;

    // Properties of the label in the card
    let properties = {
        label_id: undefined,
        label_type: undefined,
        gsv_panorama_id: undefined,
        heading: undefined,
        pitch: undefined,
        zoom: undefined,
        canvas_x: undefined,
        canvas_y: undefined,
        canvas_width: undefined,
        canvas_height: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        tags: []
    };

    let status = {
        visibility: 'hidden'
    };

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        const cardHtml = `
            <img src="${imageUrl}" width="360" height="240">
            <h2>
                ${properties.label_id}
            </h2>
            <p>${properties.label_type}</p>
        `;

        card = document.createElement('div');
        card.className = "gallery-card";
        card.innerHTML = cardHtml;
    }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () {
        return properties.labelId;
    }

    /**
     * This function returns labelType property
     * @returns {*}
     */
    function getLabelType () {
        return properties.labelType;
    }

    /**
     * Return the deep copy of the properties object,
     * so the caller can only modify properties from
     * setProperties() (which I have not implemented.)
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     * @returns {boolean}
     */
    function getProperty (propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of tag
     */
    function getStatus() {
        return status;
    }

    /**
     * This method renders the card
     * @param cardContainer
     * @returns {self}
     */
    function render (cardContainer) {
        cardContainer.append(card);
        setStatus("visibility", "visible");
        //card.visiblility = status.visibility;
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

    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.render = render;
    self.setProperty = setProperty;
    self.setStatus = setStatus;

    _init(params);
    return this;
}