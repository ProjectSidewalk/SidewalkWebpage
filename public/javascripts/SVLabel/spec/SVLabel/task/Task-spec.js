describe("Tests for the TaskContainer module.", function () {
    var taskContainer;

    describe("The storeTask method", function () {
        beforeEach(function () {
            taskContainer = new TaskContainer(turf);
        });

        it("should store tasks in taskStoreByRegionId", function () {
            taskContainer.storeTask(1, { "street_edge_id": 1 });
            taskContainer.storeTask(1, { "street_edge_id": 2 });
            expect(taskContainer.getTasksInRegion(1).length).toBe(2);
        });

        it("should not store duplicate task in taskStoreByRegionId", function () {
            taskContainer.storeTask(1, { "street_edge_id": 1 });
            taskContainer.storeTask(1, { "street_edge_id": 2 });
            taskContainer.storeTask(1, { "street_edge_id": 2 });
            expect(taskContainer.getTasksInRegion(1).length).toBe(2);
        });
    });
});
