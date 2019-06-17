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

    // The mappings for panoramas to map buttons is as follows:
    // {panoCanvas: [agreeButton, disagreeButton, notSureButton] }
    //
    // Each element (panoCanvas, agreeButton ...) is the ID for each element and uses 1-based indexing.
    // (i.e., svv-panorama-1, validation-agree-button-1 ...)
    let canvasArray = { };
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
        let list = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(labelList, list);
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