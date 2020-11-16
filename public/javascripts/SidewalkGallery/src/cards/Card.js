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
    let validationMenu = null;

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

    let width = 360;
    let height = 240;

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        // let iconUrl = sg.util.properties.panorama.getIconImagePaths(getLabelType());
        // let labelIcon = new Image();
        // labelIcon.src = iconUrl.iconImagePath;
        // labelIcon.className = "label-icon";
        // let iconCoords = getIconCoords();
        // labelIcon.style.left = iconCoords.x + "px";
        // labelIcon.style.top = iconCoords.y + "px";
    
        // let imageId = "label_id_" + properties.label_id;

        // TODO: Can we modularize this in some separate HTML
        //  file so we don't have to use template string?
        // const cardHtml = `
        //     <img id="${imageId}" class="static-gallery-image" width="360" height="240">
        //     <p class="label-severity"><b>Severity:</b> ${properties.severity}</p>
        //     <p class="label-tags"><b>Tags:</b> ${properties.tags.length ? properties.tags.join(", ") : "None"}</p>
        // `;

        card = document.createElement('div');
        card.className = "gallery-card";
        // card.innerHTML = cardHtml;

        // card.appendChild(labelIcon);

        validationMenu = new ValidationMenu(card, properties);
    }

    function getIconCoords () {
        return {
            x: width * properties.canvas_x / properties.canvas_width,
            y: height * properties.canvas_y / properties.canvas_height
        };
    }

    function updateSize (w, h) {
        width = w;
        height = h;
    }

    // function getImageProcess(src) {
    //     return new Promise((resolve, reject) => {
    //         console.log("grabbing image");
    //         let img = document.getElementById("label_id_" + properties.label_id);
    //         img.onload = () => resolve;
    //         img.onerror = reject;
    //         img.src = src;
    //         status.imageFetched = true;
    //         console.log(status.imageFetched);
    //     });
    // }

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

        let iconUrl = sg.util.properties.panorama.getIconImagePaths(getLabelType());
        let labelIcon = new Image();
        labelIcon.src = iconUrl.iconImagePath;
        labelIcon.className = "label-icon";
        let iconCoords = getIconCoords();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";

        let imageId = "label_id_" + properties.label_id;

        // TODO: Can we modularize this in some separate HTML
        //  file so we don't have to use template string?
        const cardHtml = `
            <img id="${imageId}" class="static-gallery-image" width="${width}" height="${height}">
            <p class="label-severity"><b>Severity:</b> ${properties.severity}</p>
            <p class="label-tags"><b>Tags:</b> ${properties.tags.length ? properties.tags.join(", ") : "None"}</p>
        `;

        card.innerHTML = cardHtml;

        card.appendChild(labelIcon);
        validationMenu = new ValidationMenu(card, properties);


        cardContainer.append(card);

        if (!status.imageFetched) {
            let img = document.getElementById("label_id_" + properties.label_id);
            img.onload = () => {
                status.imageFetched = true;
                cardContainer.append(card);
            };

            img.src = imageUrl;
        } else {
            cardContainer.append(card);
        }

        setStatus("visibility", "visible");
        //card.visiblility = status.visibility;
    }

    /**
     * 
     * render with an overload that allows you to set the width and height of the
     * card
     */
    function renderSize(cardContainer, width, height) {
        updateSize(width, height);
        render(cardContainer);
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
    self.renderSize = renderSize;
    self.setProperty = setProperty;
    self.setStatus = setStatus;

    _init(params);
    return this;
}