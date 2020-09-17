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
        self.showJumpTipMessage(i18next.t('popup.jump'));
    });

    _jumpModel.on("JumpAlert:tooFar", function () {
        self.showJumpTipMessage(i18next.t('popup.jump-auto'));
    });

}