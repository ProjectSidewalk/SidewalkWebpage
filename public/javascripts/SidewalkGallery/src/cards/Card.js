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

    let imageDim = {
        w:0,
        h:0
    }

    // Icon for label
    const labelIcon = new Image();

    // The static pano image
    const panoImage = new Image();

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        let iconUrl = sg.util.properties.panorama.getIconImagePaths(getLabelType());
        labelIcon.src = iconUrl.iconImagePath;
        labelIcon.className = "label-icon";
        let iconCoords = getIconCoords();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";

        let imageId = "label_id_" + properties.label_id;
        panoImage.id = imageId;
        panoImage.className = "static-gallery-image";

        // TODO: Can we modularize this in some separate HTML
        //  file so we don't have to use template string?
        //             <img id="${imageId}" class="static-gallery-image">
        const cardHtml = `
            <p class="label-severity"><b>Severity:</b> ${properties.severity}</p>
            <p class="label-tags"><b>Tags:</b> ${properties.tags.length ? properties.tags.join(", ") : "none"}</p>
        `;

        card = document.createElement('div');
        card.className = "gallery-card";
        card.innerHTML = cardHtml;

        card.prepend(panoImage);
        card.appendChild(labelIcon);

        validationMenu = new ValidationMenu(card, properties);
    }

    function getIconCoords () {
        return {
            x: imageDim.w * properties.canvas_x / properties.canvas_width,
            y: imageDim.h * properties.canvas_y / properties.canvas_height
        };
    }

    function updateWidth(w) {
        width = w;
        card.style.width = w + "px";

        imageDim.w = w - 10;
        imageDim.h = imageDim.w/(4/3);//1.333;        

        let iconCoords = getIconCoords();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";
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
     * Loads the pano image from url
     */
    function loadImage() {
        return new Promise(resolve => {
            if (!status.imageFetched) {
                let img = panoImage;
                img.onload = () => {
                    status.imageFetched = true;
                    resolve(true);
                    //cardContainer.append(card);
                };
    
                img.src = imageUrl;
            } else {
                resolve(true);
            }
        });
    }

    /**
     * This method renders the card
     * @param cardContainer
     * @returns {self}
     */
    function render (cardContainer) {
        // TODO: should there be a safety check here to make sure pano is loaded?
        panoImage.width = imageDim.w;
        panoImage.height = imageDim.h;
        cardContainer.append(card);

        // TODO: what is this for?
        setStatus("visibility", "visible");
        //card.visiblility = status.visibility;
    }

    /**
     * 
     * render with an overload that allows you to set the width and height of the
     * card
     */
    function renderSize(cardContainer, width) {
        updateWidth(width);
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
    self.loadImage = loadImage;
    self.render = render;
    self.renderSize = renderSize;
    self.setProperty = setProperty;
    self.setStatus = setStatus;

    _init(params);
    return this;
}