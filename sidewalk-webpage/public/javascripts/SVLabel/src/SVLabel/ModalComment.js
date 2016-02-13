function ModalComment ($) {
    var self = { className: 'ModalComment'},
        status = {
            disableClickOK: true
        };

    function _init() {
        disableClickOK();
        svl.ui.modalComment.ok.on("click", handleClickOK);
        svl.ui.modalComment.cancel.on("click", handleClickCancel);
        svl.ui.leftColumn.feedback.on("click", showCommentMenu);
        svl.ui.modalComment.textarea.on("focus", handleTextareaFocus);
        svl.ui.modalComment.textarea.on("blur", handleTextareaBlur);
        svl.ui.modalComment.textarea.on("input", handleTextareaChange);
    }

    function handleClickOK (e) {
        e.preventDefault();
        submitComment();
        hideCommentMenu();
    }

    function handleClickCancel (e) {
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
        if ('ribbon' in svl) { svl.ribbon.enableModeSwitch(); }

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

    function submitComment () {
        if ('task' in svl) {
            var streetEdgeId = svl.task.getStreetEdgeId(),
                gsvPanoramaId = svl.panorama.getPano(),
                pov = svl.getPOV(),
                comment = svl.ui.modalComment.textarea.val();

            var data = {
                street_edge_id: streetEdgeId,
                gsv_panorama_id: gsvPanoramaId,
                heading: pov ? pov.heading : null,
                pitch: pov ? pov.pitch : null,
                zoom: pov ? pov.zoom : null,
                comment: comment
            };

            $.ajax({
                // async: false,
                contentType: 'application/json; charset=utf-8',
                url: "/audit/comment",
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                    if (result.error) {
                        console.log(result.error);
                    }
                },
                error: function (result) {
                    console.error(result);
                }
            });        }
    }

    _init();
    return self;
}