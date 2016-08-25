describe("Task module", function () {
    var task;
    var geojson;
    var lat;
    var lng;
    var currentPosition;

    beforeEach(function () {
        geojson = prepareGeojson();
        lat = geojson.features.geometry.coordinates[0][1];
        lng = geojson.features.geometry.coordinates[0][0];
        task = new Task(geojson, lat, lng);
        currentPosition = prepareAPoint();
    });

    describe("`_getPointsOnAuditedSegments` method", function () {
        it("should return the segments in the street edge that have been audited", function () {
            var auditedCoordinates = task._getPointsOnAuditedSegments(lat, lng);
            expect(auditedCoordinates).toEqual([[]]);
        });
    });

    function prepareAPoint () {
        return {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Point",
                "coordinates": [
                    -77.06896305084229,
                    38.908629741089186
                ]
            }
        };
    }

    function prepareGeojson() {
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [
                                -77.069,
                                38.908
                            ],
                            [
                                -77.0690,
                                38.9085
                            ],
                            [
                                -77.0690865,
                                38.9087179
                            ],
                            [
                                -77.0691266,
                                38.9097098
                            ]
                        ]
                    },
                    "properties": {
                        "street_edge_id": 20189,
                        "x1": -77.06908416748,
                        "y1": 38.908718109131,
                        "x2": -77.069129943848,
                        "y2": 38.90970993042,
                        "task_start": "2016-08-25 02:20:29.903",
                        "completed": false
                    }
                }
            ]
        };
    }
});