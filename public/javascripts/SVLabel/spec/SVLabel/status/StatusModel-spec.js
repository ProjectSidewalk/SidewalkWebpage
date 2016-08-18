describe("StatusModel", function () {
    var statusModel;

    beforeEach(function () {
        statusModel = new StatusModel();
    });

    describe("`setMissionCompletionRate` method", function () {
        var spy;
        beforeEach(function (done) {
            spy = sinon.spy();
            statusModel.on("StatusFieldMissionProgressBar:setCompletionRate", spy);
            done();
        });

        it("should trigger a `StatusFieldMissionProgressBar:setCompletionRate`", function (done) {
            statusModel.setMissionCompletionRate(0.5);
            expect(spy.called).toBe(true);
            done();
        })
    });

    describe("`setProgressBar` method", function () {
        var spy;
        beforeEach(function (done) {
            spy = sinon.spy();
            statusModel.on("StatusFieldMissionProgressBar:setBar", spy);
            done();
        });

        it("should trigger a `StatusFieldMissionProgressBar:setBar", function (done) {
            statusModel.setProgressBar(0.5);
            expect(spy.called).toBe(true);
            done();
        })
    });
});