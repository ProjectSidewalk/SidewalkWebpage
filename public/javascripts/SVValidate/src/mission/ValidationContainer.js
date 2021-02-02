/**
 * Container holding the validation panorama.
 * @param labelList     Initial list of labels to validate for this mission
 * @returns {ValidationContainer}
 * @constructor
 */
function ValidationContainer (labelList) {
    svv.panoramaContainer = undefined;
    svv.labelContainer = undefined;

    let properties = {
        agreeButtonList: undefined,
        disagreeButtonList: undefined,
        labelList: undefined,
        notSureButtonList: undefined
    };

    let self = this;

    function _init() {
        setProperty("labelList", labelList);
        _createContainers();
    }

    /**
     * Initializes the panoramaContainer and labelContainer.
     * @private
     */
    function _createContainers() {
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(labelList);
    }

    /**
     * Gets a specific validation property of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets the value of a single property in properties.
     * @param key   Name of property
     * @param value Value to set property to.
     */
    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    _init();

    self.getProperty = getProperty;
    self.setProperty = setProperty;

    return this;
}
