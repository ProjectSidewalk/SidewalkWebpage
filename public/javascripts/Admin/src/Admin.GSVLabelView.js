function AdminGSVLabelView(admin, source) {
    var self = {};
    self.admin = admin;
    self.source = source;

    var _init = function() {
        self.panoProp = new PanoProperties();
        self.resultOptions = {
            "Agree": 1,
            "Disagree": 2,
            "Unsure": 3
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
            '<div id="svholder" style="width: 540px; height:360px"></div>' +
            '<div id="validation-input-holder">' +
            `<h3 style="margin: 0px; padding-top: 10px;">${i18next.t('labelmap:is-correct')}</h3>` +
            '<div id="validation-button-holder" style="padding-top: 10px;">' +
            '<button id="validation-agree-button" class="validation-button"' +
            'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
            i18next.t('common:agree') +
            '</button>' +
            '<button id="validation-disagree-button" class="validation-button"' +
            'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
            i18next.t('common:no') +
            '</button>' +
            '<button id="validation-unsure-button" class="validation-button"' +
            'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
            i18next.t('common:unsure') +
            '</button>' +
            '</div>' +
            '<div id="validation-comment-holder" style="padding-top: 10px; padding-bottom: 15px;">' +
            `<textarea id="comment-textarea" placeholder="${i18next.t('labelmap:add-comment')}" class="validation-comment-box"></textarea>` +
            `<button id="comment-button" class="submit-button" data-container="body" data-toggle="popover" data-placement="top" data-content="${i18next.t('labelmap:comment-submitted')}" data-trigger="manual">` +
            i18next.t('labelmap:submit-comment') +
            '</button>' +
            '</div>' +
            '</div>' +
            '<div class="modal-footer" style="padding:0px; padding-top:15px;">' +
            '<table class="table table-striped" style="font-size:small;>' +
            '<tr>' +
            `<th>${i18next.t('labelmap:label-type')}</th>` +
            '<td id="label-type-value"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:severity')}</th>` +
            '<td id="severity"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:temporary')}</th>` +
            '<td id="temporary"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:tags')}</th>` +
            '<td colspan="3" id="tags"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:description')}</th>` +
            '<td colspan="3" id="label-description"></td>' +
            '</tr>' +
            '<tr>' +
            '<th>' + i18next.t('labelmap:validations') + '</th>' +
            '<td colspan="3" id="label-validations"></td>' +
            '</tr>' +
            '<tr>' +
            '<th>' + i18next.t('common:comments') + '</th>' +
            '<td id="validator-comments" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:labeled')}</th>` +
            '<td id="timestamp" colspan="3"></td>' +
            '</tr>' +
            '<th>' + i18next.t('common:image-capture-date') + '</th>' +
            '<td id="image-capture-date" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.panorama-id')}</th>` +
            '<td id="pano-id" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.google-street-view')}</th>` +
            '<td id="view-in-gsv" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.latitude')}</th>` +
            '<td id="lat" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.longitude')}</th>` +
            '<td id="lng" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.label-id')}</th>` +
            '<td id="label-id" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.street-id')}</th>` +
            '<td id="street-id" colspan="3"></td>' +
            '</tr>' +
            '<tr>' +
            `<th>${i18next.t('common:gsv-info.region-id')}</th>` +
            '<td id="region-id" colspan="3"></td>' +
            '</tr>';
        if (self.admin) {
            modalText += '<tr>' +
                '<th>Username</th>' +
                '<td id="admin-username"></td>' +
                '</tr>' +
                '<tr>' +
                '<th>Audit Task ID</th>' +
                '<td id="task"></td>' +
                '</tr>' +
                '<tr>' +
                '<th>Previous Validations</th>' +
                '<td id="prev-validations"></td>' +
                '</tr>';
        }
        modalText += '</table>';
        if (self.admin) {
            modalText += '<div id="flag-input-holder">' +
                `<h3 id="flag-input-title">Manually set work quality for street</h3>` +
                '<p id="flag-input-description">Click on a button to apply or remove that flag from the <b>audit task</b> (street) that the label belongs to. Incomplete means they didn\'t finish or didn\'t use all label types. Stale means imagery is out of date.</p>' +
                '<div id="flag-button-holder">' +
                '<button id="flag-low-quality-button" class="flag-button">' +
                'Low Quality' +
                '</button>' +
                '<button id="flag-incomplete-button" class="flag-button">' +
                'Incomplete' +
                '</button>' +
                '<button id="flag-stale-button" class="flag-button">' +
                'Stale' +
                '</button>' +
                '</div>' +
                '</div>';
        }
        modalText += '</div>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>';

        self.modal = $(modalText);

        self.panorama = AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#validation-input-holder"), admin);

        self.agreeButton = self.modal.find("#validation-agree-button");
        self.modalComments = self.modal.find("#validator-comments");
        self.disagreeButton = self.modal.find("#validation-disagree-button");
        self.unsureButton = self.modal.find("#validation-unsure-button");
        self.resultButtons = {
            "Agree": self.agreeButton,
            "Disagree": self.disagreeButton,
            "Unsure": self.unsureButton
        };

        self.lowQualityButton = self.modal.find("#flag-low-quality-button");
        self.incompleteButton = self.modal.find("#flag-incomplete-button");
        self.staleButton = self.modal.find("#flag-stale-button");
        self.flagButtons = {
            "low_quality": self.lowQualityButton,
            "incomplete": self.incompleteButton,
            "stale": self.staleButton
        }
        self.flags = {
            "low_quality": null,
            "incomplete": null,
            "stale": null,
        }

        self.taskID = null;

        self.validationCounts = {
            "Agree": null,
            "Disagree": null,
            "Unsure": null
        }
        self.prevAction = null;

        self.agreeButton.click(function() {
            if (self.prevAction !== "Agree") {
                _disableValidationButtons();
                _validateLabel("Agree");
            }
        });
        self.disagreeButton.click(function() {
            if (self.prevAction !== "Disagree") {
                _disableValidationButtons();
                _validateLabel("Disagree");
            }
        });
        self.unsureButton.click(function() {
            if (self.prevAction !== "Unsure") {
                _disableValidationButtons();
                _validateLabel("Unsure");
            }
        });

        self.lowQualityButton.click(function() {
            _setFlag("low_quality", !self.flags["low_quality"]);
        });
        self.incompleteButton.click(function() {
            _setFlag("incomplete", !self.flags["incomplete"]);
        });
        self.staleButton.click(function() {
            _setFlag("stale", !self.flags["stale"]);
        });

        self.commentButton = self.modal.find("#comment-button");
        self.commentTextArea = self.modal.find("#comment-textarea");
        self.commentButton.popover({
            template: '<div class="feedback-popover" role="tooltip"><div class="arrow"></div><div class="popover-content"></div></div>'
        });
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
        self.modalImageDate = self.modal.find("#image-capture-date");
        self.modalUsername = self.modal.find("#admin-username");
        self.modalTask = self.modal.find("#task");
        self.modalPrevValidations = self.modal.find("#prev-validations");
        self.modalPanoId = self.modal.find('#pano-id');
        self.modalGsvLink = self.modal.find('#view-in-gsv');
        self.modalLat = self.modal.find('#lat');
        self.modalLng = self.modal.find('#lng');
        self.modalLabelId = self.modal.find("#label-id");
        self.modalStreetId = self.modal.find('#street-id');
        self.modalRegionId = self.modal.find('#region-id');
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

        // Calculates the center xy coordinates of the kabel on the current viewport.
        var pixelCoordinates = self.panoProp.povToPixel3d(panomarkerPov, userPov, canvasWidth, canvasHeight);

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
            old_severity: self.panorama.label.oldSeverity,
            new_severity: self.panorama.label.newSeverity,
            old_tags: self.panorama.label.oldTags,
            new_tags: self.panorama.label.newTags,
            canvas_x: labelCanvasX,
            canvas_y: labelCanvasY,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            canvas_height: canvasHeight,
            canvas_width: canvasWidth,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: self.source
        };

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/validate",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function(result) {
                _resetButtonColors(action);
                _updateValidationChoice(action);
                _enableValidationButtons();
            },
            error: function(result) {
                console.error(result);
            }
        });
    }

    function _disableValidationButtons() {
        for (var button in self.resultButtons) {
            if (self.resultButtons.hasOwnProperty(button)) {
                self.resultButtons[button].prop('disabled', true);
                self.resultButtons[button].css('cursor', 'wait');
            }
        }
    }
    function _enableValidationButtons() {
        for (var button in self.resultButtons) {
            if (self.resultButtons.hasOwnProperty(button)) {
                self.resultButtons[button].prop('disabled', false);
                self.resultButtons[button].css('cursor', 'pointer');
            }
        }
    }

    /**
     * Creates the validation row text and displays it in the label.
     */
    function _setValidationCountText() {
        // Form new string for validations row.
        var validationsTextAfter = '' + self.validationCounts['Agree'] + ' ' + i18next.t('common:agree') + ', ' +
            self.validationCounts['Disagree'] + ' ' + i18next.t('common:no') + ', ' +
            self.validationCounts['Unsure'] + ' ' + i18next.t('common:unsure');

        self.modalValidations.html(validationsTextAfter)
    }

    /**
     * Update just the validation row on the table.
     * @param action, can only be "Agree", "Disagree", and "Unsure"
     */
    function _updateValidationChoice(action) {
        // If they had validated before this, decrement the count for their previous validation choice, min 0.
        if (self.prevAction)
            self.validationCounts[self.prevAction] = Math.max(0, self.validationCounts[self.prevAction] - 1);

        // Update prevAction to be current action.
        self.prevAction = action;

        // Increment one of the votes based on action.
        self.validationCounts[action] += 1;

        // Call on helper to update the text.
        _setValidationCountText()
    }

    /**
     * Submit a comment as a POST request.
     * @private
     */
    function _submitComment(comment) {
        var userPov = self.panorama.panorama.getPov();
        var pos = self.panorama.panorama.getPosition();
        var button = document.getElementById("comment-button");

        button.style.cursor = "wait";

        let data = {
            label_id: self.panorama.label.labelId,
            label_type: self.panorama.label.label_type,
            comment: comment,
            gsv_panorama_id: self.panorama.panoId,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            lat: pos.lat(),
            lng: pos.lng()
        };

        // Submit the comment via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/comment",
            type: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function(result) {
                button.style.cursor = "pointer";
                self.commentTextArea.val('');
                self.commentButton.popover('toggle');
                setTimeout(function() { self.commentButton.popover('toggle'); }, 1500);
            },
            error: function(xhr, textStatus, error) {
                button.style.cursor = "pointer";
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

    /**
     * Reset all buttons to their original state.
     */
    function _resetButtonStates() {
        for (var button in self.resultButtons) {
            if (self.resultButtons.hasOwnProperty(button)) {
                self.resultButtons[button].css('background-color', 'white');
                self.resultButtons[button].css('color', 'black');
            }
        }
    }

    /**
     * Sets the new state of a flag for the current label's audit task.
     * @param flag
     * @param state
     * @private
     */
    function _setFlag(flag, state) {
        let data = {
            auditTaskId: self.taskID,
            flag: flag,
            state: state
        };

        // Submit the new flag state via PUT request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/adminapi/setTaskFlag",
            type: 'PUT',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function(result) {
                self.flags[flag] = state;
                _updateFlagButton();
            },
            error: function(xhr, textStatus, error) {
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Updates the background of each flag button depending on the flag's state
     * @private
     */
    function _updateFlagButton() {
        for (var button in self.flagButtons) {
            if (self.flags[button]) {
                self.flagButtons[button].css("background-color", "lightgray");
            } else {
                self.flagButtons[button].css("background-color", "white");
            }
        }
    }

    function showLabel(labelId) {
        // Reset modal when gsv panorama is not found.
        if (self.panorama.panorama.getStatus() === "ZERO_RESULTS") {
            _resetModal();
        }
        _resetButtonStates();
        self.panorama.clearLabels();

        self.modal.modal({
            'show': true
        });
        var adminLabelUrl = admin ? "/adminapi/label/id/" + labelId : "/label/id/" + labelId;
        $.ajax({
            dataType: 'json',
            url: adminLabelUrl,
            success: function(data) {
                _handleData(data);
            },
            error: function(xhr, textStatus, error) {
                alert('Server error. Most likely a label with this ID did not exist.');
            }
        });
    }

    function _escapeHTML(str) {
        return str.replace(/[&<>"']/g, function(match) {
            switch (match) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#039;';
                default: return match;
            }
        });
    }

    function _handleData(labelMetadata) {
        // Pass a callback function that fills in the pano lat/lng.
        var panoCallback = function() {
            var lat = self.panorama.panorama.getPosition().lat();
            var lng = self.panorama.panorama.getPosition().lng();
            var href = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${labelMetadata['gsv_panorama_id']}&heading=${labelMetadata['heading']}&pitch=${labelMetadata['pitch']}`;
            self.modalGsvLink.html(`<a target="_blank">${i18next.t('common:gsv-info.view-in-gsv')}</a>`);
            self.modalGsvLink.attr('href', href)
            self.modalLat.html(lat.toFixed(8) + '°');
            self.modalLng.html(lng.toFixed(8) + '°');
        }
        self.panorama.setPano(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom'], panoCallback);

        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_id'], labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'], util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
            labelMetadata['heading'], labelMetadata['pitch'], labelMetadata['zoom'], labelMetadata['street_edge_id'],
            labelMetadata['severity'], labelMetadata['tags']);
        self.panorama.setLabel(adminPanoramaLabel);

        self.validationCounts['Agree'] = labelMetadata['num_agree']
        self.validationCounts['Disagree'] = labelMetadata['num_disagree']
        self.validationCounts['Unsure'] = labelMetadata['num_unsure']
        self.prevAction = labelMetadata['user_validation']
        _setValidationCountText()

        self.flags["low_quality"] = labelMetadata['low_quality'];
        self.flags["incomplete"] = labelMetadata['incomplete'];
        self.flags["stale"] = labelMetadata['stale'];
        _updateFlagButton();

        var labelDate = moment(new Date(labelMetadata['timestamp']));
        var imageCaptureDate = moment(new Date(labelMetadata['image_capture_date']));
        // Change modal title
        self.modalTitle.html(`${i18next.t('labelmap:label-type')}: ${i18next.t('common:' + camelToKebab(labelMetadata['label_type_key']))}`);
        self.modalLabelTypeValue.html(i18next.t('common:' + camelToKebab(labelMetadata['label_type_value'])));
        self.modalSeverity.html(labelMetadata['severity'] != null ? labelMetadata['severity'] : "No severity");
        self.modalTemporary.html(labelMetadata['temporary'] ? i18next.t('common:yes') : i18next.t('common:no'));
        // Create a list of translated tags that's parsable by i18next.
        var translatedTags = labelMetadata['tags'].map(tag => i18next.t(`common:tag.${tag}`));
        self.modalTags.html(translatedTags.join(', ')); // Join to format using commas and spaces.
        self.modalDescription.text(labelMetadata['description'] != null ? labelMetadata['description'] : i18next.t('common:no-description'));
        self.modalTimestamp.html(labelDate.format('LL, LT') + " (" + labelDate.fromNow() + ")");
        self.modalImageDate.html(imageCaptureDate.format('MMMM YYYY'));
        self.modalPanoId.text(labelMetadata['gsv_panorama_id']);
        self.modalLabelId.html(labelMetadata['label_id']);
        self.modalStreetId.html(labelMetadata['street_edge_id']);
        self.modalRegionId.html(labelMetadata['region_id']);
        if (labelMetadata['comments'] != null) {
            self.modalComments.html(labelMetadata['comments'].map(_escapeHTML).join("<hr style=\"margin: 2px 0;\">"));
        } else {
            self.modalComments.html(i18next.t('common:none'));
        }
        if (self.admin) {
            self.taskID = labelMetadata['audit_task_id'];
            self.modalTask.html(`<a href='/admin/task/${labelMetadata['audit_task_id']}'>${labelMetadata['audit_task_id']}</a>`);
            self.modalUsername.html(`<a href='/admin/user/${encodeURI(labelMetadata['username'])}'>${labelMetadata['username']}</a>`);
            var prevVals = labelMetadata['admin_data']['previous_validations'];
            if (prevVals.length === 0) {
                self.modalPrevValidations.html(i18next.t('common:none'));
            } else {
                var prevValText = "";
                for (var i = 0; i < prevVals.length; i++) {
                    var prevVal = prevVals[i];
                    prevValText += `<a href='/admin/user/${encodeURI(prevVal['username'])}'>${prevVal['username']}</a>: ${i18next.t('common:' + camelToKebab(prevVal['validation']))}`;
                    if (i !== prevVals.length - 1) {
                        prevValText += "<br>";
                    }
                }
                self.modalPrevValidations.html(prevValText);
            }
        }
        // If the signed in user has already validated this label, make the button look like it has been clicked.
        if (labelMetadata['user_validation']) _resetButtonColors(labelMetadata['user_validation']);
    }

    _init();

    self.showLabel = showLabel;

    return self;
}
