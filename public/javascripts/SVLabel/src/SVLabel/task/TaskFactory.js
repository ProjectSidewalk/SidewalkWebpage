/**
 * TaskFactory module.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskFactory (turf) {
    var self = { className: "TaskFactory" };

    /**
     * Create a new task instance
     * @param geojson
     * @param lat
     * @param lng
     * @returns {svl.Task}
     */
    function create(geojson, lat, lng) {
        return new Task(turf, geojson, lat, lng);
    }
    
    self.create = create;

    return self;
}