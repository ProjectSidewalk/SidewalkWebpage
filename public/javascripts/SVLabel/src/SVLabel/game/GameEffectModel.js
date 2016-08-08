function GameEffectModel () {
    var self = this;
}
_.extend(GameEffectModel.prototype, Backbone.Events);

GameEffectModel.prototype.play = function (parameters) {
    this.trigger("play", parameters);
};