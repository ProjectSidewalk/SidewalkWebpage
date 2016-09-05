describe("TaskModel module", function () {
    var taskContainer;
    var taskModel;

    beforeEach(function () {
        taskModel = new TaskModel();
        taskContainer = new TaskContainerMock(taskModel);
        taskModel._taskContainer = taskContainer;
    });

    describe("`tasksAreAvailableInARegion` method", function () {
        var t1_n1;
        var t2_n1;
        beforeEach(function () {
            t1_n1 = new TaskMock();
            t2_n1 = new TaskMock();

            taskContainer.storeTask(1, t1_n1);
            taskContainer.storeTask(1, t2_n1);
        });

        it("should return `true` if there are tasks that are not completed in the given region", function () {
            expect(taskModel.tasksAreAvailableInARegion(1)).toBe(true);
        });

        it("should return `false` if all tasks are completed in the given region", function () {
            t1_n1._status.isCompleted = true;
            t2_n1._status.isCompleted = true;
            expect(taskModel.tasksAreAvailableInARegion(1)).toBe(false);
        });
    });


    function TaskContainerMock (taskModel) {
        taskModel._taskContainer = this;

        this._taskStoreByRegionId = {};

        this.getIncompleteTasks = function (regionId) {
            return this._taskStoreByRegionId[regionId].filter(function (task) {
                return !task.isCompleted();
            });
        };

        this.storeTask = function (regionId, task) {
            if (!(regionId in this._taskStoreByRegionId)) this._taskStoreByRegionId[regionId] = [];
            this._taskStoreByRegionId[regionId].push(task);
        };
    }

    function TaskMock () {
        this._status = { isCompleted: false };
        this.isCompleted = function () { return this._status.isCompleted; };
    }
});