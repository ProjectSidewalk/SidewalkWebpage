function ModalComment (modalUI) {
    var self = this;
    var status = {
        disableClickOk: true
    };

    function disableClickOk () {
        modalUI.ok.attr("disabled", true);
        modalUI.ok.addClass("disabled");
        status.disableClickOk = true;
    }

    function enableClickOk () {
        modalUI.ok.attr("disabled", false);
        modalUI.ok.removeClass("disabled");
        status.disableClickOk = false;
    }

    function handleClickCancel () {
        console.log("Clicked cancel button");
        hide();
    }

    function handleClickFeedbackButton() {
        console.log("Clicked feedback button");
        showCommentMenu();
    }

    function handleClickOk () {
        console.log("Clicked ok button");
        var data = prepareCommentData();
        console.log(data);
        submitComment(data);
        hide();
    }

    function handleTextAreaChange () {
        var comment = modalUI.textarea.val();
        console.log("Comment is: " + comment);
        if (comment.length > 0) {
            enableClickOk();
        } else {
            disableClickOk();
        }
    }
    /**
     * Hides comment box, enables validation keyboard shortcuts
     */
    function hide () {
        modalUI.holder.addClass('hidden');
        svv.keyboard.enableKeyboard();
    }

    function showCommentMenu () {
        modalUI.textarea.val("");
        modalUI.holder.removeClass('hidden');
        disableClickOk();
        svv.keyboard.disableKeyboard();

        // TODO: Fix CSS for the comment box. This is a temporary fix.
        modalUI.box.css("left", "5px");
        // showBackground();    // doesn't work as expected... overlay isn't applied to GSV pano
    }

    function showBackground () {
        svv.ui.modal.background.css('background-color', 'white');
        svv.ui.modal.background.css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });
    }

    /**
     * Submit the comment.
     */
    function submitComment (data) {
        var url = "/validate/comment";
        var async = true;
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

    function prepareCommentData () {
        var comment = modalUI.textarea.val();
        var position = svv.panorama.getPosition();
        var pov = svv.panorama.getPov();

        var data =  {
            comment: comment,
            label_id: svv.panorama.getCurrentLabel().getProperty("labelId"),
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