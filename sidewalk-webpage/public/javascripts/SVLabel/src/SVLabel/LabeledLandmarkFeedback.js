var svl = svl || {};

/**
 * A LabelLandmarkFeedback module
 * @param $ {object} jQuery object
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabeledLandmarkFeedback ($, params) {
    var self = { className : 'LabeledLandmarkFeedback' };
    var properties = {};
    var status = {};

    // jQuery eleemnts
    var $labelCountCurbRamp;
    var $labelCountNoCurbRamp;
    var $submittedLabelMessage;

    function _init (params) {
      if (svl.ui && svl.ui.ribbonMenu) {
        $labelCountCurbRamp = svl.ui.labeledLandmark.curbRamp;
        $labelCountNoCurbRamp = svl.ui.labeledLandmark.noCurbRamp;
        $submittedLabelMessage = svl.ui.labeledLandmark.submitted;

        $labelCountCurbRamp.html(0);
        $labelCountNoCurbRamp.html(0);
      }
    }

    /**
     * This method takes labelCount object that holds label names with corresponding label counts. This function sets
     * the label counts that appears in the feedback window.
     * @param labelCount
     * @returns {setLabelCount}
     */
    function setLabelCount (labelCount) {
        if (svl.ui && svl.ui.ribbonMenu) {
            $labelCountCurbRamp.html(labelCount['CurbRamp']);
            $labelCountNoCurbRamp.html(labelCount['NoCurbRamp']);
        }
        return this;
    }

    /**
     * This method takes a param and sets the submittedLabelCount
     * @param param
     * @returns {setSubmittedLabelMessage}
     */
    function setSubmittedLabelMessage (param) {
        if (!param) { return this; }
        else if (svl.ui && svl.ui.ribbonMenu) {
            if ('message' in param) {
                $submittedLabelMessage.html(message);
            } else if ('numCurbRampLabels' in param && 'numMissingCurbRampLabels' in param) {
                var message = "You've submitted <b>" +
                    param.numCurbRampLabels +
                    "</b> curb ramp labels and <br /><b>" +
                    param.numMissingCurbRampLabels +
                    "</b> missing curb ramp labels.";
                $submittedLabelMessage.html(message);
            }
        }
        return this;
    }

    self.setLabelCount = setLabelCount;
    self.setSubmittedLabelMessage = setSubmittedLabelMessage;

    _init(params);
    return self;
}
