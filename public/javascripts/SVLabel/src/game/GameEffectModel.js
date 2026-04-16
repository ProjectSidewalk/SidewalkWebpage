/**
 *
 * @constructor
 */
function GameEffectModel () {
    var self = this;
}
Object.assign(GameEffectModel.prototype, EventMixin);

GameEffectModel.prototype.loadAudio = function (parameters) {
    this.trigger("loadAudio", parameters);
};

GameEffectModel.prototype.play = function (parameters) {
    this.trigger("play", parameters);
};

GameEffectModel.prototype.playAudio = function (parameters) {
    this.trigger("playAudio", parameters);
};