var svl = svl || {};

/**
 *
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function MissionProgress () {
    var self = {className: 'ProgressPov'};
    var status = {
        currentCompletionRate: 0,
        previousHeading: 0,
        surveyedAngles: undefined
    };

    var $divCurrentCompletionRate;
    var $divCurrentCompletionBar;
    var $divCurrentCompletionBarFiller;


    function _init() {
        $divCurrentCompletionRate = svl.ui.progressPov.rate;
        $divCurrentCompletionBar = svl.ui.progressPov.bar;
        $divCurrentCompletionBarFiller = svl.ui.progressPov.filler;

        // Fill in the surveyed angles
        status.surveyedAngles = new Array(100);
        for (var i=0; i < 100; i++) {
            status.surveyedAngles[i] = 0;
        }


        printCompletionRate();
    }

    /**
     * This method prints what percent of the intersection the user has observed.
     * @returns {printCompletionRate}
     */
    function printCompletionRate () {
        var completionRate = getCompletionRate() * 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% complete";
        $divCurrentCompletionRate.html(completionRate);
        return this;
    }

    /**
     * This method updates the filler of the completion bar
     */
    function updateCompletionBar () {
        var r, g, color, completionRate = getCompletionRate();
        var colorIntensity = 230;
        if (completionRate < 0.5) {
            r = colorIntensity;
            g = parseInt(colorIntensity * completionRate * 2);
        } else {
            r = parseInt(colorIntensity * (1 - completionRate) * 2);
            g = colorIntensity;
        }

        color = 'rgba(' + r + ',' + g + ',0,1)';
        completionRate *=  100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate -= 0.8;
        completionRate = completionRate + "%";
        $divCurrentCompletionBarFiller.css({
            background: color,
            width: completionRate
        });
    }

    /**
     * This method updates the printed completion rate and the bar.
     */
    function updateCompletionRate () {
        printCompletionRate();
        updateCompletionBar();
    }

    /**
     * This method returns what percent of the intersection the user has observed.
     * @returns {number}
     */
    function getCompletionRate () {
        var taskCompletionRate = ('task' in svl) ? svl.task.getTaskCompletionRate() : 0;
        if ('compass' in svl) {
            svl.compass.update();
            if (taskCompletionRate > 0.1) {
                svl.compass.hideMessage();
            } else {
                svl.compass.updateMessage();
            }
        }
        return taskCompletionRate;
    }


    function setCompletedHeading (range) {
        var headingMin = range[0], headingMax = range[1],
            indexMin = Math.floor(headingMin / 360 * 100), indexMax = Math.floor(headingMax / 360 * 100);
        for (var i = indexMin; i < indexMax; i++) { status.surveyedAngles[i] = 1; }
        return this;
    }

    self.getCompletionRate = getCompletionRate;
    self.setCompletedHeading = setCompletedHeading;
    self.updateCompletionRate = updateCompletionRate;

    _init();
    return self;
}
