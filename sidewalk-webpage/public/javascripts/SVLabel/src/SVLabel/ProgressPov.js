var svl = svl || {};

/**
 *
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function ProgressPov ($, param) {
    var oPublic = {className: 'ProgressPov'};
    var status = {
        currentCompletionRate: 0,
        previousHeading: 0,
        surveyedAngles: undefined
    };
    var properties = {};

    var $divCurrentCompletionRate;
    var $divCurrentCompletionBar;
    var $divCurrentCompletionBarFiller;

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function _init(param) {
        $divCurrentCompletionRate = svl.ui.progressPov.rate;
        $divCurrentCompletionBar = svl.ui.progressPov.bar;
        $divCurrentCompletionBarFiller = svl.ui.progressPov.filler;

        //
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

    function printCompletionRate () {
        // This method prints what percent of the intersection the user has observed.
        var completionRate = oPublic.getCompletionRate() * 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "%";
        $divCurrentCompletionRate.html(completionRate);
        return this;
    }

    function oneDimensionalMorphology (arr, radius) {
        if (!radius) {
            radius = 5;
        }

        var newArr = new Array(arr.length);
        var len = arr.length;
        var i;
        var r;
        var rIndex;

        for (i = 0; i < len; i++) {
            newArr[i] = 0;
        }

        //
        // Expand
        for (i = 0; i < len; i++) {
            if (arr[i] == 1) {
                newArr[i] = 1;
                for (r = 1; r < radius; r++) {
                    rIndex = (i + r + len) % len;
                    newArr[rIndex] = 1;
                    rIndex = (i - r + len) % len;
                    newArr[rIndex] = 1;
                }
            }
        }

        var arr = $.extend(true, [], newArr);

        //
        // Contract
        for (i = 0; i < len; i++) {
            if (arr[i] == 0) {
                newArr[i] = 0;
                for (r = 1; r < radius; r++) {
                    rIndex = (i + r + len) % len;
                    newArr[rIndex] = 0;
                    rIndex = (i - r + len) % len;
                    newArr[rIndex] = 0;
                }
            }
        }

        return newArr;
    }

    function updateCompletionBar () {
        // This method updates the filler of the completion bar
        var completionRate = oPublic.getCompletionRate();
        var r;
        var g;
        var color;

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

    function updateCompletionRate () {
        // This method updates the printed completion rate and the bar.
        printCompletionRate();
        updateCompletionBar();
    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    oPublic.getCompletionRate = function () {
        // This method returns what percent of the intersection the user has observed.
        try {
            if (status.currentCompletionRate < 1) {
                var headingRange = 25;
                var pov = svl.getPOV();
                var heading = pov.heading;
                var headingMin = (heading - headingRange + 360) % 360;
                var headingMax = (heading + headingRange) % 360;
                var indexMin = Math.floor(headingMin / 360 * 100);
                var indexMax = Math.floor(headingMax / 360 * 100);
                var i = 0;
                if (indexMin < indexMax) {
                    for (i = indexMin; i < indexMax; i++) {
                        status.surveyedAngles[i] = 1;
                    }
                } else {
                    for (i = indexMin; i < 100; i++) {
                        status.surveyedAngles[i] = 1;
                    }
                    for (i = 0; i < indexMax; i++) {
                        status.surveyedAngles[i] = 1;
                    }
                }

                //
                // Added Aug 28th.
                // Todo. The part above is redundunt. Fix it later.
                // Fill in gaps in surveyedAngles
//                var indexCenter = Math.floor(heading / 360 * 100);
//                var previousHeading = status.previousHeading;
//                if (heading !== previousHeading) {
//                    var previousIndex = Math.floor(previousHeading / 360 * 100);
//                    var delta = heading - previousHeading;
//                    // if ((delta > 0 && delta < 359) || delta < -359) {
//                    if ((delta > 0 && delta < 300) || delta < -300) {
//                        // Fill in the gap from left to right
//                        for (i = previousIndex;;i++) {
//                            if (i == status.surveyedAngles.length) {
//                                i = 0;
//                            }
//                            status.surveyedAngles[i] = 1;
//                            if (i == indexCenter) {
//                                break;
//                            }
//
//                        }
//                    } else {
//                        // Fill in the gap from right to left.
//                        for (i = previousIndex;;i--) {
//                            if (i == -1) {
//                                i = status.surveyedAngles.length - 1;
//                            }
//                            status.surveyedAngles[i] = 1;
//                            if (i == indexCenter) {
//                                break;
//                            }
//
//                        }
//                    }
//                }

                // status.surveyedAngles = oneDimensionalMorphology(status.surveyedAngles);

                var total = status.surveyedAngles.reduce(function(a, b) {return a + b});
                status.currentCompletionRate = total / 100;

                status.previousHeading = heading;
                return total / 100;
            } else {
                return 1;
            }
        } catch (e) {
            return 0;
        }
    };

    oPublic.setCompletedHeading = function (range) {
        // This method manipulates the surveyed angle
        var headingMin = range[0];
        var headingMax = range[1];

        var indexMin = Math.floor(headingMin / 360 * 100);
        var indexMax = Math.floor(headingMax / 360 * 100);

        var i;
        for (i = indexMin; i < indexMax; i++) {
            status.surveyedAngles[i] = 1;
        }

        return this;
    };

    oPublic.updateCompletionRate = function () {
          return updateCompletionRate();
    };

    _init(param);
    return oPublic;
}
