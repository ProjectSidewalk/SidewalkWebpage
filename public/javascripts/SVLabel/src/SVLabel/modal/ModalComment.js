/**
 * ModalComment module.
 * @param svl
 * @param tracker
 * @param ribbon
 * @param taskContainer
 * @param uiLeftColumn
 * @param uiModalComment
 * @param onboardingModel
 * @constructor
 */
function ModalComment (svl, tracker, ribbon, taskContainer, uiLeftColumn, uiModalComment, onboardingModel) {
    var self = this;
    var status = {
        disableClickOK: true
    };
    var blinkInterval;

    var _uiModalComment = uiModalComment;
    var _uiLeftColumn = uiLeftColumn;  // This should not be this module's responsibility.

    // Initializing feedback popover 
    _uiLeftColumn.feedback.popover();

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

    /**
     * Blink the feedback button on the left
     */
    self.blink = function () {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            _uiLeftColumn.feedback.toggleClass("highlight-50");
        }, 500);
    };

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

        var task = taskContainer.getCurrentTask();
        var panoramaId = svl.map.getPanoId();
        var latlng = svl.map.getPosition();
        var pov = svl.map.getPov();
        var data;

        data = self._prepareCommentData(panoramaId, latlng.lat, latlng.lng, pov, task);
        self._submitComment(data);
        self.hide();
    }

    function handleClickCancel (e) {
        tracker.push("ModalComment_ClickCancel");
        e.preventDefault();
        self.hide();
    }

    /**
     * Handles changes in the comment field
     */
    function handleTextareaChange () {
        var comment = _uiModalComment.textarea.val();
        if (comment.length > 0) {
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

    this.hide = function () {
        svl.modalSkip.hideSkipMenu();
        _uiModalComment.holder.addClass('hidden');
        svl.popUpMessage.enableInteractions();
        self.hideBackground();
    };

    function showCommentMenu () {
        _uiModalComment.textarea.val("");
        _uiModalComment.holder.removeClass('hidden');
        _uiModalComment.ok.addClass("disabled");
        self._disableClickOK();
        svl.popUpMessage.disableInteractions();
        self.showBackground();
    }

    this.hideBackground = function (){
        $('#modal-comment-background').css({ width: '', height: ''})
    };

    this.showBackground = function (){
        $('#modal-comment-background').css("background-color", "white");
        $('#modal-comment-background').css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });
    };

    self._disableClickOK = function () {
        _uiModalComment.ok.attr("disabled", true);
        _uiModalComment.ok.addClass("disabled");
        status.disableClickOK = true;
    };

    function enableClickOK () {
        _uiModalComment.ok.attr("disabled", false);
        _uiModalComment.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the feedback button on the left column
     */
    self.stopBlinking = function () {
        window.clearInterval(blinkInterval);
        _uiLeftColumn.feedback.removeClass("highlight-50");
    };

    /**
     * Submit the comment.
     */
    this._submitComment = function (data) {
        var url = "/explore/comment";
        var async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
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

    this._prepareCommentData = function (panoramaId, lat, lng, pov, task) {
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
            audit_task_id: task.getAuditTaskId(),
            mission_id: svl.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov ? pov.zoom : null
        };
    };


    self._disableClickOK();
    _uiModalComment.ok.on("click", handleClickOK);
    _uiModalComment.cancel.on("click", handleClickCancel);
    _uiLeftColumn.feedback.on("click", handleClickFeedback);
    _uiModalComment.textarea.on("focus", handleTextareaFocus);
    _uiModalComment.textarea.on("blur", handleTextareaBlur);
    _uiModalComment.textarea.on("input", handleTextareaChange);
}