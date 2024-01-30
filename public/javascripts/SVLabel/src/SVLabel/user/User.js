/**
 * User module
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function User (param) {
    var properties = {
        username: param.username,
        role: param.role,
        userId: param.userId
    };

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
