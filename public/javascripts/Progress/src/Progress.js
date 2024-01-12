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
        defaultZoomIncrease: -1.0,
        polygonFillMode: 'singleColor',
        zoomControl: true,
        scrollWheelZoom: true,
        mapboxLogoLocation: 'bottom-right',
        mapStyle: 'mapbox://styles/mapbox/streets-v12?optimize=true',
        mapName: 'user-dashboard-choropleth',
        logClicks: true
    };
    var streetParams = {
        includeLabelCounts: true,
        differentiateUnauditedStreets: false,
        interactiveStreets: false,
        userRole: userRole,
        mapName: 'user-dashboard-choropleth',
        logClicks: true
    };
    var map;
    var loadPolygons = $.getJSON('/neighborhoods');
    var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
    var loadMapParams = $.getJSON('/cityMapParams');
    var loadAuditedStreets = $.getJSON('/contribution/streets');
    var loadSubmittedLabels = $.getJSON('/userapi/labels');
    // When the polygons, polygon rates, and map params are all loaded the polygon regions can be rendered.
    var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
        map = Choropleth(_, $, params, data1[0], data2[0], data3[0]);
    });
    // When the polygons have been rendered and the audited streets have loaded,
    // the audited streets can be rendered.
    var renderAuditedStreets = $.when(renderPolygons, loadAuditedStreets).done(function(data1, data2) {
        map.on('load', function() {
            InitializeStreets(map, streetParams, data2[0]);
        });
    });
    // When the audited streets have been rendered and the submitted labels have loaded,
    // the submitted labels can be rendered.
    $.when(renderAuditedStreets, loadSubmittedLabels).done(function(data1, data2) {
        map.on('load', function() {
            InitializeSubmittedLabels(map, streetParams, 'null', InitializeMapLayerContainer(), data2[0]);
            setRegionFocus(map);
        });
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
