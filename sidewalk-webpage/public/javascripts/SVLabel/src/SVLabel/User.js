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
        properties = {};

    properties.username = param.username;

    self.getProperty = function (key) {
        return properties[key];
    };

    return self;
}
