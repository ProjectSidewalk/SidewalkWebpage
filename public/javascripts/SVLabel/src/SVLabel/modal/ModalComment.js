/**
 * ModalComment module.
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalComment ($) {
    var self = { className: 'ModalComment'},
        status = {
            disableClickOK: true
        },
        blinkInterval;

    function _init() {
        disableClickOK();
        svl.ui.modalComment.ok.on("click", handleClickOK);
        svl.ui.modalComment.cancel.on("click", handleClickCancel);
        //svl.ui.leftColumn.feedback.on("click", showCommentMenu);
        svl.ui.leftColumn.feedback.on("click", handleClickFeedback);
        svl.ui.modalComment.textarea.on("focus", handleTextareaFocus);
        svl.ui.modalComment.textarea.on("blur", handleTextareaBlur);
        svl.ui.modalComment.textarea.on("input", handleTextareaChange);
    }

    /**
     * Blink the feedback button on the left
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.leftColumn.feedback.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * A callback function for clicking the feedback button on the left
     * @param e
     */
    function handleClickFeedback (e) {
        svl.tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    function handleClickOK (e) {
        e.preventDefault();
        svl.tracker.push("ModalComment_ClickOK");
        submitComment();
        hideCommentMenu();
    }

    function handleClickCancel (e) {
        svl.tracker.push("ModalComment_ClickCancel");
        e.preventDefault();
        hideCommentMenu();
    }

    /**
     * Handles changes in the comment field
     */
    function handleTextareaChange () {
        var comment = svl.ui.modalComment.textarea.val();
        if (comment.length > 0) {
            enableClickOK();
        } else {
            disableClickOK();
        }
    }

    function handleTextareaBlur() {
        if ('ribbon' in svl) {
            svl.ribbon.enableModeSwitch();
        }
    }

    function handleTextareaFocus() {
        if ('ribbon' in svl) { svl.ribbon.disableModeSwitch(); }
    }

    function hideCommentMenu () {
        svl.ui.modalComment.holder.addClass('hidden');
    }

    function showCommentMenu () {
        svl.ui.modalComment.textarea.val("");
        svl.ui.modalComment.holder.removeClass('hidden');
        svl.ui.modalComment.ok.addClass("disabled");
        disableClickOK();
    }

    function disableClickOK() {
        svl.ui.modalComment.ok.attr("disabled", true);
        svl.ui.modalComment.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    function enableClickOK () {
        svl.ui.modalComment.ok.attr("disabled", false);
        svl.ui.modalComment.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the feedback button on the left column
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.leftColumn.feedback.removeClass("highlight-50");
    }

    /**
     * Submit the comment
     */
    function submitComment () {
        if ('task' in svl) {
            var task = svl.taskContainer.getCurrentTask(),
                streetEdgeId = task.getStreetEdgeId(),
                gsvPanoramaId = svl.panorama.getPano(),
                pov = svl.map.getPov(),
                comment = svl.ui.modalComment.textarea.val();

            var latlng = svl.map.getPosition(),
                data = {
                    street_edge_id: streetEdgeId,
                    gsv_panorama_id: gsvPanoramaId,
                    heading: pov ? pov.heading : null,
                    pitch: pov ? pov.pitch : null,
                    zoom: pov ? pov.zoom : null,
                    comment: comment,
                    lat: latlng ? latlng.lat : null,
                    lng: latlng ? latlng.lng : null
                };

            if ("form" in svl && svl.form) {
                svl.form.postJSON("/audit/comment", data)
            }
        }
    }

    _init();

    self.blink = blink;
    self.stopBlinking = stopBlinking;

    return self;
}