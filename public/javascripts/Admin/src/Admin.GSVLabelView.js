function AdminGSVLabelView(admin) {
    var self = {};
    self.admin = admin;

    var _init = function() {
        self.panoProp = new PanoProperties();
        self.resultOptions = {
            "Agree": 1,
            "Disagree": 2,
            "NotSure": 3
        };

        _resetModal();
    };

    function _resetModal() {
        var modalText =
            '<div class="modal fade" id="labelModal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">' +
                '<div class="modal-dialog" role="document" style="width: 570px">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>' +
                            '<h4 class="modal-title" id="myModalLabel"></h4>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="svholder" style="width: 540px; height:360px">' +
                        '</div>' +
                        '<h3>Is this label correct?</h3>' +
                        '<div id="validation-button-holder">' +
                            '<button id="validation-agree-button" class="validation-button"' +
                                'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                'Agree' +
                            '</button>' +
                            '<button id="validation-disagree-button" class="validation-button"' +
                                'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                'Disagree' +
                            '</button>' +
                            '<button id="validation-not-sure-button" class="validation-button"' +
                                'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                'Not sure' +
                            '</button>' +
                        '</div>' +
                        '<div id="validation-comment-holder">' +
                            '<textarea id="comment-textarea" placeholder="' + i18next.t('label-map.add-comment') + '" class="validation-comment-box"></textarea>' +
                            '<button id="comment-button" class="submit-button">' +
                                i18next.t('label-map.submit') +
                            '</button>' +
                        '</div>' +
                        '<div class="modal-footer">' +
                            '<table class="table table-striped" style="font-size:small; margin-bottom: 0">' +
                                '<tr>' +
                                    '<th>Label Type</th>' +
                                    '<td id="label-type-value"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Severity</th>' +
                                    '<td id="severity"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Temporary</th>' +
                                    '<td id="temporary"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Tags</th>' +
                                    '<td colspan="3" id="tags"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Description</th>' +
                                    '<td colspan="3" id="label-description"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Validations</th>' +
                                    '<td colspan="3" id="label-validations"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Time Submitted</th>' +
                                    '<td id="timestamp" colspan="3"></td>' +
                                '</tr>' +
                                    '<th>Image Date</th>' +
                                    '<td id="image-date" colspan="3"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Pano ID</th>' +
                                    '<td id="pano-id" colspan="3"></td>' +
                                '</tr>';
        if (self.admin) {
            modalText +=
                                '<tr>' +
                                    '<th>Label ID</th>' +
                                    '<td id="label-id" colspan="3"></td>' +
                                '</tr>' +
                                '<tr>' +
                                    '<th>Task ID</th>' +
                                    '<td id="task"></td>' +
                                '</tr>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '</div>'
        } else {
            modalText += '</table>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>'
        }
        self.modal = $(modalText);

        self.panorama = AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#validation-button-holder"), admin);

        self.agreeButton = self.modal.find("#validation-agree-button");
        self.disagreeButton = self.modal.find("#validation-disagree-button");
        self.notSureButton = self.modal.find("#validation-not-sure-button");
        self.resultButtons = {
            "Agree": self.agreeButton,
            "Disagree": self.disagreeButton,
            "NotSure": self.notSureButton
        };

        self.agreeButton.click(function() {
            _validateLabel("Agree");
        });
        self.disagreeButton.click(function() {
            _validateLabel("Disagree");
        });
        self.notSureButton.click(function() {
            _validateLabel("NotSure");
        });

        self.commentButton = self.modal.find("#comment-button");
        self.commentTextArea = self.modal.find("#comment-textarea");
        self.commentButton.click(function() {
            var comment = self.commentTextArea.val();
            if (comment) {
                _submitComment(comment);
            }
        });

        self.modalTitle = self.modal.find("#myModalLabel");
        self.modalTimestamp = self.modal.find("#timestamp");
        self.modalLabelTypeValue = self.modal.find("#label-type-value");
        self.modalSeverity = self.modal.find("#severity");
        self.modalTemporary = self.modal.find("#temporary");
        self.modalTags = self.modal.find("#tags");
        self.modalDescription = self.modal.find("#label-description");
        self.modalValidations = self.modal.find("#label-validations");
        self.modalImageDate = self.modal.find("#image-date");
        self.modalTask = self.modal.find("#task");
        self.modalLabelId = self.modal.find("#label-id");
        self.modalPanoId = self.modal.find('#pano-id');
    }

    /**
     * Get together the data on the validation and submit as a POST request.
     * @param action
     * @private
     */
    function _validateLabel(action) {
        var validationTimestamp = new Date().getTime();
        var canvasWidth = self.panorama.svHolder.width();
        var canvasHeight = self.panorama.svHolder.height();

        var pos = self.panorama.getOriginalPosition();
        var panomarkerPov = {
            heading: pos.heading,
            pitch: pos.pitch
        };

        // This is the POV of the viewport center - this is where the user is looking.
        var userPov = self.panorama.panorama.getPov();
        var zoom = self.panorama.panorama.getZoom();

        // Calculates the center xy coordinates of the kabel on the current viewport.
        var pixelCoordinates = self.panoProp.povToPixel3d(panomarkerPov, userPov, zoom, canvasWidth, canvasHeight);

        // If the user has panned away from the label and it is no longer visible on the canvas, set canvasX/Y to null.
        // We add/subtract the radius of the label so that we still record these values when only a fraction of the
        // label is still visible.
        var labelCanvasX = null;
        var labelCanvasY = null;
        var labelRadius = 10;
        if (pixelCoordinates
            && pixelCoordinates.left + labelRadius > 0
            && pixelCoordinates.left - labelRadius < canvasWidth
            && pixelCoordinates.top + labelRadius > 0
            && pixelCoordinates.top - labelRadius < canvasHeight) {

            labelCanvasX = pixelCoordinates.left - labelRadius;
            labelCanvasY = pixelCoordinates.top - labelRadius;
        }

        var data = {
            label_id: self.panorama.label.labelId,
            label_type: self.panorama.label.label_type,
            validation_result: self.resultOptions[action],
            canvas_x: labelCanvasX,
            canvas_y: labelCanvasY,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            canvas_height: canvasHeight,
            canvas_width: canvasWidth,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            is_mobile: false
        };

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/validate",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                _resetButtonColors(action);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /**
     * Submit a comment as a POST request.
     * @private
     */
    function _submitComment(comment) {
        var userPov = self.panorama.panorama.getPov();
        var zoom = self.panorama.panorama.getZoom();
        var pos = self.panorama.panorama.getPosition();

        let data = {
            label_id: self.panorama.label.labelId,
            label_type: self.panorama.label.label_type,
            comment: comment,
            gsv_panorama_id: self.panorama.panoId,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: zoom,
            lat: pos.lat(),
            lng: pos.lng(),
        };

        // Submit the comment via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/comment",
            type: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                self.commentTextArea.val('');
            },
            error: function(xhr, textStatus, error){
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Sets background color of clicked button to gray, resets all others to white.
     * @param action
     * @private
     */
    function _resetButtonColors(action) {
        for (var button in self.resultButtons) {
            if (self.resultButtons.hasOwnProperty(button)) {
                self.resultButtons[button].css('background-color', 'white');
                self.resultButtons[button].css('color', 'black');
            }
        }
        var currButton = self.resultButtons[action];
        currButton.css('background-color', '#696969');
        currButton.css('color', 'white');
    }

    function showLabel(labelId) {
        _resetModal();

        self.modal.modal({
            'show': true
        });
        var adminLabelUrl = admin ? "/adminapi/label/id/" + labelId : "/label/id/" + labelId;
        $.getJSON(adminLabelUrl, function (data) {
            _handleData(data, admin);
        });
    }

    function _handleData(labelMetadata) {
        self.panorama.setPano(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);

        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_id'], labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'],
            labelMetadata['canvas_width'], labelMetadata['canvas_height'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);
        self.panorama.setLabel(adminPanoramaLabel);

        var validationsText = '' + labelMetadata['num_agree'] + ' Agree, ' +
            labelMetadata['num_disagree'] + ' Disagree, ' +
            labelMetadata['num_unsure'] + ' Not Sure';

        var labelDate = moment(new Date(labelMetadata['timestamp']));
        var imageDate = moment(new Date(labelMetadata['image_date']));
        self.modalTitle.html('Label Type: ' + labelMetadata['label_type_value']);
        self.modalTimestamp.html(labelDate.format('LL, LTS') + " (" + labelDate.fromNow() + ")");
        self.modalLabelTypeValue.html(labelMetadata['label_type_value']);
        self.modalSeverity.html(labelMetadata['severity'] != null ? labelMetadata['severity'] : "No severity");
        self.modalTemporary.html(labelMetadata['temporary'] ? "True": "False");
        self.modalTags.html(labelMetadata['tags'].join(', ')); // Join to format using commas and spaces.
        self.modalDescription.html(labelMetadata['description'] != null ? labelMetadata['description'] : "No description");
        self.modalValidations.html(validationsText);
        self.modalImageDate.html(imageDate.format('MMMM YYYY'));
        self.modalPanoId.html(labelMetadata['gsv_panorama_id']);
        if (self.admin) {
            self.modalLabelId.html(labelMetadata['label_id']);
            self.modalTask.html("<a href='/admin/task/"+labelMetadata['audit_task_id']+"'>"+
                labelMetadata['audit_task_id']+"</a> by <a href='/admin/user/" + encodeURI(labelMetadata['username']) + "'>" +
                labelMetadata['username'] + "</a>");
        }
    }

    _init();

    self.showLabel = showLabel;

    return self;
}
