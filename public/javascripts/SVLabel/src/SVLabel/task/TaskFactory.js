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
     * @param tutorialTask
     * @param lat
     * @param lng
     * @returns {svl.Task}
     */
    this.create = function (geojson, tutorialTask, lat, lng) {
        return new Task(geojson, tutorialTask, lat, lng);
    };
}