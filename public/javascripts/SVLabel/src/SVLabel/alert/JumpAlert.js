/*
 * Defines triggers to display jump tip message after the jump operation happens
 */
function JumpAlert(alertHandler, jumpModel) {
    var self = this;
    var _jumpModel = jumpModel;

    this.showJumpTipMessage = function (message) {
        alertHandler.showAlert(message, 'jumpTipMessage' , true);
    };

    _jumpModel.on("JumpAlert:clickJumpMsg", function () {
        self.showJumpTipMessage('You have been moved to a new location');
    });

    _jumpModel.on("JumpAlert:tooFar", function () {
        self.showJumpTipMessage("We have automatically moved you to a new location.");
    });

}