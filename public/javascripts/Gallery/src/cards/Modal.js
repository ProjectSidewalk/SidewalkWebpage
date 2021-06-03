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

    function _init() {
        panoHolder = $('.actual-pano')
        tags = $('.gallery-modal-info' > '#tags')
        severity = $('.gallery-modal-info-severity')
        temporary = $('.gallery-modal-info' > '#temporary')
        description = $('.gallery-modal-info' > '#description')
        header = $('.gallery-modal-header')
        
        pano = new GalleryPanorama(panoHolder)
    }

    function loadPano() {
        pano.setPano(properties.gsv_panorama_id, properties.heading, properties.pitch, properties.zoom)
        pano.renderLabel(label)
        header.text(properties.label_type)
        // severity.text(properties.severity)
        // temporary.text('' + properties.temporary)
        severity.text('' + properties.severity)
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