function ModalModel () {
    var self = this;
}

_.extend(ModalModel.prototype, Backbone.Events);

ModalModel.prototype.triggerMissionCompleteClosed = function () {
    this.trigger("ModalMissionComplete:close");
};