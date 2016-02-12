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
    }

    function handleClickOK (e) {
        e.preventDefault();
        hideCommentMenu();
    }

    function handleClickCancel (e) {
        e.preventDefault();
        hideCommentMenu();
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

    _init();
    return self;
}