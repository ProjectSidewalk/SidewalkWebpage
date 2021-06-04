function Modal(uiModal) {
    
    let self = this;

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

    let panoHolder = null
    let tags = null
    let severity = null
    let temporary = null
    let description = null

    let pano = null

    let label = null

    let header = null

    let closeButton = null

    function _init() {
        panoHolder = $('.actual-pano')
        tags = $('.gallery-modal-info-tags')
        severity = $('.gallery-modal-info-severity')
        temporary = $('.gallery-modal-info-temporary')
        description = $('.gallery-modal-info-description')
        header = $('.gallery-modal-header')
        
        pano = new GalleryPanorama(panoHolder)

        closeButton = $('.gallery-modal-close')
        closeButton.click(closeModal)
    }

    function closeModal() {
        $('.grid-container').css("grid-template-columns", "1fr 3fr")
        uiModal.hide()
    }

    function loadPano() {
        pano.setPano(properties.gsv_panorama_id, properties.heading, properties.pitch, properties.zoom)
        pano.renderLabel(label)
        header.text(properties.label_type)
        description.empty()
        temporary.empty()
        // severity.text(properties.severity)
        let tagHeader = properties.tags.length > 0 ? properties.tags.map(t => i18next.t('tag.' + t)).join(", ") : 
        properties.label_type === "Occlusion" ? i18next.t('gallery:not-applicable') : i18next.t('gallery:none');
        let temporaryHeader = document.createElement('div')
        temporaryHeader.innerHTML = `<div><b>Temporary</b></div><div>${'' + properties.temporary}</div>`
        temporary.append(temporaryHeader)
        severity.empty()
        new SeverityDisplay(severity, properties.severity, true)
        // severity.text('' + properties.severity)
        tags.text(tagHeader)
        // description.text(properties.description)
        $('.grid-container').css("grid-template-columns", "1fr 2fr 3fr")
        new TagDisplay(tags, properties.tags, true)

        let descriptionText = properties.description === null ? "" : properties.description
        let descriptionObject = document.createElement('div')
        descriptionObject.innerHTML = `<div><b>Description</b></div><div>${descriptionText}</div>`
        description.append(descriptionObject)
    }

    function updateProperties(newProps) {
        for (let attrName in newProps) {
            properties[attrName] = newProps[attrName]
        }
        label = new GalleryPanoramaLabel(properties.label_id, properties.label_type, properties.canvas_x, properties.canvas_y, properties.canvas_width, properties.canvas_height, properties.heading, properties.pitch, properties.zoom)
    }

    _init()

    self.updateProperties = updateProperties;
    self.loadPano = loadPano;
    return self
}