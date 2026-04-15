function StatusModel () { }

Object.assign(StatusModel.prototype, EventMixin);

StatusModel.prototype.setMissionCompletionRate = function (completionRate) {
    this.trigger("StatusFieldMissionProgressBar:setCompletionRate", completionRate);
};

StatusModel.prototype.setProgressBar = function (completionRate) {
    this.trigger("StatusFieldMissionProgressBar:setBar", completionRate);
};