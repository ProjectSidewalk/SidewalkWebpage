/**
 * A Card module.
 * @param params properties of the associated label.
 * @param imageUrl google maps static image url for label.
 * @param modal Modal object; used to update the expanded view when modifying a card.
 * @returns {Card}
 * @constructor
 */
function Card (params, imageUrl, modal) {
    let self = this;

    // UI card element.
    let card = null;

    let validationMenu = null;
    let imageId = null;

    // Properties of the label in the card.
    let properties = {
        label_id: undefined,
        label_type: undefined,
        gsv_panorama_id: undefined,
        image_date: undefined,
        label_timestamp: undefined,
        heading: undefined,
        pitch: undefined,
        zoom: undefined,
        canvas_x: undefined,
        canvas_y: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        street_edge_id: undefined,
        region_id: undefined,
        correctness: undefined,
        user_validation: undefined,
        tags: []
    };

    // Paths to label icon images.
    // TODO: This object should be moved to a util file since it is shared in validation and admin tools as well.
    let iconImagePaths = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Occlusion.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    // Status to determine if static imagery has been loaded.
    let status = {
        imageFetched: false
    };

    // The label icon to be placed on the static pano image.
    const labelIcon = new Image();
    self.labelIcon = labelIcon;

    // The static pano image.
    const panoImage = new Image();

    /**
     * Initialize Card.
     * 
     * @param {*} param Label properties.
     */
    function _init (param) {
        for (const attrName in param) {
            if (param.hasOwnProperty(attrName)) {
                properties[attrName] = param[attrName];
            }
        }
        if (properties.correctness) properties.correctness = "correct";
        else if (properties.correctness === false) properties.correctness = "incorrect";
        else properties.correctness = "unvalidated";

        // Place label icon.
        labelIcon.src = iconImagePaths[getLabelType()];
        labelIcon.classList.add("label-icon", "label-icon-gallery");
        labelIcon.style.left = `calc(${100 * properties.canvas_x / (sg.auditCanvasWidth)}% - var(--iconWidth) / 2)`;
        labelIcon.style.top = `calc(${100 * properties.canvas_y / (sg.auditCanvasHeight)}% - var(--iconWidth) / 2)`;

        // Create an element for the image in the card.
        imageId = "label_id_" + properties.label_id;
        panoImage.id = imageId;
        panoImage.className = "static-gallery-image";

        // Create the container card.
        card = document.createElement('div');
        card.id = "gallery_card_" + properties.label_id;
        card.className = "gallery-card";
        let imageHolder = document.createElement('div');
        imageHolder.className = "image-holder";
        card.appendChild(imageHolder);

        // Create the div for the severity and tags information.
        let cardInfo = document.createElement('div');
        cardInfo.className = 'card-info';

        // Create the div to store the label type.
        let cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.innerHTML = `<div>${i18next.t(util.camelToKebab(getLabelType()))}</div>`;
        cardInfo.appendChild(cardHeader);

        // Create the div that will hold the severity and tags.
        let cardData = document.createElement('div');
        cardData.className = 'card-data';
        cardInfo.appendChild(cardData);

        // Create the div to store the severity of the label.
        let cardSeverity = document.createElement('div');
        cardSeverity.className = 'card-severity';
        new SeverityDisplay(cardSeverity, properties.severity, getLabelType());
        cardData.appendChild(cardSeverity);

        // Create the div to store the tags related to a card. Tags won't be populated until card is added to the DOM.
        let cardTags = document.createElement('div');
        cardTags.className = 'card-tags';
        cardTags.innerHTML = `<div class="label-tags-header"></div>`;
        cardTags.id = properties.label_id;
        cardData.appendChild(cardTags);

        // Append the overlays for label information on top of the image.
        imageHolder.appendChild(labelIcon);
        imageHolder.appendChild(panoImage);
        card.appendChild(cardInfo);
        validationMenu = new ValidationMenu(self, $(imageHolder), properties, modal, false);
    }

    /**
     * This function returns labelId property.
     * 
     * @returns {string}
     */
    function getLabelId () {
        return properties.label_id;
    }

    /**
     * This function returns labelType property.
     * 
     * @returns {string}
     */
    function getLabelType () {
        return properties.label_type;
    }

    /**
     * Return the deep copy of the properties object, so the caller can only modify properties from setProperty().
     * JavaScript Deepcopy:
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property.
     * 
     * @param propName Property name.
     * @returns {*} Property value if property name is valid. Otherwise false.
     */
    function getProperty (propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of card.
     */
    function getStatus() {
        return status;
    }

    /**
     * Loads the pano image from url.
     */
    function loadImage() {
        return new Promise(resolve => {
            if (!status.imageFetched) {
                let img = panoImage;
                img.onload = () => {
                    status.imageFetched = true;
                    resolve(true);
                };
                img.src = imageUrl;
            } else {
                resolve(true);
            }
        });
    }

    /**
     * Renders the card.
     * TODO: should there be a safety check here to make sure pano is loaded?
     * 
     * @param cardContainer UI element to render card in.
     * @returns {self}
     */
    function render(cardContainer) {
        // If the card had transparent background from the modal being open earlier, remove transparency on rerender.
        if (card.classList.contains('modal-background-card')) card.classList.remove('modal-background-card');
        cardContainer.append(card);
        renderTags();
    }

    /**
     * Renders the tags on the card when the card is loaded onto on the DOM.
     */
    function renderTags() {
        let selector = ".card-tags#" + properties.label_id;
        let tagContent = new TagDisplay(selector, properties.tags);
    }

    /**
     * Sets a property. 
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
     * Set aspect of status.
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
     * Returns the current ImageID being displayed in the image.
     * @returns the image ID of the card that is being displayed
     */
    function getImageId() {
        return imageId
    }

    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.loadImage = loadImage;
    self.render = render;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.getImageId = getImageId;

    _init(params);
    
    self.validationMenu = validationMenu;

    return this;
}
