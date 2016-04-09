describe("Tests for the Onboarding module.", function () {
    var svl = {};
    svl.onboarding= Onboarding();

    describe("_init method", function () {
        it("should set the current mission to onboarding.", function () {
            expect(tracker.getActions().length).toBe(0);
            tracker.push('TaskSubmit');
            tracker.push('TaskStart');
            expect(tracker.getActions().length).toBe(2);
        });
    });
});
