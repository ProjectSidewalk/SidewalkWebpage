describe("TaskContainer module.", function () {
    var svl;
    var streetViewService;
    var taskContainer;
    var taskModel;
    var tracker;
    var navigationModel;
    var neighborhoodModel;

    beforeEach(function () {
        svl = {};
        streetViewService = new StreetViewServiceMock();
        navigationModel = _.clone(Backbone.Events);
        neighborhoodModel = _.clone(Backbone.Events);
        neighborhoodModel.currentNeighborhood = function () { return new NeighborhoodMock(); };
        taskModel = _.clone(Backbone.Events);
        tracker = new TrackerMock();
        taskContainer = new TaskContainer(navigationModel, neighborhoodModel, streetViewService, svl, taskModel, tracker)
    });

    describe("`storeTask` method", function () {
        it("should store tasks in taskStoreByRegionId", function () {
            var t1 = new TaskMock(1);
            var t2 = new TaskMock(2);
            taskContainer.storeTask(1, t1);
            taskContainer.storeTask(1, t2);
            expect(taskContainer.getTasks(1).length).toBe(2);
        });

        it("should not store duplicate task in taskStoreByRegionId", function () {
            var t1 = new TaskMock(1);
            var t2 = new TaskMock(2);
            taskContainer.storeTask(1, t1);
            taskContainer.storeTask(1, t2);
            taskContainer.storeTask(1, t2);
            expect(taskContainer.getTasks(1).length).toBe(2);
        });
    });

    describe("`getIncompleteTaskDistance` method", function () {
        it("should return the total distance of the incomplete tasks");
    });

    describe("`nextTask` method", function () {
        var t1, t2;
        beforeEach(function () {
            t1 = new TaskMock(1);
            t2 = new TaskMock(2);
            taskContainer.storeTask(1, t1);
            taskContainer.storeTask(1, t2);
        });

        describe("if no more tasks are available in the current neighborhood", function () {
            it("should return null", function () {
                t1._properties.isComplete = true;
                t2._properties.isComplete = true;

                var task = taskContainer.nextTask();
                expect(task).toBeNull();
            });
        });

        describe("if the current task is passed as an argument", function () {
            describe("if a user has gone out of the neighborhood", function () {
                it("should randomly pick a task from the current neighborhood and return it");
            });

            describe("if all connected tasks have been already completed", function () {
                it("should randomly pick a task from the current neighborhood and return it");
            });

            it("should return one of the tasks that are connected to the current task");
        });

        describe("if no argument is passed", function () {
            it("should randomly pick a task from the current neighborhood and return it");
        });
    });

    describe("`initNextTask` method", function () {
    });

    describe("In reaction to `Neighborhood:completed` event", function () {
        beforeEach(function () {

        });

        it("`fetchTasksInARegion` should be called to fetch the tasks in the new neighborhood", function () {
            spyOn(taskContainer, 'fetchTasksInARegion');
            var parameters = {
                completedRegionId: 1,
                nextRegionId: 2
            };
            neighborhoodModel.trigger("Neighborhood:completed", parameters);
        });
    });

    function NeighborhoodMock () {
        this._properties = { regionId: 1 };
        this.getProperty = function (key) { return this._properties[key]; };
    }
    function StreetViewServiceMock () {}
    function TaskMock (street_edge_id) {
        this._properties = { isComplete: false };
        this.isComplete = function () { return this._properties.isComplete; };
        this.street_edge_id = street_edge_id;
    }
    TaskMock.prototype.getStreetEdgeId = function () { return this.street_edge_id; };

    function TrackerMock () {
        this.push = function (item) {};
    }
});
