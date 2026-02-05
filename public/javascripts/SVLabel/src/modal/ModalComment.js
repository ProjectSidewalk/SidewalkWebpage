/**
 * ModalComment module.
 * @param svl
 * @param tracker
 * @param ribbon
 * @param taskContainer
 * @param uiLeftColumn
 * @param uiModalComment
 * @constructor
 */
function ModalComment (svl, tracker, ribbon, taskContainer, uiLeftColumn, uiModalComment) {
    let self = this;
    let status = {
        disableClickOK: true
    };
    let blinkInterval;

    let _uiModalComment = uiModalComment;
    let _uiLeftColumn = uiLeftColumn;  // This should not be this module's responsibility.

    // Initializing feedback popover
    _uiLeftColumn.feedback.popover();

    /**
     * Blink the feedback button on the left
     */
    self.blink = function() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            _uiLeftColumn.feedback.toggleClass("highlight-50");
        }, 500);
    };

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
     * Stop blinking the feedback button on the left column
     */
    self.stopBlinking = function() {
        window.clearInterval(blinkInterval);
        _uiLeftColumn.feedback.removeClass("highlight-50");
    };

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
                _uiLeftColumn.feedback.popover('toggle');
                setTimeout(function(){ _uiLeftColumn.feedback.popover('toggle'); }, 1500);
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
    _uiLeftColumn.feedback.off('click').on("click", handleClickFeedback);
    _uiModalComment.textarea.off('focus').on("focus", handleTextareaFocus);
    _uiModalComment.textarea.off('blur').on("blur", handleTextareaBlur);
    _uiModalComment.textarea.off('input').on("input", handleTextareaChange);
}
