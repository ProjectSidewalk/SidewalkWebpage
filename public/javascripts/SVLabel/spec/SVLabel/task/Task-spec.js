describe("Task module", function () {
    var task;
    var geojson;
    var lat;
    var lng;
    var currentPosition;

    beforeEach(function () {
        geojson = prepareGeojson();
        lat = geojson.features[0].geometry.coordinates[0][1];
        lng = geojson.features[0].geometry.coordinates[0][0];
        task = new Task(geojson, lat, lng);
        currentPosition = prepareAPoint();
    });

    describe("`_getPointsOnAuditedSegments` method", function () {
        beforeEach(function () {
            lat = currentPosition.geometry.coordinates[1];
            lng = currentPosition.geometry.coordinates[0];
        });

        it("should return the segments in the street edge that have been audited", function () {
            var auditedCoordinates = task._getPointsOnAuditedSegments(lat, lng);
            expect(auditedCoordinates[0]).toEqual([-77.069, 38.908]);
            expect(auditedCoordinates[1]).toEqual([-77.069, 38.9085]);
            expect(auditedCoordinates[2][0]).toBeCloseTo(lng, 0.001);
            expect(auditedCoordinates[2][1]).toBeCloseTo(lat, 0.001);
        });
    });

    describe("`_getPointsOnUnauditedSegments` method", function () {
        beforeEach(function () {
            lat = currentPosition.geometry.coordinates[1];
            lng = currentPosition.geometry.coordinates[0];
        });

        it("should return the segments in the street edge that have been audited", function () {
            var unauditedCoordinates = task._getPointsOnUnauditedSegments(lat, lng);
            expect(unauditedCoordinates[0][0]).toBeCloseTo(lng);
            expect(unauditedCoordinates[0][1]).toBeCloseTo(lat);
            expect(unauditedCoordinates.length).toBe(3);

            expect(unauditedCoordinates[1]).toEqual([-77.0690865, 38.9087179]);
            expect(unauditedCoordinates[2]).toEqual([-77.0691266, 38.9097098]);
        });
    });

    describe("`_getAuditedSegments` method", function () {
        beforeEach(function () {
            lat = currentPosition.geometry.coordinates[1];
            lng = currentPosition.geometry.coordinates[0];
        });

        it("should return two segments", function () {
            var auditedSegments = task._getAuditedSegments(lat, lng);
            expect(auditedSegments.length).toBe(2);
            expect(auditedSegments[1].geometry.coordinates[1][0]).toBeCloseTo(lng);
            expect(auditedSegments[1].geometry.coordinates[1][1]).toBeCloseTo(lat);
        });
    });

    describe("`updateTheFurthestPointReached` method", function () {
        beforeEach(function () {
            lat = currentPosition.geometry.coordinates[1];
            lng = currentPosition.geometry.coordinates[0];
        });

        it("should update the furthest point reached", function () {
            var furthestPoint = task.getFurthestPointReached();

            expect(furthestPoint.geometry.coordinates).toEqual([-77.069, 38.908]);

            task.updateTheFurthestPointReached(lat, lng);
            furthestPoint = task.getFurthestPointReached();
            expect(furthestPoint.geometry.coordinates).not.toEqual([-77.069, 38.908]);
            expect(furthestPoint.geometry.coordinates[0]).toBeCloseTo(lng, 0.001);
            expect(furthestPoint.geometry.coordinates[1]).toBeCloseTo(lat, 0.001);
        });
    });

    function prepareAPoint () {
        return {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Point",
                "coordinates": [
                    -77.06904619932175,
                    38.90861930530303
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
                                -77.069,
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