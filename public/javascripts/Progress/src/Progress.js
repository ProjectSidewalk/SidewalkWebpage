function Progress (_, $, userRole) {
    var params = {
        popupType: 'completionRate',
        neighborhoodPolygonStyle: {
            color: '#407770',
            weight: 2,
            opacity: 0.6,
            fillColor: '#5d6d6b', 
            fillOpacity: 0.1, 
            dashArray: '6,6' 
        },
        mouseoverStyle: {
            color: '#5d6d6b',
            opacity: 1.0,
            weight: 2
        },
        mouseoutStyle: {
            color: '#407770',
            opacity: 0.6,
            weight: 2
        },
        zoomCorrection: -0.75,
        polygonFillMode: 'singleColor',
        zoomControl: true,
        neighborhoodsURL: '/neighborhoods',
        completionRatesURL: '/adminapi/neighborhoodCompletionRate',
        streetsURL: '/contribution/streets',
        labelsURL: '/userapi/labels',
        mapboxLogoLocation: 'bottom-right',
        mapStyle: 'mapbox://styles/mapbox/streets-v12?optimize=true',
        mapName: 'user-dashboard-choropleth',

        // Street params.
        includeLabelCounts: true,
        differentiateUnauditedStreets: false,
        interactiveStreets: false,
        userRole: userRole
    };
    CreatePSMap($, params).then(m => {
        window.map = m[0];
        setRegionFocus(map);
    });

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
