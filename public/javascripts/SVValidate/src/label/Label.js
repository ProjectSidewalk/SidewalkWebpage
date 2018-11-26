/**
 * Represents a validation label
 * @returns {Label}
 * @constructor
 */
function Label() {
    var properties = {
        canvasHeight: undefined,
        canvasWidth: undefined,
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        heading: undefined,
        labelId: undefined,
        labelType: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        zoom: undefined
    };

    var icons = {
        CurbRamp : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_CurbRamp.png',
        NoCurbRamp : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoCurbRamp.png',
        Obstacle : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Obstacle.png',
        SurfaceProblem : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_SurfaceProblem.png',
        Other : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        Occlusion : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        NoSidewalk : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoSidewalk.png'
    };

    var self = this;

    /**
     * Gets the file path associated with the labels' icon type.
     * @returns {*} String - Path of image in the directory.
     */
    function getIconUrl() {
        return icons[properties.labelType];
    }

    /**
     * Returns a specific property of a label.
     * @param key   Name of property.
     * @returns     Property associated with the key.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Returns the entire property object for this label.
     * @returns Object for properties.
     */
    function getProperties () {
        return properties;
    }

    /**
     * Sets the value of a single property.
     * @param key   Name of property
     * @param value Value to set property to.
     * @returns {setProperty}
     */
    function setProperty(key, value) {
        // console.log("[Label.js] Setting property " + key + " to value " + value);
        properties[key] = value;
        return this;
    }

    self.getIconUrl = getIconUrl;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.setProperty = setProperty;

    return this;
}