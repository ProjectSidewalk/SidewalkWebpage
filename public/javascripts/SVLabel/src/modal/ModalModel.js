function ModalModel () {
    var self = this;
}

_.extend(ModalModel.prototype, Backbone.Events);

ModalModel.prototype.showModalMissionComplete = function () {
    this.trigger("ModalMissionComplete:show");
};

ModalModel.prototype.triggerMissionCompleteClosed = function (parameters) {
    this.trigger("ModalMissionComplete:closed", parameters);
};

ModalModel.prototype.updateModalMissionComplete = function (mission, neighborhood) {
    this.trigger("ModalMissionComplete:update", { mission: mission, neighborhood: neighborhood });
};