/**
 * ModalComment module.
 * @param svl
 * @param tracker
 * @param ribbon
 * @param taskContainer
 * @constructor
 */
function ModalComment (svl, tracker, ribbon, taskContainer) {
    const self = this;
    let status = {
        disableClickOK: true
    };

    const _uiModalComment = {
        holder: $("#modal-comment-holder"),
        ok: $("#modal-comment-ok-button"),
        cancel: $("#modal-comment-cancel-button"),
        textarea: $("#modal-comment-textarea")
    };
    // The feedback button opens this modal, so this module owns it. Kept as a jQuery object for Bootstrap's popover.
    const _feedbackButton = $("#left-column-feedback-button");

    // Initializing feedback popover
    _feedbackButton.popover();

    /**
     * A callback function for clicking the feedback button on the left
     * @param e
     */
    function handleClickFeedback(e) {
        tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    function handleClickOK(e) {
        e.preventDefault();
        tracker.push("ModalComment_ClickOK");

        const task = taskContainer.getCurrentTask();
        const panoId = svl.panoViewer.getPanoId();
        const latlng = svl.panoViewer.getPosition();
        const pov = svl.panoViewer.getPov();
        let data;

        data = self._prepareCommentData(panoId, latlng.lat, latlng.lng, pov, task);
        self._submitComment(data);
        self.hide();
    }

    function handleClickCancel(e) {
        tracker.push("ModalComment_ClickCancel");
        e.preventDefault();
        self.hide();
    }

    /**
     * Handles changes in the comment field
     */
    function handleTextareaChange() {
        if (_uiModalComment.textarea.val().length > 0) {
            enableClickOK();
        } else {
            self._disableClickOK();
        }
    }

    function handleTextareaBlur() {
        ribbon.enableModeSwitch();
    }

    function handleTextareaFocus() {
        ribbon.disableModeSwitch();
    }

    this.hide = function() {
        _uiModalComment.holder.addClass('hidden');
        svl.popUpMessage.enableInteractions();
        self.hideBackground();
    };

    function showCommentMenu() {
        _uiModalComment.textarea.val("");
        _uiModalComment.holder.removeClass('hidden');
        _uiModalComment.ok.addClass("disabled");
        self._disableClickOK();
        svl.popUpMessage.disableInteractions();
        self.showBackground();
    }

    this.hideBackground = function(){
        $('#modal-comment-background').css({ width: '', height: ''})
    };

    this.showBackground = function(){
        $('#modal-comment-background').css("background-color", "white");
        $('#modal-comment-background').css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });
    };

    self._disableClickOK = function() {
        _uiModalComment.ok.attr("disabled", true);
        _uiModalComment.ok.addClass("disabled");
        status.disableClickOK = true;
    };

    function enableClickOK() {
        _uiModalComment.ok.attr("disabled", false);
        _uiModalComment.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Submit the comment.
     */
    this._submitComment = function(data) {
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/explore/comment',
            method: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                _feedbackButton.popover('toggle');
                setTimeout(function(){ _feedbackButton.popover('toggle'); }, 1500);
            },
            error: function (result) {
                console.error(result);
            }
        });
    };

    this._prepareCommentData = function(panoId, lat, lng, pov, task) {
        return {
            comment: _uiModalComment.textarea.val(),
            pano_id: panoId,
            heading: pov.heading,
            lat: lat,
            lng: lng,
            pitch: pov.pitch,
            street_edge_id: task.getStreetEdgeId(),
            audit_task_id: task.getAuditTaskId(),
            mission_id: svl.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov.zoom
        };
    };


    self._disableClickOK();
    _uiModalComment.ok.off('click').on("click", handleClickOK);
    _uiModalComment.cancel.off('click').on("click", handleClickCancel);
    _feedbackButton.off('click').on("click", handleClickFeedback);
    _uiModalComment.textarea.off('focus').on("focus", handleTextareaFocus);
    _uiModalComment.textarea.off('blur').on("blur", handleTextareaBlur);
    _uiModalComment.textarea.off('input').on("input", handleTextareaChange);
}
