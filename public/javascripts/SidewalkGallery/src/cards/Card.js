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
        visibility: 'hidden',
        imageFetched: false
    };

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        let iconUrl = sg.util.properties.panorama.getIconImagePaths(getLabelType());
        let labelIcon = new Image();
        labelIcon.src = iconUrl.iconImagePath;
        labelIcon.className = "label-icon";
        let iconCoords = getIconCoords();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";

        // TODO: Can we modularize this in some separate HTML
        //  file so we don't have to use template string?
        const cardHtml = `
            <img id="${"label_id_" + properties.label_id}" class="static-gallery-image" width="360" height="240">
            <p class="label-severity"><b>Severity:</b> ${properties.severity}</p>
            <p class="label-tags"><b>Tags:</b> ${properties.tags.length ? properties.tags.join(", ") : "None"}</p>
        `;

        card = document.createElement('div');
        card.className = "gallery-card";
        card.innerHTML = cardHtml;

        card.appendChild(labelIcon);
    }

    function getIconCoords () {
        return {
            x: 360 * properties.canvas_x / properties.canvas_width,
            y: 240 * properties.canvas_y / properties.canvas_height
        };
    }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () {
        return properties.label_id;
    }

    /**
     * This function returns labelType property
     * @returns {*}
     */
    function getLabelType () {
        return properties.label_type;
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

        if (!status.imageFetched) {
            console.log("grabbing image");
            status.imageFetched = true;
            document.getElementById("label_id_" + properties.label_id).src = imageUrl;
        }
        
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