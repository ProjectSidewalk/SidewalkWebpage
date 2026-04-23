/**
 * Created by manaswi on 12/1/16.
 */
function JumpModel () {
    var self = this;
}
Object.assign(JumpModel.prototype, EventMixin);

JumpModel.prototype.triggerUserClickJumpMessage = function () {
    this.trigger("JumpAlert:clickJumpMsg");
};
