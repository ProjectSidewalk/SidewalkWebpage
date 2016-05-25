describe("Tests for the Tracker module.", function () {


    describe("The getActions method", function () {
        var tracker = new Tracker();

        it("should return the correct number of actions", function () {
            expect(tracker.getActions().length).toBe(0);
            tracker.push('TaskSubmit');
            tracker.push('TaskStart');
            expect(tracker.getActions().length).toBe(2);
        });
    });

    describe("push method", function () {
        var tracker = new Tracker();

        it("should make sure that the note is of type string", function () {
            tracker.push("test", { RadioValue: 1 });
            var action = tracker.getActions()[0];
            expect(typeof action.note).toBe("string");
        });
    })
    ;
});
