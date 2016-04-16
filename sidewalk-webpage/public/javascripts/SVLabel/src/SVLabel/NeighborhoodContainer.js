/**
 * NeighborhoodContainer module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function NeighborhoodContainer (parameters) {
    var self = { className: "NeighborhoodContainer" },
        neighborhoods = {},
        status = {
            currentNeighborhood: null
        };

    function _init (parameters) {
        parameters = parameters || {};
        if ("currentNeighborhood" in parameters) setStatus("currentNeighborhood", parameters.currentNeighborhood);
    }


    /** Add the given neighborhood to the container */
    function add(neighborhood) {
        var id = neighborhood.getProperty("regionId");
        neighborhoods[id] = neighborhood;
    }

    /** Get a neighborhood instance of the given id */
    function get (id) {
        return id in neighborhoods ? neighborhoods[id] : null;
    }

    function getCurrentNeighborhood () {
        return getStatus("currentNeighborhood");
    }

    /** Return a list of neighborhood ids */
    function getRegionIds () {
        return Object.keys(neighborhoods).map(function (x) { return parseInt(x, 10); });
    }

    function getStatus (key) {
        return status[key];
    }

    function setCurrentNeighborhood (neighborhood) {
        setStatus("currentNeighborhood", neighborhood);
    }

    function setStatus (key, value) {
        status[key] = value;
    }


    _init(parameters);

    self.add = add;
    self.get = get;
    self.getCurrentNeighborhood = getCurrentNeighborhood;
    self.getRegionIds = getRegionIds;
    self.getStatus = getStatus;
    self.setCurrentNeighborhood = setCurrentNeighborhood;
    self.setStatus = setStatus;

    return self;
}