function AdminUser(user) {
    var params = {
        mapName: 'admin-user-choropleth',
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
    CreatePSMap($, params).then(m => {
        window.map = m[0];
    });
    
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

    // Initialize datepicker calendars for setting flags
    $(".datepicker").datepicker({
        autoclose: true,
        todayHighlight: true,
    }).datepicker('update', new Date());

    /**
     * Perform an AJAX call (PUT request) to modify all of a specified flag for the user before a specified date.
     * @param date
     * @param flag
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
            url: '/adminapi/setTaskFlagsByDate/',
            type: 'put',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                console.log("Flag change API called");
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
        setTaskFlagByDate(lowQualityDate.getTime(), "low_quality", state)
    }

    /**
     * Set all tasks' incomplete flag before the datepicker calendar's date.
     */
    self.setIncompleteDate = function(state) {
        var incompleteDate = new Date($("#incomplete-date").val());
        setTaskFlagByDate(incompleteDate.getTime(), "incomplete", state)
    }

    return self;
}
