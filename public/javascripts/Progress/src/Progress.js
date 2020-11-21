function Progress (_, $, difficultRegionIds, userRole) {
    var params = {
        popupType: 'completionRate',
        neighborhoodPolygonStyle: {
            color: '#888',
            weight: 2,
            opacity: 0.80,
            fillColor: '#808080',
            fillOpacity: 0.1
        },
        mouseoverStyle: {
            color: '#000',
            opacity: 1.0,
            weight: 3
        },
        mouseoutStyle: {
            color: '#888',
            opacity: 0.8,
            weight: 2
        },
        webpageActivity: 'Click_module=UserMap_regionId=',
        polygonFillMode: 'singleColor',
        zoomControl: true,
        scrollWheelZoom: true,
        clickData: true,
        mapName: 'map',
        mapStyle: 'mapbox://styles/mapbox/streets-v11'
    };
    var streetParams = {
        includeLabelCounts: true,
        streetColor: 'rgba(128, 128, 128, 1.0)',
        useTotalAuditedDistance: false,
        progressElement: 'td-total-distance-audited',
        userRole: userRole
    };
    var map;
    var layers = [];
    var loadPolygons = $.getJSON('/neighborhoods');
    var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
    var loadMapParams = $.getJSON('/cityMapParams');
    var loadAuditedStreets = $.getJSON('/contribution/streets');
    var loadSubmittedLabels = $.getJSON('/userapi/labels');
    // When the polygons, polygon rates, and map params are all loaded the polygon regions can be rendered.
    var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
        map = Choropleth(_, $, 'null', params, layers, data1[0], data2[0], data3[0]);
    });
    // When the polygons have been rendered and the audited streets have loaded,
    // the audited streets can be rendered.
    var renderAuditedStreets = $.when(renderPolygons, loadAuditedStreets).done(function(data1, data2) {
        InitializeAuditedStreets(map, streetParams, data2[0]);
    });
    // When the audited streets have been rendered and the submitted labels have loaded,
    // the submitted labels can be rendered.
    $.when(renderAuditedStreets, loadSubmittedLabels).done(function(data1, data2) {
        InitializeSubmittedLabels(map, streetParams, 'null', InitializeMapLayerContainer(), data2[0])
        setRegionFocus(map, layers);
    });
}
