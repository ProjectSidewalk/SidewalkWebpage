function Progress (_, $, userRole) {
    var params = {
        mapName: 'user-dashboard-choropleth',
        mapStyle: 'mapbox://styles/mapbox/streets-v12?optimize=true',
        zoomCorrection: -0.75,
        mapboxLogoLocation: 'bottom-right',
        neighborhoodsURL: '/neighborhoods',
        completionRatesURL: '/adminapi/neighborhoodCompletionRate',
        streetsURL: '/contribution/streets',
        labelsURL: '/userapi/labels',
        neighborhoodFillMode: 'singleColor',
        neighborhoodTooltip: 'completionRate',
        neighborhoodFillColor: '#5d6d6b',
        neighborhoodFillOpacity: 0.1,
        includeLabelCounts: true
    };
    CreatePSMap($, params).then(m => {
        window.map = m[0];
        setRegionFocus(window.map);
    });

    // Get total reward if a turker.
    if (userRole === 'Turker') {
        $.ajax({
            async: true,
            url: '/rewardEarned',
            type: 'get',
            success: function(rewardData) {
                document.getElementById('td-total-reward-earned').innerHTML = '$' + rewardData.reward_earned.toFixed(2);
            },
            error: function (xhr, ajaxOptions, thrownError) {
                console.log(thrownError);
            }
        })
    }

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
        var parsedId = $(this).attr('id').split("-"); // the id comes in the form of "from-startOrg-to-endOrg"
        var startTeam = parsedId[1];
        var endTeam = newTeam ? newTeam : parsedId[3];
        $.ajax({
            async: true,
            url: '/userapi/setUserOrg/' + endTeam,
            type: 'put',
            success: function (result) {
                if (startTeam && startTeam !== "0") {
                    logWebpageActivity("Click_module=leaving_team=" + startTeam);
                }
                if (endTeam && endTeam !== "0") {
                    logWebpageActivity("Click_module=joining_team=" + endTeam);
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
        var orgName = util.escapeHTML($('#team-name-input').val());
        var orgDescription = util.escapeHTML($('#team-description-input').val());
        
        $.ajax({
            async: true,
            url: '/userapi/createTeam', 
            type: 'post',
            contentType: 'application/json',
            data: JSON.stringify({
                name: orgName,
                description: orgDescription
            }),
            success: function (result) {
                var newTeam = result.org_id;
                var userOrgElement = $('.put-user-org')[0];
                logWebpageActivity("Click_module=create_team=team_id=" + newTeam);
                putUserTeam.call(userOrgElement || { id: "-1" }, null, newTeam);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }
    $('.put-user-org').on('click', putUserTeam);
    $('#save-team-button').on('click', createTeam);
}
