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

    function putUserOrg(e) {
        var parsedId = $(this).attr('id').split("-"); // the id comes in the form of "from-startOrg-to-endOrg"
        var startOrg = parsedId[1];
        var endOrg = parsedId[3];
        $.ajax({
            async: true,
            url: '/userapi/setUserOrg/' + endOrg,
            type: 'put',
            success: function (result) {
                window.location.reload();
                if (endOrg != startOrg) {
                    if (startOrg != 0) {
                        logWebpageActivity("Click_module=leaving_org=" + startOrg);
                    }
                    if (endOrg != 0) {
                        logWebpageActivity("Click_module=joining_org=" + endOrg);
                    }
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    $('.put-user-org').on('click', putUserOrg);
}
