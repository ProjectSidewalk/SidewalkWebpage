describe("Tests for the Onboarding module.", function () {
    describe("_init method", function () {
        beforeEach(function () {

        });

        it("should set the current mission to onboarding.", function () {
            var m;
            // svl.missionFactory = MissionFactory();
            // svl.missionContainer = new MissionContainer($);
            var mission = svl.missionContainer.getCurrentMission();
            expect(mission).toBe(null);
            svl.onboarding = Onboarding($);
            mission = svl.missionContainer.getCurrentMission();
            expect(mission.getProperty("label")).toBe("onboarding");
        });
    });
});
