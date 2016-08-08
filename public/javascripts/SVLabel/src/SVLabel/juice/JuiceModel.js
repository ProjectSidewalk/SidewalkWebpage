function JuiceModel () {

}
_.extend(JuiceModel, Backbone.Events);

JuiceModel.prototype.play = function () {
    this.trigger("play", {});
};