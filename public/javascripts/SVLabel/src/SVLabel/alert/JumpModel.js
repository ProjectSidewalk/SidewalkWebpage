/**
 * Created by manaswi on 12/1/16.
 */
function JumpModel () {
    var self = this;
}
_.extend(JumpModel.prototype, Backbone.Events);

JumpModel.prototype.triggerTooFarFromJumpLocation = function () {
    this.trigger("JumpAlert:tooFar");
};

JumpModel.prototype.triggerUserClickJumpMessage = function () {
    this.trigger("JumpAlert:clickJumpMsg");
};
