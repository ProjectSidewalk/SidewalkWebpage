describe("MTurk module", function () {
    var mTurk;
    var mTurkModel;

    beforeEach(function () {
        mTurkModel = _.clone(Backbone.Events);
        mTurk = new MTurk(mTurkModel);
    });

    describe("`isAMTTask` method", function () {
        it("should return boolean", function () {
            var isAMTTask = mTurk.isAMTTask();
            expect(typeof isAMTTask).toBe("boolean");
        });
    });
});