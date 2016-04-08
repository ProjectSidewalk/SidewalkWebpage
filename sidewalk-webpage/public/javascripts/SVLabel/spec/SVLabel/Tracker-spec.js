describe("Tests for the Tracker module.", function () {
  var tracker = new Tracker();

  describe("The getActions method", function () {
    it("should return the correct number of actions", function () {
      expect(tracker.getActions().length).toBe(0);
      tracker.push('TaskSubmit');
      tracker.push('TaskStart');
      expect(tracker.getActions().length).toBe(2);
    });
  });
});
