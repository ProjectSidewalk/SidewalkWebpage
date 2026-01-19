async function AdminGSVCommentView(admin, viewerType, viewerAccessToken) {
    var self = {};
    self.admin = admin;

    var _init = async function() {
        self.panoProp = new PanoProperties();
        await _resetModal();
    };

    async function _resetModal() {
        var modalText =
            '<div class="modal fade" id="label-modal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">' +
                '<div class="modal-dialog" role="document" style="width: 840px">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="myModalLabel"></h4>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="svholder" style="width: 810px; height:540px">' +
                        '</div>' +
                        '<div id="button-holder">' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        self.modal = $(modalText);
        self.panoManager = await AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#button-holder"), admin, viewerType, viewerAccessToken);
    }

    /**
     * Shows the popup showing the GSV location where a user added a comment, along with a label if there is one.
     * @param {string} panoId
     * @param {{heading: number, pitch: number, zoom: number}} pov
     * @param {number} [labelId]
     * @returns {Promise<void>}
     */
    async function showCommentGSV(panoId, pov, labelId) {
        await _resetModal();
        self.modal.modal({ 'show': true });
        await self.panoManager.setPano(panoId, pov);

        if (labelId) {
            const adminLabelUrl = admin ? '/adminapi/label/id/' + labelId : '/label/id/' + labelId;
            $.getJSON(adminLabelUrl, function (data) {
                setLabel(data);
            });
         }
    }

    function setLabel(labelMetadata) {
        const isAiGenerated = labelMetadata['ai_generated'] === true;
        const labelPov = {
            heading: labelMetadata.heading,
            pitch: labelMetadata.pitch,
            zoom: labelMetadata.zoom
        }
        const adminPanoramaLabel = AdminPanoramaLabel(labelMetadata.label_id, labelMetadata.label_type,
            labelMetadata.canvas_x, labelMetadata.canvas_y, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
            labelPov, labelMetadata.street_edge_id, labelMetadata.severity, labelMetadata.tags, isAiGenerated);
        self.panoManager.setLabel(adminPanoramaLabel);
        self.panoManager.renderLabel(adminPanoramaLabel);
    }

    await _init();
    self.showCommentGSV = showCommentGSV;
    return self;
}
