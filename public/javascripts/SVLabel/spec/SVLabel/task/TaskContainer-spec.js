describe("TaskContainer module.", function () {
    var svl;
    var streetViewService;
    var taskContainer;
    var taskModel;
    var tracker;
    var neighborhoodModel;

    beforeEach(function () {
        svl = {};
        streetViewService = new StreetViewServiceMock();
        neighborhoodModel = _.clone(Backbone.Events);
        taskModel = _.clone(Backbone.Events);
        tracker = new TrackerMock();
        taskContainer = new TaskContainer(neighborhoodModel, streetViewService, svl, taskModel, tracker)
    });

    describe("`storeTask` method", function () {
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

    describe("`nextTask` method", function () {
        describe("if no more tasks are available in the current neighborhood", function () {
            it("should pick a next neighborhood");
            it("should return a task from the next neighborhood");
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

    function StreetViewServiceMock () {}
    function TaskMock (street_edge_id) {
        this.street_edge_id = street_edge_id;
    }
    TaskMock.prototype.getStreetEdgeId = function () { return this.street_edge_id; };

    function TrackerMock () {
        this.push = function (item) {};
    }
});
