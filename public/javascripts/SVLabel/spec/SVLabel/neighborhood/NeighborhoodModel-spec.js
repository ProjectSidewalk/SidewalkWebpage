describe("NeighborhoodModel module.", function () {
    var neighborhoodModel;
    var neighborhoodContainer;
    var neighborhoodFactory;
    var geojson;

    beforeEach(function () {
        initializeGeojson();

        neighborhoodContainer = new NeighborhoodContainerMock();
        neighborhoodModel = new NeighborhoodModel();
        neighborhoodModel._neighborhoodContainer = neighborhoodContainer;

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

    describe("`currentNeighborhood` method", function () {
        beforeEach(function () {
            spyOn(neighborhoodContainer, 'getCurrentNeighborhood');
        });

        describe("if `this._neighborhoodContainer` is set", function () {
            it("should call `NeighborhoodContainer.getCurrentNeighborhood` method", function () {
                var neighborhood = neighborhoodModel.currentNeighborhood();
                expect(neighborhoodContainer.getCurrentNeighborhood).toHaveBeenCalled();
            });
        });

        describe("if `this._neighborhoodContainer` is null", function () {
            beforeEach(function () {
                neighborhoodModel._neighborhoodContainer = null;
            });

            it("should return null", function () {
                var neighborhood = neighborhoodModel.currentNeighborhood();
                expect(neighborhood).toBeNull();
            });
        });
    });

    describe("`neighborhoodCompleted` method", function () {
        beforeEach(function () {
            neighborhoodContainer.getRegionIds = function () { return [1, 2, 3]; };
            neighborhoodContainer.getNextRegionId = function (currentRegionId, availableRegionId) { return 2; };
            spyOn(neighborhoodModel, 'moveToANewRegion');
            spyOn(neighborhoodContainer, 'setCurrentNeighborhood');
        });

        it("should call `moveToANewRegion` method", function () {
            neighborhoodModel.neighborhoodCompleted(1);
            expect(neighborhoodModel.moveToANewRegion).toHaveBeenCalled();
        });

        it("should call `NeighborhoodContainer.setCurrentNeighborhood`", function () {
            neighborhoodModel.neighborhoodCompleted(1);
            expect(neighborhoodContainer.setCurrentNeighborhood).toHaveBeenCalled();
        });
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

    function NeighborhoodContainerMock () {
        this._neighborhoods = {};
        this.get = function (nid) { return this._neighborhoods[nid]; };
        this.getCurrentNeighborhood = function () {};
        this.setCurrentNeighborhood = function (neighborhood) {};
    }
});