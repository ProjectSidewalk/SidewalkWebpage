describe("Tests for the TaskContainer module.", function () {
    var svl;
    var compass = null;
    var streetViewService = null;
    var taskContainer;
    var tracker = { push: function (item) { } };

    var TaskMock = function (street_edge_id) {
        this.street_edge_id = street_edge_id;
    };
    TaskMock.prototype.getStreetEdgeId = function () { return this.street_edge_id; };

    describe("The storeTask method", function () {
        beforeEach(function () {
            svl = {};
            taskContainer = new TaskContainer(streetViewService, svl, tracker, turf);
        });

        it("should store tasks in taskStoreByRegionId", function () {
            var t1 = new TaskMock(1);
            var t2 = new TaskMock(2);
            taskContainer.storeTask(1, t1);
            taskContainer.storeTask(1, t2);
            expect(taskContainer.getTasksInRegion(1).length).toBe(2);
        });

        it("should not store duplicate task in taskStoreByRegionId", function () {
            var t1 = new TaskMock(1);
            var t2 = new TaskMock(2);
            taskContainer.storeTask(1, t1);
            taskContainer.storeTask(1, t2);
            taskContainer.storeTask(1, t2);
            expect(taskContainer.getTasksInRegion(1).length).toBe(2);
        });
    });

    describe("`getIncompleteTaskDistance` method", function () {
        it("should return the total distance of the incomplete tasks");
    });
});
