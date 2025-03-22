function AdminUser(user, userId, serviceHoursUser) {
    var params = {
        mapName: 'user-dashboard-choropleth',
        mapStyle: 'mapbox://styles/mapbox/streets-v12?optimize=true',
        mapboxLogoLocation: 'bottom-right',
        neighborhoodsURL: '/neighborhoods',
        completionRatesURL: '/adminapi/neighborhoodCompletionRate',
        streetsURL: '/adminapi/auditedStreets/' + encodeURI(user),
        labelsURL: '/adminapi/labelLocations/' + encodeURI(user),
        logClicks: false,
        neighborhoodFillMode: 'singleColor',
        neighborhoodTooltip: 'none',
        neighborhoodFillColor: '#5d6d6b',
        neighborhoodFillOpacity: 0.1,
        popupLabelViewer: AdminGSVLabelView(true, "AdminUserDashboard"),
        includeLabelCounts: true
    };
    var self = {};
    CreatePSMap($, params).then(m => {
        self.map = m[0];
        self.mapData = m[3];
        addLegendListeners(self.map, self.mapData);
    });
    window.map = self;
    
    $.getJSON('/adminapi/tasks/' + encodeURI(user), function (data) {
        var grouped = _.groupBy(data, function (o) { return o.audit_task_id});
        var auditTaskId;
        var auditTaskIds = Object.keys(grouped);
        var tableRows = '';
        var labelCounter;
        var i;
        var auditTaskIdsLength = auditTaskIds.length;
        var j;
        var labelsLength;
        var labelType;
        auditTaskIds.sort(function (id1, id2) {
            var timestamp1 = grouped[id1][0].task_start;
            var timestamp2 = grouped[id2][0].task_start;
            if (timestamp1 < timestamp2) { return -1; }
            else if (timestamp1 > timestamp2) { return 1; }
            else { return 0; }
        });

        for (i = auditTaskIdsLength - 1; i >= 0; i--) {
            labelCounter = { 'CurbRamp': 0, 'NoCurbRamp': 0, 'Obstacle': 0, 'SurfaceProblem': 0, 'NoSidewalk': 0, 'Other': 0 };
            auditTaskId = auditTaskIds[i];
            labelsLength = grouped[auditTaskId].length;
            for (j = 0; j < labelsLength; j++) {
                labelType = grouped[auditTaskId][j]['label_type'];
                
                if (!(labelType in labelCounter)) {
                    labelType = 'Other';
                }
                labelCounter[labelType] += 1;
            }

            // No need to load locale, correct locale loaded in timestamp.
            var localDate = moment(new Date(grouped[auditTaskId][0]['task_end']));

            tableRows += "<tr>" +
                "<td class='col-xs-1'>" + localDate.format('L') + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["CurbRamp"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["NoCurbRamp"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["Obstacle"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["SurfaceProblem"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["NoSidewalk"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["Other"] + "</td>" +
                "</tr>";
        }

        $('#task-contribution-table').append(tableRows);
    });

    // Initialize datepicker calendars for setting flags.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    $(".datepicker").datepicker({
        autoclose: true,
        todayHighlight: true,
    }).datepicker('update', d);

    /**
     * Perform an AJAX call (PUT request) to modify all of a specified flag for the user before a specified date.
     * @param date
     * @param flag One of "low_quality", "incomplete", or "stale".
     * @param state
     */
    function setTaskFlagByDate(date, flag, state) {
        data = {
            'username': user,
            'date': date,
            'flag': flag,
            'state': state
        };
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/adminapi/setTaskFlagsBeforeDate',
            type: 'put',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                self.datePickedAlert(flag, true, date, state);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /**
     * Set all tasks' low quality flag before the datepicker calendar's date.
     */
    self.setLowQualityDate = function(state) {
        var lowQualityDate = new Date($("#low-quality-date").val());
        setTaskFlagByDate(lowQualityDate.getTime(), "low_quality", state);
    }

    /**
     * Set all tasks' incomplete flag before the datepicker calendar's date.
     */
    self.setIncompleteDate = function(state) {
        var incompleteDate = new Date($("#incomplete-date").val());
        setTaskFlagByDate(incompleteDate.getTime(), "incomplete", state);
    }

    /**
     * Creates an alert when the flag datepicker is used.
     * @param flag One of "low_quality", "incomplete", or "stale".
     * @param success
     * @param date
     * @param state
     */
    self.datePickedAlert = function(flag, success, date, state) {
        var alert = flag === "low_quality" ? $("#low-quality-alert") : $("#incomplete-alert");
        if (success) {
            var alertText = state ? `Flags before ${new Date(date)} set to "${flag}".` : `"${flag}" flags before ${new Date(date)} cleared.`;
        } else {
            alertText = "Flags failed to change.";
        }
        alert.text(alertText);

        alert.removeClass();
        alert.addClass(success ? "alert alert-success" : "alert alert-danger");

        alert.css('visibility','visible');
    }

    // Displays checkbox for user volunteer status.
    if (serviceHoursUser) {
        $("#check-volunteer").prop("checked", true);
    } else {
        $("#check-volunteer").prop("checked", false);
    }

    // Updates user's volunteer status when the checkbox is clicked.
    $("#check-volunteer").click(function() {
        var isChecked = $(this).is(":checked");
        updateVolunteerStatus(isChecked);
    });

    // Post request to update user's volunteer status.
    function updateVolunteerStatus(isChecked) {
        var url = "/updateVolunteerStatus";
        var async = true;
        var dataToSend = {
            userId: userId,
            isChecked: isChecked
        };
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(dataToSend),
            dataType: 'json',
            success: function(result) {
                console.log("Volunteer status updated successfully.");
            },
            error: function(result) {
                console.error(result);
            }
        });
    }

    function addLegendListeners(map, mapData) {
        // Add listeners on the checkboxes.
        $('#map-label-legend tr input[type="checkbox"]').each(function () {
            $(this).on('click', () => {
                filterLabelLayers(this, map, mapData, false);
            });
            this.disabled = false; // Enable the checkbox now that the map has loaded.
        });
    }

    return self;
}
