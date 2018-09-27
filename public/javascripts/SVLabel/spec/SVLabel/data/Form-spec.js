describe("Form module", function () {
    var form;
    var formParameters;

    var labelContainer;
    var missionModel;
    var navigationModel;
    var neighborhoodModel;
    var panoramaContainer;
    var taskContainer;
    var tracker;

    beforeEach(function () {
        labelContainer = new LabelContainerMock();
        missionModel = _.clone(Backbone.Events);
        navigationModel = _.clone(Backbone.Events);
        navigationModel.getPosition = function () { return { lat: 0, lng: 0 }; };
        neighborhoodModel = _.clone(Backbone.Events);

        panoramaContainer = new PanoramaContainerMock();
        taskContainer = new TaskContainerMock();
        tracker = new TrackerMock();

        formParameters = {};
        form = new Form(labelContainer, missionModel, navigationModel, neighborhoodModel, panoramaContainer, taskContainer, tracker, formParameters);
    });


    describe("`_prepareSkipData` method", function () {
        it("should prepare the data to be sent to the server", function () {
            var issue = "IssueDescription";
            var data = form._prepareSkipData(issue);

            expect(data.issue_description).toBe(issue);
            expect(data.lat).toBe(0);
            expect(data.lng).toBe(0);
        });
    });

    describe("`skip` method", function () {
        var task;
        var data;
        beforeEach(function () {
            data = form._prepareSkipData("");
            task = new TaskMock();
            form.skipSubmit = function (data, taskIn) {};

            spyOn(form, 'skipSubmit');
            spyOn(task, 'eraseFromGoogleMaps');
            spyOn(taskContainer, 'initNextTask');
        });

        it("should erase the current task's street edge Google Maps", function () {
            form.skip(task, "");
            expect(task.eraseFromGoogleMaps).toHaveBeenCalled();
        });

        it("should call `skipSubmit", function () {
            form.skip(task, "");
            expect(form.skipSubmit).toHaveBeenCalledWith(data, task);
        });

        it("should call `TaskContainer.initNextTask` to start the next task", function () {
            form.skip(task, "");
            expect(taskContainer.initNextTask).toHaveBeenCalled();
        });

        describe("if the reason for skipping is `GSVNotAvailable`", function () {
            beforeEach(function () {
                spyOn(util.misc, 'reportNoStreetView');
            });

            it("should mark the task as completed", function () {
                form.skip(task, "GSVNotAvailable");
                expect(task.isComplete()).toBe(true);
            });

            it("should push the completed task to `TaskContainer`", function () {
                form.skip(task, "GSVNotAvailable");
                var t = taskContainer.getCompletedTasks()[0];
                expect(t).toBe(task);
            });

            it("should report the missing Street View", function () {
                form.skip(task, "GSVNotAvailable");
                expect(util.misc.reportNoStreetView).toHaveBeenCalled();
            });
        });
    });

    describe("In response to `MissionProgress:complete` event", function () {
        it("it should submit the collected data", function () {
            spyOn(taskContainer, 'getCurrentTask');
            spyOn(form, 'compileSubmissionData');
            spyOn(form, 'submit');

            missionModel.trigger("MissionProgress:complete");

            expect(taskContainer.getCurrentTask).toHaveBeenCalled();
            expect(form.compileSubmissionData).toHaveBeenCalled();
            expect(form.submit).toHaveBeenCalled();
        });
    });

    function LabelContainerMock () {}

    function PanoramaContainerMock () {}

    function TaskContainerMock () {
        this._previousTasks = [];
        this.getCompletedTasks = function () { return this._previousTasks; };
        this.getCurrentTask = function () { return new TaskMock(); };
        this.initNextTask = function (nextTask) {};
        this.nextTask = function () { return new TaskMock(); };
        this.push = function (task) { this._previousTasks.push(task); };
    }

    function TaskMock () {
        this._properties = { streetEdgeId: 0 };
        this._status = { isComplete: false };
        this.complete = function () { this._status.isComplete = true; };
        this.eraseFromGoogleMaps = function () {};
        this.getStreetEdgeId = function () { return this._properties.streetEdgeId; };
        this.isComplete = function () { return this._status.isComplete; };
    }

    function TrackerMock () {}

});
