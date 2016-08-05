describe("Test for the MissionContainer module.", function () {
    var missionContainer = new MissionContainer($);
    var missionFactory = new MissionFactory();

    beforeEach(function () {
        missionContainer.refresh();
    });

    describe("add method", function(){
        it("should be able to add a new mission to the container", function() {
            var m1 = missionFactory.create(1, 1, "test1", 1, null, null, false);
            var m2 = missionFactory.create(1, 2, "test1", 2, null, null, false);
            missionContainer.add(1, m1);
            missionContainer.add(1, m2);
            var missions = missionContainer.getMissionsByRegionId(1);
            expect(missions.length).toBe(2);

            var m3 = missionFactory.create(0, 3, "test1", 1, null, null, false);
            missionContainer.add(0, m3);
            missions = missionContainer.getMissionsByRegionId(0);
            expect(missions.length).toBe(1);
        });

        it("should check duplicate", function () {
            var m1 = missionFactory.create(1, 1, "test1", 1, null, null, false);
            var m2 = missionFactory.create(1, 1, "test1", 1, null, null, false);
            missionContainer.add(1, m1);
            missionContainer.add(1, m2);
            var missions = missionContainer.getMissionsByRegionId(1);
            expect(missions.length).toBe(1);
        });
    });
});
