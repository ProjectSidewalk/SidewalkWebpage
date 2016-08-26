function TaskModel() {
    this._taskContainer = null;
}

_.extend(TaskModel.prototype, Backbone.Events);

TaskModel.prototype.tasksAreAvailableInARegion = function (regionId) {
    if (!this._taskContainer) return false;

    var incompleteTasks = this._taskContainer.getIncompleteTasks(regionId);
    return incompleteTasks.length > 0;
};