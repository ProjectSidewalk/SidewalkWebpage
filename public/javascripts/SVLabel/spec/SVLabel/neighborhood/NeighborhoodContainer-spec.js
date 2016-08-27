describe("NeighborhoodContainer module", function () {
    var neighborhoodContainer;
    var neighborhoodModel;
    var statusModel;
    var userModel;

    beforeEach(function () {
        neighborhoodModel = _.clone(Backbone.Events);
        statusModel = _.clone(Backbone.Events);
        statusModel.setNeighborhoodHref = function (href) {
            this.trigger("StatusFieldNeighborhood:setHref", href);
        };

        userModel = _.clone(Backbone.Events);
        userModel._user = new UserMock();
        userModel.getUser = function () { return this._user; };

        neighborhoodContainer = new NeighborhoodContainer(neighborhoodModel, statusModel, userModel);
    });

    describe("`getStaus` method", function () {
        it("should return a status", function () {
            var mock = {test: "Test"};

            neighborhoodContainer._status['currentNeighborhood'] = mock;
            var status = neighborhoodContainer.getStatus("currentNeighborhood");
            expect(status).toEqual(mock);
        });
    });

    describe("`getCurrentNeighborhood` method", function () {
        it("should return the current neighborhood", function () {
            var mock = {test: "Test"};
            neighborhoodContainer._status['currentNeighborhood'] = mock;
            var neighborhood = neighborhoodContainer.getCurrentNeighborhood();
            expect(neighborhood).toEqual(mock);
        });
    });

    describe("`setStatus` method", function () {
        it("should set the current status", function () {
            var mock = {test: "Test"};
            neighborhoodContainer.setStatus('currentNeighborhood', mock);
            expect(neighborhoodContainer.getCurrentNeighborhood()).toEqual(mock);
        });
    });

    describe("`setCurrentNeighborhood` method", function () {
        it("should set the current neighborhood", function () {
            var neighborhoodMock = new NeighborhoodMock();
            neighborhoodContainer.setCurrentNeighborhood(neighborhoodMock);
            expect(neighborhoodContainer.getCurrentNeighborhood()).toEqual(neighborhoodMock);
        });

        describe("if the user is not anonymous", function () {
            beforeEach(function () {
                userModel._user._properties.username = "test";
                spyOn(statusModel, 'setNeighborhoodHref');
            });

            it("should call the `StatusModel.setNeighborhoodHref` method", function () {
                var neighborhoodMock = new NeighborhoodMock();
                neighborhoodContainer.setCurrentNeighborhood(neighborhoodMock);
                expect(statusModel.setNeighborhoodHref).toHaveBeenCalled();
            });
        });
    });

    describe("`get` method", function () {
        it("should return the neighborhood of the given id", function () {
            var mock = new NeighborhoodMock();
            mock.setProperty("regionId", 1);

            neighborhoodContainer._neighborhoods[1] = mock;

            expect(neighborhoodContainer.get(1)).toEqual(mock);
        });
    });

    describe("`add` method", function () {
        it("should add a neighborhood to the `neighborhood` dictionary", function () {
            var mock = new NeighborhoodMock();
            mock.setProperty("regionId", 1);
            neighborhoodContainer.add(mock);

            expect(neighborhoodContainer.get(1)).toEqual(mock);
        });
    });

    describe("`getNextRegionId` method", function () {
        it("should return the next neighborhood", function () {
            expect(neighborhoodContainer.getNextRegionId(1, [1, 2, 3])).toBe('2');
            expect(neighborhoodContainer.getNextRegionId(3, [1, 2, 3])).toBe('1');
        });
    });

    describe("`getRegionIds` method", function () {
        it("should return all the region ids in the `_neighborhood` dictionary", function () {
            var mock1 = new NeighborhoodMock();
            var mock2 = new NeighborhoodMock();
            var mock3 = new NeighborhoodMock();
            mock1.setProperty("regionId", 1);
            mock2.setProperty("regionId", 2);
            mock3.setProperty("regionId", 3);
            neighborhoodContainer.add(mock1);
            neighborhoodContainer.add(mock2);
            neighborhoodContainer.add(mock3);

            expect(neighborhoodContainer.getRegionIds()).toEqual([1, 2, 3]);
        });
    });

    describe("in response to events", function () {
        describe("`NeighborhoodContainer:add`", function () {
            it("should add a neighborhood", function () {
                var mock1 = new NeighborhoodMock();
                mock1.setProperty("regionId", 1);
                neighborhoodModel.trigger("NeighborhoodContainer:add", mock1);

                expect(neighborhoodContainer.get(1)).toEqual(mock1);
            });
        });
    });

    function NeighborhoodMock () {
        this._properties = {};

        this.getProperty = function (key) {
            return this._properties[key];
        };

        this.setProperty = function (key, value) {
            this._properties[key] = value;
        };
    }

    function UserMock () {
        this._properties = { username: "anonymous" };
        this.getProperty = function (key) { return this._properties[key]; };
    }
});
