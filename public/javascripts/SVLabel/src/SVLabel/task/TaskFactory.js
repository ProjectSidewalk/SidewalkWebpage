/**
 * TaskFactory module.
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
    this.create = function (geojson, lat, lng, startPointReversed) {
        return new Task(geojson, lat, lng, startPointReversed);
    };
}