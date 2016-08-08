describe("MissionModel", function () {
    var missionModel;

    beforeEach(function () {
        missionModel = new MissionModel();
    });

    describe("`completeMission` method", function () {
        var missionMock;
        var spy;

        beforeEach(function (done) {
            // Testing event emitter
            // http://stackoverflow.com/questions/27209016/how-to-test-event-emitters-in-node
            missionMock = { test: "Test" };
            spy = sinon.spy();
            missionModel.on("MissionProgress:complete", spy);
            missionModel.completeMission(missionMock);
            done()
        });

        it("should trigger a `MissionProgress:complete", function (done) {
            expect(spy.called).toBe(true);

            var args = spy.getCalls()[0].args;
            expect(args).toEqual([missionMock]);
            done();
        });
    });

    describe("`updateProgress` method", function () {
        var spy;
        beforeEach(function (done) {

            spy = sinon.spy();
            missionModel.on("MissionProgress:update", spy);
            missionModel.updateMissionProgress();
            done();
        });

        it("should trigger a `MissionProgress:update` event", function (done) {

            expect(spy.called).toBe(true);

            done();
        });
    });


});