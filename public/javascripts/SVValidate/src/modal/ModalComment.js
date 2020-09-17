/**
 * Handles feedback button functionality. Allows users to submit feedback, which is logged to the
 * validation_task_interaction table.
 * @param modalUI   UI elements related to feedback (button, dialog box buttons)
 * @returns {ModalComment}
 * @constructor
 */
function ModalComment (modalUI) {
    let self = this;
    let status = {
        disableClickOk: true
    };

    /**
     * Disables the ok button (makes button unclickable).
     */
    function disableClickOk () {
        modalUI.ok.attr("disabled", true);
        modalUI.ok.addClass("disabled");
        status.disableClickOk = true;
    }

    /**
     * Enables the ok button (makes button clickable).
     */
    function enableClickOk () {
        modalUI.ok.attr("disabled", false);
        modalUI.ok.removeClass("disabled");
        status.disableClickOk = false;
    }

    /**
     * Hides the comments dialog box.
     */
    function handleClickCancel () {
        svv.tracker.push("ModalComment_ClickCancel");
        hideCommentMenu();
    }

    /**
     * Shows the comments dialog box.
     */
    function handleClickFeedbackButton() {
        svv.tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    /**
     * Submits text in the comment box to the backend.
     */
    function handleClickOk () {
        svv.tracker.push("ModalComment_ClickOK");
        let data = prepareCommentData();
        submitComment(data);
        hideCommentMenu();
    }

    /**
     * Triggered when text is changed in the comments box. Will enable the "ok"
     * button if there is text.
     */
    function handleTextAreaChange () {
        let comment = modalUI.textarea.val();
        if (comment.length > 0) {
            enableClickOk();
        } else {
            disableClickOk();
        }
    }

    /**
     * Hides comment box, enables validation keyboard shortcuts
     */
    function hideCommentMenu () {
        modalUI.holder.addClass('hidden');
        hideBackground();
        svv.keyboard.enableKeyboard();
        svv.modalSkip.enableSkip();
    }

    function hideBackground () {
        svv.ui.modal.background.css({
            width: 0,
            height: 0
        });

        $('#svv-panorama').css('z-Index', '1');
    }

    /**
     * Displays the comment menu. Disables validation keyboard controls (may interfere with the
     * comment menu).
     */
    function showCommentMenu () {
        modalUI.textarea.val("");
        modalUI.holder.removeClass('hidden');
        disableClickOk();
        svv.keyboard.disableKeyboard();
        svv.modalSkip.disableSkip();
        showBackground();    // doesn't work as expected... overlay isn't applied to GSV pano
    }

    /**
     * Renders a transparent white overlay over the validation interface and side menus.
     */
    function showBackground () {
        svv.ui.modal.background.css('background-color', 'white');
        svv.ui.modal.background.css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });

        // SVV Panorama is not covered by overlay at regular z-index
        $('#svv-panorama').css('z-Index', '0');
    }

    /**
     * Submit the comment.
     */
    function submitComment (data) {
        let url = "/validate/comment";
        let async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {},
            error: function(xhr, textStatus, error){
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Converts comment and some validation interface data into an object to be sent to the backend.
     * @returns Comment data object {{comment, label_id, gsv_panorama_id: *, heading, lat, lng,
     * pitch, mission_id, zoom}}
     */
    function prepareCommentData () {
        let comment = modalUI.textarea.val();
        let position = svv.panorama.getPosition();
        let pov = svv.panorama.getPov();

        let data = {
            comment: comment,
            label_id: svv.panorama.getCurrentLabel().getAuditProperty("labelId"),
            gsv_panorama_id: svv.panorama.getPanoId(),
            heading: pov.heading,
            lat: position.lat,
            lng: position.lng,
            pitch: pov.pitch,
            mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov.zoom
        };
        return data;
    }

    modalUI.cancel.on('click', handleClickCancel);
    modalUI.feedbackButton.on('click', handleClickFeedbackButton);
    modalUI.ok.on('click', handleClickOk);
    modalUI.textarea.on('input', handleTextAreaChange);

    return this;
}
