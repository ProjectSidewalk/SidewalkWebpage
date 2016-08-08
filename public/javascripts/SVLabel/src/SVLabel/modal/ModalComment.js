/**
 * ModalComment module.
 * @param form
 * @param uiModalComment
 * @param modalModel
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalComment (form, uiLeftColumn, uiModalComment, modalModel) {
    var self = { className: 'ModalComment'},
        status = {
            disableClickOK: true
        },
        blinkInterval;

    var _form = form;
    var _modalModel = modalModel;
    var _uiModalComment = uiModalComment;
    var _uiLeftColumn = uiLeftColumn;  // This should not be this module's responsibility.

    function _init() {
        disableClickOK();
        _uiModalComment.ok.on("click", handleClickOK);
        _uiModalComment.cancel.on("click", handleClickCancel);
        _uiLeftColumn.feedback.on("click", handleClickFeedback);
        _uiModalComment.textarea.on("focus", handleTextareaFocus);
        _uiModalComment.textarea.on("blur", handleTextareaBlur);
        _uiModalComment.textarea.on("input", handleTextareaChange);
    }

    /**
     * Blink the feedback button on the left
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            _uiLeftColumn.feedback.toggleClass("highlight-50");
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
        var comment = _uiModalComment.textarea.val();
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
        _uiModalComment.holder.addClass('hidden');
    }

    function showCommentMenu () {
        _uiModalComment.textarea.val("");
        _uiModalComment.holder.removeClass('hidden');
        _uiModalComment.ok.addClass("disabled");
        disableClickOK();
    }

    function disableClickOK() {
        _uiModalComment.ok.attr("disabled", true);
        _uiModalComment.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    function enableClickOK () {
        _uiModalComment.ok.attr("disabled", false);
        _uiModalComment.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the feedback button on the left column
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        _uiLeftColumn.feedback.removeClass("highlight-50");
    }

    /**
     * Submit the comment
     */
    function submitComment () {
        var task = svl.taskContainer.getCurrentTask(),
            streetEdgeId = task.getStreetEdgeId(),
            gsvPanoramaId = svl.map.getPanoId(),
            pov = svl.map.getPov(),
            comment = _uiModalComment.textarea.val();
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
        form.postJSON("/audit/comment", data)
    }

    _init();

    self.blink = blink;
    self.stopBlinking = stopBlinking;

    return self;
}