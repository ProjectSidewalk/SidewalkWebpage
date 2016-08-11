describe("NeighborhoodFactory module.", function () {
    var neighborhoodFactory;
    var neighborhoodModel;
    var neighborhoodContainer;

    beforeEach(function () {
        neighborhoodModel = _.clone(Backbone.Events);
        neighborhoodModel.add = function (neighborhood) {
            this.trigger("NeighborhoodContainer:add", neighborhood);
        };
        neighborhoodFactory = new NeighborhoodFactory(neighborhoodModel);
        neighborhoodContainer = new NeighborhoodContainer(neighborhoodModel);
    });

    describe("`create` method", function () {
        it("create a neighborhood", function () {
            var neighborhood = neighborhoodFactory.create(1, null, "Test");
            expect(neighborhood.getProperty("regionId")).toBe(1);
        });
    });

    describe("in response to events", function () {
        describe("`NeighborhoodFactory:create`", function () {
            it("should create a neighborhood", function () {
                neighborhoodModel.trigger("NeighborhoodFactory:create", {regionId: 1, layer: null, name: "Test"});

                var neighborhood = neighborhoodContainer.get(1);
                expect(neighborhood.getProperty("regionId")).toEqual(1);
            });
        });
    });

});
