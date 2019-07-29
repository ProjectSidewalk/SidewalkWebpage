/**
 * Container holding each validation screen on the validation interface.
 * @param screens       Number of screens (i.e., panoramas) to display
 * @param panoSize      Dimensions of the panorama
 * @param labelList     Initial list of labels to validate for this mission
 * @returns {ValidationContainer}
 * @constructor
 */
function ValidationContainer (screens, labelList) {
    svv.panoramaContainer = undefined;
    svv.labelContainer = undefined;
    svv.menuButtonContainer = undefined;

    let properties = {
        agreeButtonList: undefined,
        disagreeButtonList: undefined,
        labelList: undefined,
        notSureButtonList: undefined,
        numScreens: undefined,
        panoCanvasList: undefined
    };

    let self = this;

    function _init() {
        setProperty("labelList", labelList);
        _createContainers();
    }

    /**
     * Initializes the panoramaContainer, labelContainer and menuButtonContainers.
     * @private
     */
    function _createContainers() {
        let list = _createIdList();
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(labelList, list);
    }

    /**
     * Creates a list between 0 and screens (inclusive)
     * @returns {Array}
     * @private
     */
    function _createIdList() {
        let i;
        let list = [];
        for (i = 0; i < screens; i++) {
            list[i] = i;
        }
        return list;
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