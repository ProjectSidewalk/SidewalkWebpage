/**
 * User module
 * @param param
 * @param userModel
 * @returns {{className: string}}
 * @constructor
 */
function User (param, userModel) {
    var properties = {
        username: null,
        role: null
    };

    this._userModel = userModel;

    properties.username = param.username;
    properties.role = param.role;

    /**
     * Get a property
     * @param key
     * @returns {*}
     */
    this.getProperty = function (key) {
        return properties[key]; 
    };

    /**
     * Set a property
     * @param key
     * @param value
     */
    this.setProperty = function (key, value) {
        properties[key] = value;
    };
}
