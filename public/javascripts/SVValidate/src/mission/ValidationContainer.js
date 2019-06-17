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
        setProperty("agreeButtonList", _createAttrList("validation-agree-button"));
        setProperty("disgareeButtonList", _createAttrList("validation-disagree-button"));
        setProperty("labelList", labelList);
        setProperty("notSureButtonList", _createAttrList("validation-not-sure-button"));
        setProperty("panoCanvasList", _createAttrList("svv-panorama"));
        _createContainers();
    }

    /**
     * Adds a mapping of canvas
     * @param buttonList    String array containing the name of each button type.
     * @private
     */
    function _fillCanvasObject(canvasName, buttonList, screens) {
        let i;
        for (i = 1; i <= screens; i++) {
            let buttons = [];
            let j;
            for (j = 0; j < buttonList.length; j++) {
                buttons[j] = buttonList[j] + "-" + i;
            }


        }
    }

    /**
     * Creates a list of some attribute.
     * @param name
     * @returns {Array}
     * @private
     */
    function _createAttrList(name) {
        let list = [];
        let i;
        for (i = 1; i <= screens; i++) {
            list.push(name + "-" + i)
        }
        return list;
    }

    /**
     * Initializes the panoramaContainer, labelContainer and menuButtonContainers.
     * @private
     */
    function _createContainers() {
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(labelList, getProperty("panoCanvasList"));
        svv.menuButtonContainer = new MenuButtonContainer(getProperty("agreeButtonList"),
            getProperty("disagreeButtonList"), getProperty("notSureButtonList"));
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