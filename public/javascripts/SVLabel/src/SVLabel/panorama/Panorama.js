function Panorama(data) {
    var self = { className: "Panorama" };
    var _data = data;
    var properties = { submitted: _data.submitted ? _data.submitted : false };

    function getData () {
        return _data;
    }

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    function setProperty (key, value) {
        properties[key] = value;
    }

    self.data = getData;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}