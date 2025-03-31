function Progress (_, $, userId, admin) {
    var params = {
        mapName: 'user-dashboard-choropleth',
        mapStyle: 'mapbox://styles/mapbox/streets-v12?optimize=true',
        zoomCorrection: -0.5,
        mapboxLogoLocation: 'bottom-right',
        neighborhoodsURL: '/neighborhoods',
        completionRatesURL: '/adminapi/neighborhoodCompletionRate',
        streetsURL: `/contribution/streets?userId=${encodeURI(userId)}`,
        labelsURL: `/userapi/labels?userId=${encodeURI(userId)}`,
        neighborhoodFillMode: 'singleColor',
        neighborhoodTooltip: admin? 'none' : 'completionRate',
        neighborhoodFillColor: '#5d6d6b',
        neighborhoodFillOpacity: 0.1,
        popupLabelViewer: admin? AdminGSVLabelView(true, "AdminUserDashboard") : AdminGSVLabelView(false, "UserMap"),
        includeLabelCounts: true
    };
    var self = {}
    CreatePSMap($, params).then(m => {
        self.map = m[0];
        self.mapData = m[3];
        setRegionFocus(self.map);
        addLegendListeners(self.map, self.mapData);
    });
    window.map = self;

    function logWebpageActivity(activity){
        var url = "/userapi/logWebpageActivity";
        var async = false;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(activity),
            dataType: 'json',
            success: function(result){},
            error: function (result) {
                console.error(result);
            }
        });
    }

    function putUserTeam(e, newTeam) {
        var parsedId = $(this).attr('id').split("-"); // the id comes in the form of "from-startTeam-to-endTeam"
        var startTeam = parsedId[1];
        var endTeam = newTeam ? newTeam : parsedId[3];
        $.ajax({
            async: true,
            url: `/userapi/setUserTeam?userId=${userId}&teamId=${endTeam}`,
            type: 'put',
            success: function (result) {
                if (!admin) {
                    if (startTeam && startTeam !== "0") {
                        logWebpageActivity("Click_module=leaving_team=" + startTeam);
                    }
                    if (endTeam && endTeam !== "0") {
                        logWebpageActivity("Click_module=joining_team=" + endTeam);
                    }
                }
                window.location.reload();
            },
            error: function (result) {
                console.error("Error logging activity:", result);
            }
        });
    }

    // function to call endpoint and create team
    function createTeam() {
        var teamName = util.escapeHTML($('#team-name-input').val());
        var teamDescription = util.escapeHTML($('#team-description-input').val());

        // Check for special characters in teamName and teamDescription.
        var specialCharRegex = /[&<>"']/;
        if (specialCharRegex.test(teamName) || specialCharRegex.test(teamDescription)) {
            alert(i18next.t('characters-not-allowed'));
            return;
        }

        // If no special characters, proceed with AJAX request
        $.ajax({
            async: true,
            url: '/userapi/createTeam',
            type: 'post',
            contentType: 'application/json',
            data: JSON.stringify({
                name: teamName,
                description: teamDescription
            }),
            success: function (result) {
                var newTeam = result.team_id;
                var userTeamElement = $('.put-user-team')[0];
                logWebpageActivity("Click_module=create_team=team_id=" + newTeam);
                putUserTeam.call(userTeamElement || { id: "-1" }, null, newTeam);
            },
            error: function (result) {
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

    $('.put-user-team').on('click', putUserTeam);
    $('#save-team-button').on('click', createTeam);
}
