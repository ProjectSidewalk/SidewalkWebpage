function StatusFieldMissionProgressBar (modalModel, uiStatusField) {
    var self = this;
    var $completionRate = uiStatusField.holder.find("#status-current-mission-completion-rate");
    var $progressBar = uiStatusField.holder.find("#status-current-mission-completion-bar");
    var $progressBarFiller = uiStatusField.holder.find("#status-current-mission-completion-bar-filler");

    modalModel.on("ModalMissionComplete:close", function (parameters) {
        self.setBar(parameters.misisonCompletionRate);
    });

    this.setCompletionRate = function (completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% complete";
        $completionRate.html(completionRate);
    };

    this.setBar = function (completionRate) {
        var color = completionRate < 1 ? 'rgba(0, 161, 203, 1)' : 'rgba(0, 222, 38, 1)';
        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;

        completionRate = completionRate.toFixed(0);
        completionRate = completionRate + "%";
        $progressBarFiller.css({
            background: color,
            width: completionRate
        });
    };

    this.setBar(0);
    this.setCompletionRate(0);
}