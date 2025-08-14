function AdminUser(username, userId, serviceHoursUser) {
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
            'userId': userId,
            'date': date,
            'flag': flag,
            'state': state
        };
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/adminapi/setTaskFlagsBeforeDate',
            method: 'PUT',
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
        setTaskFlagByDate(new Date($("#low-quality-date").val()), "low_quality", state);
    }

    /**
     * Set all tasks' incomplete flag before the datepicker calendar's date.
     */
    self.setIncompleteDate = function(state) {
        setTaskFlagByDate(new Date($("#incomplete-date").val()), "incomplete", state);
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
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: `/updateVolunteerStatus?userId=${userId}&communityService=${isChecked}`,
            method: 'POST',
            dataType: 'json',
            success: function(result) {
                console.log("Volunteer status updated successfully.");
            },
            error: function(result) {
                console.error(result);
            }
        });
    }

    return self;
}
