describe("NeighborhoodModel module.", function () {
    var neighborhoodModel;
    var neighborhoodContainer;
    var neighborhoodFactory;
    var geojson;

    beforeEach(function () {
        initializeGeojson();

        neighborhoodModel = new NeighborhoodModel();

    });

    describe("`_handleFetchComplete` method", function () {
        beforeEach(function () {
            neighborhoodContainer = new NeighborhoodContainer(neighborhoodModel);
            neighborhoodFactory = new NeighborhoodFactory(neighborhoodModel);
        });

        afterEach(function () {
            neighborhoodContainer = null;
            neighborhoodFactory = null;
        });

        it("should add the neighborhoods in a NeighborhoodContainer", function () {
            neighborhoodModel._handleFetchComplete(geojson);
            var regionIds = neighborhoodContainer.getRegionIds();

            expect(regionIds).toEqual([1, 2]);

            neighborhoodModel._handleFetchComplete(geojson);
            regionIds = neighborhoodContainer.getRegionIds();
            expect(regionIds).toEqual([1, 2]);
        });
    });

    describe("`nextRegion` method", function () {
        it("should return the regionId of the neighborhood that is available");
    });

    function initializeGeojson() {
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "region_id": 1,
                        "region_name": "Test Region 1"
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [
                                    -77.05810546875,
                                    38.89584266537804
                                ],
                                [
                                    -77.05810546875,
                                    38.906262865507145
                                ],
                                [
                                    -77.0357894897461,
                                    38.906262865507145
                                ],
                                [
                                    -77.0357894897461,
                                    38.89584266537804
                                ],
                                [
                                    -77.05810546875,
                                    38.89584266537804
                                ]
                            ]
                        ]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "region_id": 2,
                        "region_name": "Test Region 2"
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [
                                    -77.0309829711914,
                                    38.90118654877647
                                ],
                                [
                                    -77.0309829711914,
                                    38.910804525446686
                                ],
                                [
                                    -77.00969696044922,
                                    38.910804525446686
                                ],
                                [
                                    -77.00969696044922,
                                    38.90118654877647
                                ],
                                [
                                    -77.0309829711914,
                                    38.90118654877647
                                ]
                            ]
                        ]
                    }
                }
            ]
        }
    }
});