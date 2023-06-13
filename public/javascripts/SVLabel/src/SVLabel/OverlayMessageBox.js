/**
 * This module controls the message shown at the top of the Street View pane.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function OverlayMessageBox (modalModel, uiOverlayMessage) {
    var $helpLink = uiOverlayMessage.holder.find("#overlay-message-help-link");

    this._properties = { 'visibility' : 'visible' };

    /**
     * Set the message in the overlay box
     * @param mode
     * @returns {*}
     */
    this.setMessage =function (mode) {
        var instruction = i18next.t('top-ui.instruction.' + util.camelToKebab(mode));
        uiOverlayMessage.message.html(`<strong>${instruction}</strong>`);
        uiOverlayMessage.message.find(".overlay-message-label-type").on('click', function () {
            var labelType = $(this).attr("val");
            modalModel.showModalExample(labelType);
        });
    };
    this.setMessage('Walk');
}

/**
 * Set the visibility to visible or hidden.
 * @param val
 * @returns {setVisibility}
 */
OverlayMessageBox.prototype.setVisibility = function (val) {
    if (val === 'visible' || val === 'hidden') {
        this._properties.visibility = val;
    }
    return this;
};
