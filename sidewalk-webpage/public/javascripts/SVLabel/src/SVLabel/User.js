var svl = svl || {};

/**
 * User class constructor
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function User (param) {
    var self = {className: 'User'},
        properties = {
            username: null,
            recordedAuditDistance: null  // miles.
        };

    properties.username = param.username;

    function _init() {

    }

    function getProperty (key) { return properties[key]; }

    function setProperty (key, value) {
        properties[key] = value;
    }

    self.getProperty = getProperty;
    self.setProperty = setProperty;

    return self;
}
