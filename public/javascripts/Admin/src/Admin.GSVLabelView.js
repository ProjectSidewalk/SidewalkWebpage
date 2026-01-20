async function AdminGSVLabelView(admin, viewerType, viewerAccessToken, source) {
    var self = {};
    self.admin = admin;
    self.source = source;

    var _init = async function() {
        self.panoProp = new PanoProperties();
        self.resultOptions = {
            "Agree": 1,
            "Disagree": 2,
            "Unsure": 3
        };

        await _resetModal();
    };

    async function _resetModal() {
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
                            '<div id="validation-input-holder" class="hidden">' +
                                `<h3 style="margin: 0px; padding-top: 10px;">${i18next.t('labelmap:is-correct')}</h3>` +
                                '<div id="validation-button-holder" style="padding-top: 10px;">' +
                                    '<button id="validation-agree-button" class="validation-button"' +
                                        'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                        i18next.t('common:yes') +
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
                                    // Idk why, but the first row is just getting removed automatically??
                                    '<tr><th>test</th><td id="to-be-removed"></td></tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:severity')}</th>` +
                                        '<td id="severity"></td>' +
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
                                        `<th id="ai-validation-header">${i18next.t('labelmap:ai-validation')}</th>` +
                                        '<td colspan="3" id="ai-validation"></td>' +
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
            modalText +=            '<tr>' +
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
        modalText +=            '</table>';
        if (self.admin) {
            modalText +=        '<div id="flag-input-holder">' +
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
        modalText +=        '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        self.modal = $(modalText);

        self.panoManager = await AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#validation-input-holder"), admin, viewerType, viewerAccessToken);

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

        self.commentButton = self.modal.find("#comment-button");
        self.commentTextArea = self.modal.find("#comment-textarea");

        if (self.source !== "UserMap") {
            self.modal.find('#validation-input-holder').removeClass('hidden');
            self.agreeButton.click(function () {
                if (self.prevAction !== "Agree") {
                    _disableValidationButtons();
                    _validateLabel("Agree");
                }
            });
            self.disagreeButton.click(function () {
                if (self.prevAction !== "Disagree") {
                    _disableValidationButtons();
                    _validateLabel("Disagree");
                }
            });
            self.unsureButton.click(function () {
                if (self.prevAction !== "Unsure") {
                    _disableValidationButtons();
                    _validateLabel("Unsure");
                }
            });

            self.commentButton.popover({
                template: '<div class="feedback-popover" role="tooltip"><div class="arrow"></div><div class="popover-content"></div></div>'
            });
            self.commentButton.click(function () {
                var comment = self.commentTextArea.val();
                if (comment) {
                    _submitComment(comment);
                }
            });
        }

        self.lowQualityButton.click(function() {
            _setFlag("low_quality", !self.flags["low_quality"]);
        });
        self.incompleteButton.click(function() {
            _setFlag("incomplete", !self.flags["incomplete"]);
        });
        self.staleButton.click(function() {
            _setFlag("stale", !self.flags["stale"]);
        });

        self.modalTitle = self.modal.find("#myModalLabel");
        self.modalTimestamp = self.modal.find("#timestamp");
        self.modalSeverity = self.modal.find("#severity");
        self.modalTags = self.modal.find("#tags");
        self.modalDescription = self.modal.find("#label-description");
        self.modalValidations = self.modal.find("#label-validations");
        self.modalAiValidationHeader = self.modal.find("#ai-validation-header");
        self.modalAiValidation = self.modal.find("#ai-validation");
        self.modalImageDate = self.modal.find("#image-capture-date");
        self.modalUsername = self.modal.find("#admin-username");
        self.modalTask = self.modal.find("#task");
        self.modalPrevValidations = self.modal.find("#prev-validations");
        self.modalPanoId = self.modal.find('#pano-id');
        self.modalPanoLink = self.modal.find('#view-in-gsv');
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
        const validationTimestamp = new Date();
        const canvasWidth = self.panoManager.svHolder.width();
        const canvasHeight = self.panoManager.svHolder.height();

        const panoMarkerPov = self.panoManager.getOriginalPosition();

        // This is the POV of the viewport center - this is where the user is looking.
        const userPov = self.panoManager.getPov();

        // Calculates the center xy coordinates of the kabel on the current viewport.
        const pixelCoordinates = self.panoProp.povToPixel3d(panoMarkerPov, userPov, canvasWidth, canvasHeight);

        // If the user has panned away from the label and it is no longer visible on the canvas, set canvasX/Y to null.
        // We add/subtract the radius of the label so that we still record these values when only a fraction of the
        // label is still visible.
        let labelCanvasX = null;
        let labelCanvasY = null;
        const labelRadius = 10;
        if (pixelCoordinates
            && pixelCoordinates.left + labelRadius > 0
            && pixelCoordinates.left - labelRadius < canvasWidth
            && pixelCoordinates.top + labelRadius > 0
            && pixelCoordinates.top - labelRadius < canvasHeight) {

            labelCanvasX = Math.round(pixelCoordinates.left - labelRadius);
            labelCanvasY = Math.round(pixelCoordinates.top - labelRadius);
        }

        const data = {
            label_id: self.panoManager.label.labelId,
            label_type: self.panoManager.label.label_type,
            validation_result: self.resultOptions[action],
            old_severity: self.panoManager.label.oldSeverity,
            new_severity: self.panoManager.label.newSeverity,
            old_tags: self.panoManager.label.oldTags,
            new_tags: self.panoManager.label.newTags,
            canvas_x: labelCanvasX,
            canvas_y: labelCanvasY,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            canvas_height: canvasHeight,
            canvas_width: canvasWidth,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: self.source,
            undone: false,
            redone: action !== self.prevAction
        };

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/validate",
            method: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                _resetButtonColors(action);
                _updateValidationChoice(action);
                _enableValidationButtons();
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    function _disableValidationButtons() {
        for (let button in self.resultButtons) {
            if (self.resultButtons.hasOwnProperty(button)) {
                self.resultButtons[button].prop('disabled', true);
                self.resultButtons[button].css('cursor', 'wait');
            }
        }
    }
    function _enableValidationButtons() {
        for (let button in self.resultButtons) {
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
            self.validationCounts['Disagree'] + ' ' + i18next.t('common:disagree') + ', ' +
            self.validationCounts['Unsure'] + ' ' + i18next.t('common:unsure');
        self.modalValidations.html(validationsTextAfter);
    }

    /**
     * Update just the validation row on the table.
     * @param action One of "Agree", "Disagree", or "Unsure".
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
        _setValidationCountText();
    }

    /**
     * Creates the AI validation row text, adds the AI icon, and sets the tooltip.
     * @param aiValidation The AI validation result, either "Agree", "Disagree", "Unsure", or null.
     * @private
     */
    function _setAiValidationRow(aiValidation) {
        // Remove any existing AI icon before adding a new one.
        self.modalAiValidationHeader.find('.label-view-ai-icon').remove();

        if (aiValidation) {
            const normalizedAiVal = aiValidation.toLowerCase();
            self.modalAiValidation.html(i18next.t('labelmap:ai-val-included', { aiVal: normalizedAiVal }));

            // Create the AI validation icon with the correct tooltip text.
            const aiIcon = new Image();
            aiIcon.src = '/assets/images/icons/ai-icon-transparent-small.png';
            aiIcon.alt = 'AI indicator';
            aiIcon.classList.add('label-view-ai-icon');
            aiIcon.setAttribute('data-toggle', 'tooltip');
            aiIcon.setAttribute('data-placement', 'top');
            aiIcon.setAttribute('title', i18next.t('common:ai-disclaimer', { aiVal: normalizedAiVal }));
            ensureAiTooltip(aiIcon);
            self.modalAiValidationHeader.append(aiIcon);
        } else {
            self.modalAiValidation.html(i18next.t('common:none'));
        }
    }

    /**
     * Submit a comment as a POST request.
     * @private
     */
    function _submitComment(comment) {
        var userPov = self.panoManager.getPov();
        var pos = self.panoManager.panoViewer.getPosition();
        var button = document.getElementById("comment-button");

        button.style.cursor = "wait";

        const data = {
            label_id: self.panoManager.label.labelId,
            label_type: self.panoManager.label.label_type,
            comment: comment,
            pano_id: self.panoManager.panoId,
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
            method: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                button.style.cursor = "pointer";
                self.commentTextArea.val('');
                self.commentButton.popover('toggle');
                setTimeout(function(){ self.commentButton.popover('toggle'); }, 1500);
            },
            error: function(xhr, textStatus, error){
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
            method: 'PUT',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                self.flags[flag] = state;
                _updateFlagButton();
            },
            error: function(xhr, textStatus, error){
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Updates the background of each flag button depending on the flag's state.
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

    async function showLabel(labelId) {
        // Reset modal when gsv panorama is not found.
        _resetButtonStates();
        self.panoManager.clearLabels();
        self.modal.modal({ 'show': true });

        await fetch(admin ? '/adminapi/label/id/' + labelId : '/label/id/' + labelId, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }).then(response => {
            if (!response.ok) {
                alert('Server error. Most likely a label with this ID did not exist.');
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        }).then(_handleData);
    }

    function _handleData(labelMetadata) {
        const labelPov = {
            heading: labelMetadata.heading,
            pitch: labelMetadata.pitch,
            zoom: labelMetadata.zoom,
        };

        const adminPanoramaLabel = AdminPanoramaLabel(labelMetadata.label_id, labelMetadata.label_type,
            labelMetadata.canvas_x, labelMetadata.canvas_y, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
            labelPov, labelMetadata.street_edge_id, labelMetadata.severity, labelMetadata.tags,
            labelMetadata.ai_generated);
        self.panoManager.setLabel(adminPanoramaLabel);

        // Pass a callback function that fills in the pano lat/lng.
        // TODO we're going to replace this in a future redesign, including in the same place as on all other UIs.
        const panoCallback = function () {
            const lat = self.panoManager.panoViewer.getPosition().lat;
            const lng = self.panoManager.panoViewer.getPosition().lng;
            self.modalLat.html(lat.toFixed(8) + '°');
            self.modalLng.html(lng.toFixed(8) + '°');

            // Fill in the View in GSV link if we're using GSV, otherwise hide it for now.
            if (self.panoManager.panoViewer.getViewerType() === 'gsv') {
                const href = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${labelPov.pano_id}&heading=${labelPov.heading}&pitch=${labelPov.pitch}`;
                self.modalPanoLink.html(`<a target="_blank">${i18next.t('common:gsv-info.view-in-gsv')}</a>`);
                self.modalPanoLink.children(":first").attr('href', href);
            } else {
                self.modalPanoLink.parent().hide();
            }
        };
        self.panoManager.setPano(labelMetadata.pano_id, labelPov).then(panoCallback);

        self.validationCounts['Agree'] = labelMetadata['num_agree'];
        self.validationCounts['Disagree'] = labelMetadata['num_disagree'];
        self.validationCounts['Unsure'] = labelMetadata['num_unsure'];
        self.prevAction = labelMetadata['user_validation'];
        _setValidationCountText();
        _setAiValidationRow(labelMetadata['ai_validation']);

        self.flags["low_quality"] = labelMetadata['low_quality'];
        self.flags["incomplete"] = labelMetadata['incomplete'];
        self.flags["stale"] = labelMetadata['stale'];
        _updateFlagButton();

        var labelDate = moment(new Date(labelMetadata.timestamp));
        var imageCaptureDate = moment(new Date(labelMetadata.image_capture_date));
        // Change modal title
        self.modalTitle.html(`${i18next.t('labelmap:label-type')}: ${i18next.t('common:' + camelToKebab(labelMetadata.label_type))}`);
        self.modalSeverity.html(labelMetadata.severity != null ? labelMetadata.severity : "No severity");
        // Create a list of translated tags that's parsable by i18next.
        var translatedTags = labelMetadata.tags.map(tag => i18next.t(`common:tag.${tag.replace(/:/g, '-')}`));
        self.modalTags.html(translatedTags.join(', ')); // Join to format using commas and spaces.
        self.modalDescription.text(labelMetadata.description != null ? labelMetadata.description : i18next.t('common:no-description'));
        self.modalTimestamp.html(labelDate.format('LL, LT') + " (" + labelDate.fromNow() + ")");
        self.modalImageDate.html(imageCaptureDate.format('MMMM YYYY'));
        self.modalPanoId.text(labelMetadata.pano_id);
        self.modalLabelId.html(labelMetadata.label_id);
        self.modalStreetId.html(labelMetadata.street_edge_id);
        self.modalRegionId.html(labelMetadata.region_id);
        if (labelMetadata.comments != null) {
            self.modalComments.html(labelMetadata.comments.map(util.escapeHTML).join("<hr style=\"margin: 2px 0;\">"));
        } else {
            self.modalComments.html(i18next.t('common:none'));
        }
        if (self.admin) {
            self.taskID = labelMetadata.audit_task_id;
            self.modalTask.html(`<a href='/admin/task/${labelMetadata.audit_task_id}'>${labelMetadata.audit_task_id}</a>`);
            self.modalUsername.html(`<a href='/admin/user/${encodeURI(labelMetadata.username)}'>${labelMetadata.username}</a>`);
            var prevVals = labelMetadata['admin_data']['previous_validations'];
            if (prevVals.length === 0) {
                self.modalPrevValidations.html(i18next.t('common:none'));
            } else {
                var prevValText = "";
                for (var i = 0; i < prevVals.length; i++) {
                    var prevVal = prevVals[i];
                    prevValText += `<a href='/admin/user/${encodeURI(prevVal.username)}'>${prevVal.username}</a>: ${i18next.t('common:' + camelToKebab(prevVal['validation']))}`;
                    if (i !== prevVals.length - 1) {
                        prevValText += "<br>";
                    }
                }
                self.modalPrevValidations.html(prevValText);
            }
        }
        // If the signed-in user has already validated this label, make the button look like it has been clicked.
        if (labelMetadata['user_validation']) _resetButtonColors(labelMetadata['user_validation']);
    }

    await _init();

    self.showLabel = showLabel;

    return self;
}
