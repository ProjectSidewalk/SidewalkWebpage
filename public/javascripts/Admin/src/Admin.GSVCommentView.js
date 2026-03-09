async function AdminGSVCommentView(admin, viewerType, viewerAccessToken) {
    const self = {};
    self.admin = admin;

    const _init = async function() {
        await _resetModal();
    };

    async function _resetModal() {
        const modalText =
            '<div class="modal fade" id="comment-modal" tabindex="-1" role="dialog" aria-labelledby="modal-comment">' +
                '<div class="modal-dialog" role="document" style="width: 840px">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="modal-comment"></h4>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="sv-holder-comment" style="width: 810px; height:540px">' +
                        '</div>' +
                        '<div id="button-holder">' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        self.modal = $(modalText);

        self.svHolder = self.modal.find('#sv-holder-comment');
        self.validateSection = self.modal.find('#button-holder');

        // For the both Mapillary and infra3D, the associated DOM element has to exist upon initialization. For
        // Mapillary, it can't be set to display: none. So we show the modal (with visibility: hidden) during init. Once
        // the pano viewer has been initialized, we close the modal and set it to visible again. Return the Promise that
        // resolves once the pano viewer has loaded and the modal has been closed.
        return new Promise((resolve) => {
            // TODO not supported w/ infra3D, as it can't have multiple viewers per page, a conflict with label viewer.
            // TODO my guess is that this is the same reason the Mapillary didn't work, though I didn't test fully.
            if (viewerType !== GsvViewer) {
                resolve();
            } else {
                self.modal.one('shown.bs.modal', async () => {
                    self.panoManager =
                        await AdminPanorama(self.svHolder[0], self.validateSection, admin, viewerType, viewerAccessToken);

                    // Once the modal has finished closing, we can set it as visible and resolve the Promise.
                    self.modal.one('hidden.bs.modal', async () => {
                        self.modal.css('visibility', 'visible');
                        resolve();
                    });
                    self.modal.modal('hide');
                });
                self.modal.css('visibility', 'hidden').modal('show');
                $('.modal-backdrop').css('visibility', 'hidden'); // Prevents backdrop from appearing briefly.
            }
        });
    }

    /**
     * Shows the popup showing the GSV location where a user added a comment, along with a label if there is one.
     * @param {string} panoId
     * @param {{heading: number, pitch: number, zoom: number}} pov
     * @param {number} [labelId]
     * @returns {Promise<void>}
     */
    async function showCommentGSV(panoId, pov, labelId) {
        // Open the modal. Listening to an event to know when it's fully open.
        const modalOpened = new Promise((resolve) => {
            self.modal.one('shown.bs.modal', () => resolve());
        });
        self.modal.modal('show');
        await modalOpened;

        if (viewerType !== GsvViewer) {
            self.svHolder.text('Only supported with Google imagery at this time, sorry!');
            return;
        }

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
