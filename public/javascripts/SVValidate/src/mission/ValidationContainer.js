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

    var properties = {
        agreeButtonList: undefined,
        disagreeButtonList: undefined,
        labelList: undefined,
        notSureButtonList: undefined,
        numScreens: undefined,
        panoCanvasList: undefined,
    };

    var self = this;

    function _init() {
        setProperty("agreeButtonList", _createAttrList("validation-agree-button"));
        setProperty("disgareeButtonList", _createAttrList("validation-disagree-button"));
        setProperty("labelList", labelList);
        setProperty("notSureButtonList", _createAttrList("validation-not-sure-button"));
        setProperty("panoCanvasList", _createAttrList("svv-panorama"));
        _createContainers();
    }

    function _createAttrList(name) {
        var list = [];
        var i;
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