function StatusFieldMissionProgressBar (modalModel, statusModel, uiStatusField) {
    var self = this;
    var $completionRate = uiStatusField.holder.find("#status-current-mission-completion-rate");
    var $progressBar = uiStatusField.holder.find("#status-current-mission-completion-bar");
    var $progressBarFiller = uiStatusField.holder.find("#status-current-mission-completion-bar-filler");

    modalModel.on("ModalMissionComplete:close", function (parameters) {
        self.setBar(parameters.misisonCompletionRate);
    });

    statusModel.on("StatusFieldMissionProgressBar:setBar", function (completionRate) {
        self.setBar(completionRate);
    });

    statusModel.on("StatusFieldMissionProgressBar:setCompletionRate", function (completionRate) {
        self.setCompletionRate(completionRate);
    });

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

    this.setCompletionRate = function (completionRate) {
        completionRate *= 100;
        // if check exists since the user could audit more than the
        // expected amount for the mission (e.g. the user audits 503 ft
        // even though the mission is to audit 500 ft)
        if (completionRate > 100) completionRate = 100;
        else if (completionRate < 100 && completionRate >= 99.5) completionRate = 99;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% " + i18next.t('complete');
        $completionRate.html(completionRate);
    };

    this.setBar(0);
    this.setCompletionRate(0);
}