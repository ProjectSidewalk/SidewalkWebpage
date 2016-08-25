/**
 * TaskFactory module.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskFactory () {
    /**
     * Create a new task instance
     * @param geojson
     * @param lat
     * @param lng
     * @returns {svl.Task}
     */
    this.create = function (geojson, lat, lng) {
        return new Task(geojson, lat, lng);
    };
}