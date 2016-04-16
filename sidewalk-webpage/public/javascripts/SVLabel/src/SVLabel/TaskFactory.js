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

    /**
     * Query the backend server and create a new task instance.
     * Todo. DEPRECATED. Use TaskContainer.nextTask(). And move nextTask() here...
     * @param parameters
     * @param callback
     */
    function getTask (parameters, callback) {
        if (!parameters || !callback) return;

        if ("streetEdgeId" in parameters && parameters.streetEdgeId) {
            $.ajax({
                url: "/task/street/" + parameters.streetEdgeId,
                type: 'get',
                success: function (json) {
                    var lat1 = json.features[0].geometry.coordinates[0][1],
                        lng1 = json.features[0].geometry.coordinates[0][0];
                    var newTask = create(json, lat1, lng1);
                    callback(newTask);
                },
                error: function (result) {
                    throw result;
                }
            });
        } else {
            $.ajax({
                url: "/task",
                type: 'get',
                success: function (json) {
                    var lat1 = json.features[0].geometry.coordinates[0][1],
                        lng1 = json.features[0].geometry.coordinates[0][0];
                    var newTask = create(json, lat1, lng1);
                    callback(newTask);
                },
                error: function (result) {
                    throw result;
                }
            });
        }
    }

    self.create = create;
    self.getTask = getTask;

    return self;
}