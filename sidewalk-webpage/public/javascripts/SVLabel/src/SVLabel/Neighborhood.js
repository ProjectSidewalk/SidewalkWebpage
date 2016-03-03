function Neighborhood (parameters) {
    var self = { className: "Neighborhood"},
        properties = {
            regionId: null
        };

    /** Initialize */
    function _init (parameters) {
        if ('regionId' in parameters) setProperty("regionId", parameters.regionId)
    }

    /** Get property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /** Set property */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    _init(parameters);

    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}

function NeighborhoodContainer (parameters) {
    var self = { className: "NeighborhoodContainer" },
        neighborhoods = {};

    function _init (parameters) {
    }

    /** Get a neighborhood instance of the given id */
    function get (id) {
        return id in neighborhoods ? neighborhoods[id] : null;
    }

    /** Return a list of neighborhood ids */
    function getRegionIds () {
        return Object.keys(neighborhoods).map(function (x) { return parseInt(x, 10); });
    }

    /** Add the given neighborhood to the container */
    function add(neighborhood) {
        var id = neighborhood.getProperty("regionId");
        neighborhoods[id] = neighborhood;
    }

    _init(parameters);

    self.get = get;
    self.getRegionIds = getRegionIds;
    self.add = add;

    return self;
}

function NeighborhoodFactory () {
    var self = { className: "NeighborhoodFactory" };

    /**
     * Create a neighborhood instance.
     * @param regionId
     * @returns {Neighborhood}
     */
    function create (regionId) {
        return new Neighborhood({regionId: regionId});
    }

    self.create = create;
    return self;
}
