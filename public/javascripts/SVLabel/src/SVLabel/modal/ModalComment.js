/**
 * ModalComment module.
 * @param form
 * @param uiLeftColumn
 * @param uiModalComment
 * @param modalModel
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalComment (svl, form, tracker, ribbon, taskContainer, uiLeftColumn, uiModalComment, modalModel) {
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
        tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    function handleClickOK (e) {
        e.preventDefault();
        tracker.push("ModalComment_ClickOK");

        var task = taskContainer.getCurrentTask(),
            panoramaId = svl.map.getPanoId(),
            latlng = svl.map.getPosition(),
            pov = svl.map.getPov(),
            data;

        data = _prepareCommentData(panoramaId, latlng.lat, latlng.lng, pov, task);
        _submitComment(data);
        hideCommentMenu();
    }

    function handleClickCancel (e) {
        tracker.push("ModalComment_ClickCancel");
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
        ribbon.enableModeSwitch();
    }

    function handleTextareaFocus() {
        ribbon.disableModeSwitch();
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
     * Submit the comment.
     * Todo.
     */
    function _submitComment (data) {
        form.postJSON("/audit/comment", data)
    }

    function _prepareCommentData (panoramaId, lat, lng, pov, task) {
        var streetEdgeId = task.getStreetEdgeId(),
            comment = _uiModalComment.textarea.val();

        return {
            comment: comment,
            gsv_panorama_id: panoramaId,
            heading: pov ? pov.heading : null,
            lat: lat,
            lng: lng,
            pitch: pov ? pov.pitch : null,
            street_edge_id: streetEdgeId,
            zoom: pov ? pov.zoom : null
        };
    }

    _init();

    self.blink = blink;
    self.stopBlinking = stopBlinking;
    self._submitComment = _submitComment;
    self._prepareCommentData = _prepareCommentData;

    return self;
}