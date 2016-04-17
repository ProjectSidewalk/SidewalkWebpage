/**
 * User module.
 * Todo. Need to move user related information here.
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


    function getProperty (key) { return properties[key]; }

    function setProperty (key, value) {
        properties[key] = value;
    }

    self.getProperty = getProperty;
    self.setProperty = setProperty;

    return self;
}
