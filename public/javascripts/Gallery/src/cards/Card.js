/**
 * A Card module.
 * @param params properties of the associated label.
 * @param imageUrl google maps static image url for label.
 * @returns {Card}
 * @constructor
 */
function Card (params, imageUrl) {
    let self = this;

    // UI card element.
    let card = null;

    // Validation menu tied to label.
    let validationMenu = null;

    // The width-height ratio for the card

    let widthHeightRatio = (4/3);

    let imageId = null;

    // Properties of the label in the card.
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

    // Paths to label icon images.
    // TODO: This object should be moved to a util file since it is shared in validation and admin tools as well.
    let iconImagePaths = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Other.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png'
    };

    // Status to determine if static imagery has been loaded.
    let status = {
        imageFetched: false
    };

    // Default image width.
    let width = 360;

    let imageDim = {
        w:0,
        h:0
    }

    // Icon for label.
    const labelIcon = new Image();

    // The static pano image.
    const panoImage = new Image();

    const modal = $('.gallery-modal')

    /**
     * Initialize Card.
     * 
     * @param {*} param Label properties.
     */
    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        // Place label icon.
        labelIcon.src = iconImagePaths[getLabelType()];
        labelIcon.className = "label-icon";
        let iconCoords = getIconPercent();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";

        imageId = "label_id_" + properties.label_id;
        panoImage.id = imageId;
        panoImage.className = "static-gallery-image";

        // Clean up ternary operators with constants?
        let severityHeader = properties.severity ? properties.severity :
                                                   getLabelType() === "Occlusion" ? i18next.t('gallery:not-applicable') : i18next.t('gallery:none');
        let tagHeader = properties.tags.length > 0 ? properties.tags.map(t => i18next.t('tag.' + t)).join(", ") : 
                                                     getLabelType() === "Occlusion" ? i18next.t('gallery:not-applicable') : i18next.t('gallery:none');

        // const cardHtml = `
        //     <p class="label-severity"><b>${i18next.t('severity')}</b> ${severityHeader}</p>
        //     <p class="label-tags"><b>${i18next.t('tags')}</b> ${tagHeader}</p>
        // `;
        // const testText = `
        //     <p class="gallery-card-label-type">Hello</p>
        // `
        const cardHtml = `
                        <div class='gallery-card'>
                            <div class="card-header">
                                <img class="label-icon" src=${iconImagePaths[getLabelType()]}>
                                <div>${getLabelType()}</div>        
                            </div>
                            <div class="card-info">
                                <div class="card-severity">
                                    <div class="label-severity-header"><b>${i18next.t('severity')}</b></div>
                                    <div class="label-severity-content">${severityHeader}</div>
                                </div>
                            </div>
                            <div class="card-tags">
                                <div class="label-tags-header"><b>${i18next.t('tags')}</b></div>
                                <div class="label-tags-content">${tagHeader}</div>
                            </div>
                        </div>`
        card = document.createElement('div')
        card.className = "gallery-card";
        let imageHolder = document.createElement('div')
        card.appendChild(imageHolder)
        let cardHeader = document.createElement('div')
        cardHeader.className = 'card-header'
        cardHeader.innerHTML = `<img class="label-icon" src=${iconImagePaths[getLabelType()]}> <div>${getLabelType()}</div>`
        card.appendChild(cardHeader)

        let cardInfo = document.createElement('div')
        cardInfo.className = 'card-info'
        let cardSeverity = document.createElement('div')
        cardSeverity.className = 'card-severity'
        cardSeverity.innerHTML = `<div class="label-severity-header"><b>${i18next.t('severity')}</b></div> `;
        let severityHolder = new SeverityDisplay(cardSeverity, properties.severity)
        cardInfo.appendChild(cardSeverity)

        let cardTags = document.createElement('div')
        cardTags.className = 'card-tags'
        cardTags.innerHTML = `<div class="label-tags-header"><b>${i18next.t('tags')}</b></div>`
        cardTags.id = properties.label_id
        cardInfo.appendChild(cardTags)

        imageHolder.appendChild(cardInfo)


        // card.innerHTML = cardHtml;

        imageHolder.appendChild(labelIcon);
        imageHolder.appendChild(panoImage);
        validationMenu = new ValidationMenu(imageHolder, properties);

        


    }

    /**
     * Return object with label coords on static image.
     */
    function getIconPercent () {
        return {
            x: 100 * properties.canvas_x / (properties.canvas_width),
            y: 100 * properties.canvas_y / (properties.canvas_height)
        };
    }

    /**
     * Update image width.
     * 
     * @param {*} w New width.
     */
    function updateWidth(w) {
        width = w;
        // card.style.width = w + "px";

        imageDim.w = w - 10;
        imageDim.h = imageDim.w / widthHeightRatio;       

        let iconCoords = getIconPercent();
        labelIcon.style.left = iconCoords.x  + "%";
        labelIcon.style.top = iconCoords.y + "%";
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
     * Return the deep copy of the properties object,
     * so the caller can only modify properties from
     * setProperty().
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
                    //cardContainer.append(card);
                };
    
                img.src = imageUrl;
            } else {
                resolve(true);
            }
        });
    }

    /**
     * Renders the card. 
     * 
     * @param cardContainer UI element to render card in.
     * @returns {self}
     */
    function render (cardContainer) {
        // TODO: should there be a safety check here to make sure pano is loaded?
        panoImage.width = imageDim.w;
        panoImage.height = imageDim.h;
        cardContainer.append(card);
    }

    /**
     * Render with an overload that allows you to set the width and height of the card.
     */
    function renderSize(cardContainer, width) {
        updateWidth(width);
        render(cardContainer);
        renderTags();
    }

    function renderTags() {
        // console.log(properties.label_id)
        let selector = ".card-tags#" + properties.label_id
        // console.log($(selector).width())
        let tagContent = new TagDisplay(selector, properties.tags)
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
    self.renderSize = renderSize;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.getImageId = getImageId;

    _init(params);
    return this;
}
