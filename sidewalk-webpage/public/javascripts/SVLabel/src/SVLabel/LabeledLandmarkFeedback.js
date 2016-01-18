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

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function _init (params) {
      //
      // Initialize the jQuery DOM elements
      if (svl.ui && svl.ui.ribbonMenu) {
        $labelCountCurbRamp = svl.ui.labeledLandmark.curbRamp;
        $labelCountNoCurbRamp = svl.ui.labeledLandmark.noCurbRamp;
        $submittedLabelMessage = svl.ui.labeledLandmark.submitted;

        $labelCountCurbRamp.html(0);
        $labelCountNoCurbRamp.html(0);
      }
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    self.setLabelCount = function (labelCount) {
        // This method takes labelCount object that holds label names with
        // corresponding label counts. This function sets the label counts
        // that appears in the feedback window.
        if (svl.ui && svl.ui.ribbonMenu) {
          $labelCountCurbRamp.html(labelCount['CurbRamp']);
          $labelCountNoCurbRamp.html(labelCount['NoCurbRamp']);
        }
        return this;
    };

    self.setSubmittedLabelMessage = function (param) {
        // This method takes a param and sets the submittedLabelCount
        if (!param) {
            return this;
        }
        if (svl.ui && svl.ui.ribbonMenu) {
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
    };

    _init(params);
    return self;
}
