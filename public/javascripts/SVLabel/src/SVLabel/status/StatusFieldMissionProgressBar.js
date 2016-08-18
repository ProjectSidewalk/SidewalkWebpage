function StatusFieldMissionProgressBar (uiStatusField) {
    var $completionRate = uiStatusField.holder.find("#status-current-mission-completion-rate");
    var $progressBar = uiStatusField.holder.find("#status-current-mission-completion-bar");
    var $progressBarFiller = uiStatusField.holder.find("#status-current-mission-completion-bar-filler");

    this.setCompletionRate = function (completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% complete";
        $completionRate.html(completionRate);
    }
}