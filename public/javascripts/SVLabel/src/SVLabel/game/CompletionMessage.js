function CompletionMessage (gameEffectModel, uiCompletionMessage) {
    this._model = gameEffectModel;
    this._uiCompletionMessage = {
        message: uiCompletionMessage.taskCompletionMessage
    };

    var self = this;

    this._model.on("play", function (parameter) {
        // Play the animation and audio effect after task completion.
        self._uiCompletionMessage.message.css('visibility', 'visible').hide();
        self._uiCompletionMessage.message.removeClass('animated bounce bounceOut').fadeIn(300).addClass('animated bounce');
        setTimeout(function () {
            self._uiCompletionMessage.message.fadeOut(300).addClass('bounceOut');
        }, 1000);
    });
}
