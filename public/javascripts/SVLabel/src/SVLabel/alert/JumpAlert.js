function JumpAlert(alertHandler) {
    var self = {};

    function showJumpTipMessage() {
        alertHandler.showAlert('You have been moved to a new location', 'jumpTipMessage' , true);
    }

    self.showJumpTipMessage = showJumpTipMessage;
    return self;
}