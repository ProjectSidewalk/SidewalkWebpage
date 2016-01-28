var svl = svl || {};

/**
 *
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function ProgressPov ($, param) {
    var self = {className: 'ProgressPov'};
    var status = {
        currentCompletionRate: 0,
        previousHeading: 0,
        surveyedAngles: undefined
    };

    var $divCurrentCompletionRate;
    var $divCurrentCompletionBar;
    var $divCurrentCompletionBarFiller;


    function _init(param) {
        $divCurrentCompletionRate = svl.ui.progressPov.rate;
        $divCurrentCompletionBar = svl.ui.progressPov.bar;
        $divCurrentCompletionBarFiller = svl.ui.progressPov.filler;

        // Fill in the surveyed angles
        status.surveyedAngles = new Array(100);
        for (var i=0; i < 100; i++) {
            status.surveyedAngles[i] = 0;
        }

        if (param && param.pov) {
            status.previousHeading = param.pov.heading;
        } else {
            try {
                var pov = svl.getPov();
                status.previousHeading = pov.heading;
            } catch (e) {
                status.previousHeading = 0;
            }
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
        completionRate = completionRate + "%";
        $divCurrentCompletionRate.html(completionRate);
        return this;
    }

    /**
     * This method updates the filler of the completion bar
     */
    function updateCompletionBar () {
        var r, g, color, completionRate = getCompletionRate();
        var colorIntensity = 255;
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
        return ('task' in svl) ? svl.task.getTaskCompletionRate() : 0;

        //try {
        //    if (status.currentCompletionRate < 1) {
        //        var headingRange = 25;
        //        var pov = svl.getPOV();
        //        var heading = pov.heading;
        //        var headingMin = (heading - headingRange + 360) % 360;
        //        var headingMax = (heading + headingRange) % 360;
        //        var indexMin = Math.floor(headingMin / 360 * 100);
        //        var indexMax = Math.floor(headingMax / 360 * 100);
        //        var i = 0;
        //        if (indexMin < indexMax) {
        //            for (i = indexMin; i < indexMax; i++) {
        //                status.surveyedAngles[i] = 1;
        //            }
        //        } else {
        //            for (i = indexMin; i < 100; i++) {
        //                status.surveyedAngles[i] = 1;
        //            }
        //            for (i = 0; i < indexMax; i++) {
        //                status.surveyedAngles[i] = 1;
        //            }
        //        }
        //
        //        var total = status.surveyedAngles.reduce(function(a, b) {return a + b});
        //        status.currentCompletionRate = total / 100;
        //
        //        status.previousHeading = heading;
        //        return total / 100;
        //    } else {
        //        return 1;
        //    }
        //} catch (e) {
        //    return 0;
        //}
    }


    function setCompletedHeading (range) {
        var headingMin = range[0];
        var headingMax = range[1];

        var indexMin = Math.floor(headingMin / 360 * 100);
        var indexMax = Math.floor(headingMax / 360 * 100);

        for (var i = indexMin; i < indexMax; i++) {
            status.surveyedAngles[i] = 1;
        }

        return this;
    }

    self.getCompletionRate = getCompletionRate;
    self.setCompletedHeading = setCompletedHeading;
    self.updateCompletionRate = updateCompletionRate;

    _init(param);
    return self;
}
